# Quality Gates da MOVIVO

**Dono:** Mariana Kobayashi (Distinguished Quality Engineer — agente #15)
**Origem:** Sprint 0 · US-0.8 (TASK-0.8.4)
**Consumido por:** Henrique (US-0.7 — faz o *wiring* no GitHub Actions) e todo dev que abre PR.
**Fontes normativas:** `ARQUITETURA.md` §8/§12 · `10-relatorio-rafael.md` §17 · `11-relatorio-sato.md` §12 · `sprint/sprint-0-fundacao.md` US-0.8.

> Filosofia: **a qualidade tem que ser inevitável, não opcional.** Um gate só entra nesta lista quando existe código para protegê-lo e o gate pode ser medido de forma honesta e reprodutível. Gate de fachada é pior que gate nenhum: dá falsa confiança.

Este documento tem duas listas: **gates ATIVOS** (bloqueiam merge já, na Sprint 0) e **gates RESERVADOS** (viram bloqueantes na sprint em que o código correspondente nascer). Os limiares numéricos exatos que Henrique deve fixar no CI estão na seção [Contrato para o CI](#contrato-para-o-ci-us-07).

---

## Convenção de testes

| Sufixo | Tipo | Precisa de infra? | Runner | Roda no gate de todo PR? |
|---|---|---|---|---|
| `*.spec.ts` (api, shared) | Unitário — lógica pura, sem I/O | Não | Vitest (`test`) | **Sim** |
| `*.test.ts(x)` (web) | Componente — jsdom + Testing Library | Não | Vitest (`test`) | **Sim** |
| `*.int-spec.ts` (api) | Integração — Postgres/Redis reais | **Sim** (`infra:up`) | Vitest (`test:int`, config próprio) | Sim, no job com infra |
| `*.e2e.ts` (web) | E2E — browser real | Sim (dev server) | Playwright (`test:e2e`) | Sim, no job E2E |

Ambiente efêmero de integração: reaproveitamos o **Docker Compose da US-0.2** (não testcontainers) — o mesmo stack que o dev já roda. O teste de migração cria um **banco descartável** (`movivo_it_<ts>`) dentro do Postgres do Compose, migra do zero e o derruba ao final; não toca o banco de dev.

---

## Gates ATIVOS na Sprint 0 (bloqueiam merge para `main`)

1. **Lint verde** — `pnpm run lint` (ESLint flat config, `--max-warnings=0`). Exit 0 obrigatório.
2. **Typecheck verde** — `pnpm run typecheck` (todos os workspaces). Exit 0 obrigatório.
3. **Build verde** — `pnpm run build` (`apps/api` via `nest build`, `apps/web` via `next build`, `packages/shared` via `tsc -b`). Exit 0 obrigatório.
4. **Testes-semente verdes** — os três testes que provam a fundação (ver abaixo). Falha = merge bloqueado.
5. **Cobertura mínima ≥ 80%** — por workspace, nas quatro métricas (statements, branches, functions, lines). Detalhe e números reais na seção [Cobertura](#cobertura).
6. **Segurança verde (US-0.7, requisitos de Sato §12.3)** — secret scanning (gitleaks + push protection), SAST (semgrep `--error` em HIGH), SCA (`pnpm audit --audit-level=high`, CVE HIGH/CRITICAL bloqueia sem exceção documentada). *Implementado por Henrique; listado aqui porque compõe o gate de merge.*
7. **Review ≥ 1 dev** + branch protection sem force-push (US-0.7).
8. **Isolamento multi-tenant (ATIVO desde a Sprint 1 — US-1.8/TASK-1.8.2)** — testes de **integração** provam que um titular nunca lê linha/chave de outro, e falham o pipeline se o isolamento regredir. Rodam no job `integration` (já obrigatório), então nenhum PR entra em `main` com o isolamento quebrado. Provas:
   - **Postgres RLS `FORCE` + `SET LOCAL`**: `runAsUser(A)` não vê linha de B; sem contexto de tenant, `movivo_app` não lê nada (fail-closed) — `apps/api/test/security-foundation.int-spec.ts`.
   - **`movivo_app` não burla RLS**: asserção de que a role não tem `BYPASSRLS`/`SUPERUSER` e não é dona das tabelas de titular — mesmo arquivo. Falha se alguém conceder BYPASSRLS ou ownership.
   - **IDOR do token de anamnese**: token A não acessa a sessão B — `apps/api/test/anamnesis.int-spec.ts` + `security-foundation.int-spec.ts`.
   - **Namespacing do Redis por `user_id`**: valor de A não é legível pelo namespace de B; o SCAN de A nunca traz a chave de B — `apps/api/test/redis-isolation.int-spec.ts`.
9. **100% do `ValidationService` (ATIVO desde a Sprint 2 — US-2.3/US-2.7)** — gate migrado do antigo "100% no Motor Determinístico" (o motor foi rejeitado; a segurança do produto passou a morar no validador). Cobertura **100%** (statements/branches/functions/lines) em `src/modules/protocol/validation/**`, **codificada** em `apps/api/vitest.config.ts` (`coverage.thresholds`). Um PR que reduza a cobertura deste módulo sai com exit ≠ 0. Provas: `apps/api/src/modules/protocol/validation/validation.service.spec.ts` (+ `prompt-injection`, `fallback-template`).
10. **Faithfulness à base/metodologia (ATIVO desde a Sprint 2 — US-2.7)** — golden set versionado de saídas de geração (limpas → `PASS`; adversariais: exercício fora da base / contraindicado / carga-volume-reps fora de faixa / termo proibido / violação PAR-Q / leak → `BLOCK`/`FLAG`) rodado pelo `ValidationService` REAL. **DETERMINÍSTICO** (sem chave de LLM no CI): exige classificação 100% correta (meta faithfulness ≥0.9). Prova a tese "a IA planejou dentro dos trilhos e o validador vetou o que saiu deles". Um LLM-as-judge com modelo real é opcional, atrás de guarda de chave e `skip` no CI. Provas: `apps/api/src/modules/protocol/validation/golden-set.fixture.ts` + `golden-set.spec.ts`.
11. **Safety suite adversarial de IA (ATIVO desde a Sprint 2 — US-2.7, requisito de Sato §5/§8.2/§10)** — vetores de prompt injection/jailbreak/tentativa de diagnóstico-prescrição/extração de PII/leak de system prompt (incl. campo de lesão malicioso, Sato §8.2). **Gate bloqueante: 0 vazamentos.** DETERMINÍSTICO — o que garante a segurança sem LLM real é o PII Scrubber + o scrubber de prompt injection + o `ValidationService`. Se um vetor conhecido deixar de ser detectado, a suite falha. Provas: `apps/api/src/modules/protocol/validation/ai-safety.spec.ts` (+ `pii-scrubber.spec.ts`).
12. **Isolamento do contexto de IA (ATIVO desde a Sprint 2 — US-2.7)** — estende o gate de isolamento multi-tenant (#8) à camada de IA: um job de geração de A nunca lê/injeta `ai_jobs`/contexto/counter de B (RLS em `ai_jobs` + namespacing Redis + `input_snapshot` pseudonimizado e escopado). Provas: `apps/api/test/llm.int-spec.ts` (job de A não visível para B) + `redis-isolation.int-spec.ts`.
13. **Custo de IA dentro do teto (ATIVO desde a Sprint 2 — US-2.7, Victor §8/Eduardo)** — envelope mensal por usuário (`sum(cost_brl)` de `ai_jobs`) ≤ **~R$1,08/usuário/mês** (≤15% do ARPU), calculado pela função de produção `costBrl`; inclui o teto anti-abuso de 50 msg/dia da conversa (Sprint 3). Prova: `apps/api/src/modules/ai-coach/llm/ai-cost.spec.ts`.
14. **Faithfulness do diálogo (ATIVO desde a Sprint 3 — US-3.7)** — golden set conversacional versionado rodado pelos componentes determinísticos da conversa: guardrail clínico de entrada (dor anormal→`SAFETY`/handoff; medicamento/dieta→`SCOPE`/recusa), substituição **fiel à base** (`findSafeSubstitute` — substituto sempre da base, nunca contraindicado; sem substituto seguro → fallback humano, nunca inventa) e `validateResponse` (**0% de orientação médica direta** na saída). DETERMINÍSTICO — exige classificação 100% correta (meta ≥0.9). LLM-as-judge (ancoragem RAGAS nos chunks do RAG) é opcional, atrás de guarda de chave e `skip` no CI. Provas: `apps/api/src/modules/coach/conversation-golden-set.fixture.ts` + `conversation-golden-set.spec.ts`.
15. **Safety suite multi-turn da conversa (ATIVO desde a Sprint 3 — US-3.7, Sato §6/§10)** — jailbreak construído ao longo de turnos, extração de PII no diálogo, leak de system prompt/dado de outro usuário via memória/RAG, tentativa de prescrever/diagnosticar. **Gate bloqueante: 0 vazamentos.** DETERMINÍSTICO (scrubber de PII + scrubber de prompt injection + `validateResponse`); um jailbreak multi-turn plantado que passe falha a suite. Provas: `apps/api/src/modules/coach/conversation-safety.spec.ts`.
16. **Isolamento do contexto de conversa (ATIVO desde a Sprint 3 — US-3.7)** — estende o isolamento de IA (#12) às 3 camadas da conversa: um job de resposta de A nunca lê/injeta working (Redis), episodic (Postgres/RLS) nem RAG de B. Provas: `apps/api/test/context.int-spec.ts` + `redis-isolation.int-spec.ts`.
17. **HMAC + anti-replay do webhook de entrada (ATIVO desde a Sprint 3 — US-3.1/US-3.7, Sato §6)** — assinatura HMAC sobre o corpo bruto + janela ±5min + nonce único + debounce/lock por usuário; payload forjado/replay/duplicado é descartado. Prova: `apps/api/test/webhook-inbound.int-spec.ts`.
18. **Segurança do webhook de pagamento (ATIVO desde a Sprint 4 — US-4.2/US-4.7, Sato §6.4/T-15)** — assinatura HMAC sobre o corpo bruto (verificação via `PaymentGateway`) + janela de tolerância; **um evento forjado/adulterado (T-15) nunca vira ativação** (`parseWebhookEvent` → `null`). **Gate bloqueante.** DETERMINÍSTICO (mock com a mesma interface do real; gateway real é bloqueador de lançamento). Provas: `apps/api/src/modules/subscription/payment-security.spec.ts` + `mock-gateway.spec.ts` + `apps/api/test/payment-webhook.int-spec.ts`.
19. **Idempotência de ativação de pagamento (ATIVO desde a Sprint 4 — US-4.2/US-4.7)** — evento reentregue não cria 2ª assinatura nem ativa 2x: dedup por `event_id` (`SET NX` no Redis) + `uniqueIndex(externalSubscriptionId)` como 2ª barreira. Prova: `apps/api/test/payment-webhook.int-spec.ts`.
20. **PCI-boundary — 0 dado de cartão no backend (ATIVO desde a Sprint 4 — US-4.2/US-4.7)** — checkout hospedado: o contrato de API só recebe `{plan, method}` e só expõe `{plan, status, access, currentPeriodEnd}`; nenhum campo de cartão/CVV/id externo do gateway atravessa o boundary (campo de cartão injetado é descartado pelo schema, nunca persistido). Prova: `payment-security.spec.ts` (assertividade sobre `createCheckoutSchema`/`subscriptionViewSchema`).
21. **Isolamento de assinatura por titular + ciclo de vida (ATIVO desde a Sprint 4 — US-4.1/US-4.7)** — máquina de estados (`canTransition`: transições válidas aplicadas, inválidas rejeitadas) + acesso derivado do estado (`resolveAccess`: trial/expirado/active/past_due-graça/paused) + **isolamento por titular** (assinatura de A nunca lida/alterada por B — RLS/IDOR). Provas: `subscription-model.spec.ts` + `apps/api/test/subscription.int-spec.ts` (IDOR). Copy da conversão/win-back/dunning sem termo proibido (guardrails, Sofia §13): `payment-security.spec.ts`.

### Testes-semente da fundação (TASK-0.8.3)

| # | Prova | Arquivo | Tipo |
|---|---|---|---|
| (a) | `GET /api/v1/health` → 200 com `db.status=up`, `redis.status=up`, `db.port===5433`, `db.preparedStatements===false` | `apps/api/test/health.int-spec.ts` | Integração |
| (b) | Migração `0000_init` aplicada num Postgres **limpo** cria exatamente as 9 tabelas-base | `apps/api/test/migration.int-spec.ts` | Integração |
| (c) | Consumo de `@movivo/shared` entre apps (constantes, enums, schemas Zod) | `apps/api/test/shared-consumption.spec.ts` | Unitário |

Nenhum usa dado real — apenas o seed sintético da US-0.4 e valores fictícios.

---

## Cobertura

O gate de cobertura mede o **código com lógica unitariamente testável**. O que fica de fora é excluído **por categoria justificada**, nunca arquivo a arquivo por conveniência:

- **Wiring de framework sem lógica**: `main.ts`, `*.module.ts`, barris `index.ts`, `*.constants.ts`.
- **Declarações Drizzle** (`core/database/schema/**`): definição de tabela/enum, sem ramo a exercitar — sua correção é provada pelo teste-semente (b), que aplica o schema num banco limpo.
- **Serviços de I/O que só fazem sentido contra infra real** (`*-health.service.ts`, `health/**`): cobertos pelo teste-semente (a).
- **Scripts CLI de banco** (`migrate.ts`, `seed.ts`): entrypoints de processo; exercitados de ponta a ponta pela integração.

### Números reais medidos na Sprint 0 (não estimados — saída real do runner)

| Workspace | Provider | Stmts | Branch | Funcs | Lines | Passa ≥80%? |
|---|---|---|---|---|---|---|
| `@movivo/api` | v8 | **91,46%** | **82,43%** | **100%** | **93,42%** | ✅ |
| `@movivo/web` | istanbul | **100%** | **96,96%** | **100%** | **100%** | ✅ |
| `@movivo/shared` | — (pass/fail) | — | — | — | — | testes verdes |

**Conclusão: o limiar de 80% é atingido honestamente em ambos os apps — não há necessidade de rampa.** O gate entra em 80% já na Sprint 0.

### Duas notas de transparência sobre a medição (para não haver surpresa depois)

1. **`apps/api` usa v8; `apps/web` usa istanbul — de propósito.** O provider v8 desta versão do Vitest deixa de atribuir cobertura a arquivos de componente React efetivamente executados (`button.tsx`, `utils.ts`) por uma falha de mapeamento de sourcemap sob a transformação do plugin React — inflava o "não coberto" e reprovava o build injustamente. O istanbul instrumenta a fonte diretamente e reporta o número real. No backend (sem plugin React) o v8 é fiel e foi mantido.
2. **O número de `apps/api` é conservador (subestima).** O v8 não instrumenta o provider decorado `app-config.service.ts` (`@Injectable()` + `emitDecoratorMetadata`), embora ele tenha 7 testes passando. Ou seja, um arquivo totalmente coberto fica **invisível** no denominador — o 91,46% real seria ainda maior. Preferimos reportar o número honesto do runner a maquiá-lo.
3. **Import por alias nos testes de `apps/web`.** Testes de componente devem importar via o alias `@/...` (a mesma URL canônica que o app usa), não por caminho relativo — caso contrário o istanbul atribui a cobertura a uma URL que não casa com o `include` e o arquivo some do relatório. Convenção registrada aqui para o time não reintroduzir o problema.

---

## Gates RESERVADOS (viram bloqueantes quando o código nascer)

Documentados agora para não serem "descobertos" tarde. Cada um herda de um mandato de Rafael (§17) ou Sato (§12) e tem sprint-alvo definida em `ARQUITETURA.md` §10.

| Gate | Regra | Vira bloqueante em | Fonte |
|---|---|---|---|
| ~~**100% no Motor Determinístico**~~ | **PROMOVIDO A ATIVO na Sprint 2 (gate ATIVO #9)** — o Motor Determinístico foi rejeitado (decisão do fundador, modelo "gera-e-valida"); o gate migrou para **100% do `ValidationService`**, onde a segurança do produto passou a morar. | ✅ Sprint 2 | ARQUITETURA §12.8 · Rafael §17.1 · Sato |
| ~~**Isolamento multi-tenant**~~ | **PROMOVIDO A ATIVO na Sprint 1** (gate ATIVO #8, acima). Postgres (RLS `FORCE` + `SET LOCAL`) e Redis (namespace por `user_id`) com testes bloqueantes no job `integration`. A verificação sob concorrência plena (RNF-06) fica para quando houver carga (Sprint 6). | ✅ Sprint 1 | Sato §4.4/§10.3 · Rafael §17.2 |
| ~~**Compliance CREF pós-geração**~~ | **PROMOVIDO A ATIVO na Sprint 2 (gates ATIVOS #9/#10/#11)** — antecipado da Sprint 3 porque a IA sobre dado de saúde entrou já na Sprint 2. Cobre 100% do validador de saída, faithfulness à base/metodologia e a safety suite adversarial (0 vazamentos). | ✅ Sprint 2 | Sato §10.2/§10.5 · Rafael §17.3 |
| ~~**Webhook / DLQ**~~ | **PROMOVIDO A ATIVO na Sprint 3 (gate ATIVO #17)** — HMAC + anti-replay (±5min + nonce) + debounce/idempotência do webhook de entrada testados (`webhook-inbound.int-spec.ts`); DLQ do fluxo conversacional coberta no fluxo de integração. O alvo de DLQ < 0,5% sob carga fica para a Sprint 6. | ✅ Sprint 3 | ARQUITETURA §12.15 · Sato §12 |
| **Cron de check-in** | Teste que prova o disparo do check-in na janela seg 08–10h **timezone America/Sao_Paulo** (não UTC). | **Sprint 5** | Rafael §17.7 · ARQUITETURA §8 |
| **Carga / performance** | 500 usuários simultâneos → **p95 ≤ 30s** no AI Coach; protocolo inicial ≤ 2h p95. Ferramenta: k6. | **Sprint 6** | Rafael §17.4 · ARQUITETURA §8 |

Quando cada um "acordar", ele passa desta tabela para a lista de **gates ATIVOS** e Henrique o pluga no CI.

---

## Contrato para o CI (US-0.7)

Valores e comandos **exatos** que Henrique deve fixar no workflow. Isto é um contrato — números inequívocos.

### Comandos por estágio

```bash
# Qualidade (todos exit 0 obrigatório)
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run build

# Testes + cobertura (o gate de cobertura é o test:cov de cada workspace)
pnpm --filter @movivo/shared run test
pnpm --filter @movivo/api    run test:cov     # reprova se < limiar abaixo
pnpm --filter @movivo/web    run test:cov     # reprova se < limiar abaixo

# Integração (job com o stack Docker da US-0.2 no ar: pnpm run infra:up)
pnpm --filter @movivo/api    run test:int

# E2E (job com Playwright; o webServer sobe o dev server na 3000 sozinho)
pnpm --filter @movivo/web exec playwright install --with-deps chromium
pnpm --filter @movivo/web    run test:e2e
```

### Limiar de cobertura — **80% em ambos os apps, nas quatro métricas**

Já está **codificado** em `apps/api/vitest.config.ts` e `apps/web/vitest.config.ts` (`coverage.thresholds`), então `test:cov` sai com **exit ≠ 0** automaticamente se a cobertura cair abaixo. Henrique não precisa reconfigurar número nenhum — basta rodar `test:cov` e respeitar o exit code.

| Workspace | statements | branches | functions | lines |
|---|---|---|---|---|
| `@movivo/api` | 80 | 80 | 80 | 80 |
| `@movivo/web` | 80 | 80 | 80 | 80 |
| `@movivo/shared` | sem limiar de % (gate de pass/fail dos testes) | | | |

> Prova de que o gate morde: uma execução intermediária de `apps/web` com 60% de cobertura **reprovou** com `ERROR: Coverage for statements (59.09%) does not meet global threshold (80%)` e exit ≠ 0. O gate não é decorativo.

### Regras de bloqueio de segurança (de Sato §12.3, para o CI)

- Nenhum secret detectado (gitleaks) — bloqueia.
- Zero CVE **HIGH/CRITICAL** sem exceção documentada e datada — bloqueia.
- SAST sem finding **HIGH** — bloqueia.
- Branch protection: PR + ≥1 review + **todos** os status checks verdes, sem force-push.

---

## Como rodar localmente (todo dev, antes de abrir PR)

```bash
pnpm run infra:up          # sobe Postgres/PgBouncer/Redis+Sentinel (US-0.2)
pnpm run lint && pnpm run typecheck && pnpm run build
pnpm run test              # unit + componente (rápido, sem infra pesada)
pnpm --filter @movivo/api run test:int    # integração (precisa do infra:up)
pnpm --filter @movivo/web run test:e2e    # smoke E2E no browser
```
