# Sprint 1 — Core do Usuário / Anamnese (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-07-23
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 1)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + QA (Mariana), com revisão de segurança de Sato e validação jurídica de Alexandre
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§2 stack, §8 segurança/LGPD/RLS, §10 roadmap, §12 regras inegociáveis, §3.1 ADR-005-R) · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (Épicos 1-2, gaps de UX, schema lógico §9) · `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (§8 fluxo anamnese, §9 wireframes, §13 microcopy) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (BLOQUEADORES 3 e 4, §3.1 bases legais, §5 gate PAR-Q) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` (§4 RLS, §7.3 cifra, §8 pentest anamnese, §9 auth/segredos) · `docs/fitness-ia-whatsapp/10-relatorio-rafael.md` (ADR-006 JWT, contratos REST §§1160-1218, DDL anamnese)

---

## Como ler este documento

Hierarquia: **Épico → User Stories (US-1.x) → Tasks (TASK-1.x.y)**.

- Cada **User Story** declara: jornada (o que se constrói e por quê), objetivo, resultado esperado, agentes participantes e ordem, dependências e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD (code review, teste automatizado verde, checklist de segurança de Sato, validação jurídica de Alexandre etc.).
- Esta é a **única** sprint planejada agora. As Sprints 2-6 serão planejadas depois, com o aprendizado desta. Diferentemente da Sprint 0 (fundação técnica sem funcionalidade de usuário), **a Sprint 1 é a primeira que entrega produto real ao usuário final** — e a primeira que **persiste dado de saúde** (LGPD Art. 11). Isso eleva o rigor: consentimento, cifra em repouso e RLS deixam de ser "terreno preparado" (como na Sprint 0) e viram **requisito bloqueante desta sprint**.

### Base já entregue pela Sprint 0 (não reconstruir — consumir)

- Monorepo pnpm+Turborepo com `apps/api` (NestJS), `apps/web` (Next.js 16, App Router, React 19, Tailwind 4, shadcn/ui, design system "O Pulso"), `packages/shared` (Zod + enums).
- Módulos CORE do NestJS prontos: `ConfigModule` (Zod + contrato `*_FILE`), `DatabaseModule` (Drizzle na 5433, `prepare:false`), `RedisModule` (Sentinel + helper de namespacing por `user_id`), `LoggerModule` (JSON + redação de PII), stubs `TelemetryModule`/`EventBusModule`.
- Esqueletos **vazios** já registrados dos módulos de domínio: `AuthModule`, `AnamnesisModule`, `SubscriptionModule`, `JobsModule`, `AdminModule` etc. Esta sprint **preenche** `AuthModule`, `AnamnesisModule`, o novo `ConsentModule` (dentro do bounded context de anamnese) e o `JobsModule`.
- Schema Drizzle das 9 tabelas migrado, com `user_id` e colunas de saúde marcadas `-- LGPD Art.11`. Roles `movivo_migrator` (5432) e `movivo_app` (5433, sem BYPASSRLS/ownership) prontas.
- Frontend: apenas a casca (home RSC). **Dev roda em webpack** (`pnpm run dev` / `--webpack`), não Turbopack — bug de interop do `@movivo/shared` documentado. Manter webpack nesta sprint; não gastar esforço migrando para Turbopack.
- CI/CD: 6 jobs obrigatórios (quality/integration/e2e/secret-scan/sast/sca), **branch protection ativa** — nada entra em `main` sem PR + 6 checks verdes. Quality gate 80% de cobertura; 100% no Motor Determinístico reservado (vira bloqueante só na Sprint 2).

### Regras inegociáveis que valem nesta sprint (de `ARQUITETURA.md` §12, `06-alexandre` e `11-sato`)

1. **Consentimento de saúde é pré-requisito de qualquer persistência de dado de saúde** (Alexandre, BLOQUEADOR 3): específico, destacado, opt-in ativo (checkbox não pré-marcado), separado do consentimento de marketing, com versão do texto registrada e imutável.
2. **Gate PAR-Q é BLOQUEANTE, não flag** (Alexandre/Sofia): resposta de risco **impede** a geração automática do protocolo e marca `requires_professional_review=true`. Nenhum protocolo nasce de sessão bloqueada.
3. **RLS obrigatória sob PgBouncer transaction mode** (Sato §4): `SET LOCAL app.current_user_id` por transação + `FORCE ROW LEVEL SECURITY` + `movivo_app` nunca com `BYPASSRLS` nem dona das tabelas. RLS "por padrão" vaza entre tenants.
4. **Cifra em repouso `pgcrypto`** para o bloco de saúde (`anamnesis_sessions.data_block_2`) e PAR-Q; chave via secret (`PGCRYPTO_KEY_FILE`), nunca hardcoded nem persistida no banco.
5. **Guardrails de linguagem** em toda UI, copy e microcopy: nunca "diagnóstico", "tratamento", "cura", "resultado garantido"; a IA/o produto nunca decide sozinho — sempre "profissional CREF, usando IA como ferramenta"; presença do CREF sempre visível.
6. **JWT `RS256`, nunca `HS256` nem `alg:none`** (Sato §9.1); refresh token httpOnly+Secure+SameSite=Strict com rotation, hash no banco, `jti` em denylist Redis, detecção de reuse invalida a família.
7. **Nunca versionar segredos**; PgBouncer sempre no caminho (5433, `prepare:false`); Drizzle é o ORM; monólito modular sem imports circulares; tudo stateless.
8. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI (branch protection da Sprint 0). Nenhum push direto.

---

# ÉPICO 1 — Core do Usuário e Anamnese

### Descrição

Entregar a **porta de entrada real da MOVIVO**: a landing page com pré-qualificação de objetivo, o formulário de anamnese conversacional em 3 blocos com salvamento de progresso e retomada por token, o consentimento LGPD granular como tela-ponte antes do bloco de saúde, o gate PAR-Q bloqueante, e a tela de confirmação/micro-onboarding. Do lado do backend, os módulos `AUTH` (JWT + refresh rotation, para o dashboard CREF e RBAC das próximas sprints), `CONSENT` e `ANAMNESIS`, todos assentados sobre a **fundação de segurança de dado sensível** (RLS com `SET LOCAL` + `FORCE ROW LEVEL SECURITY` e cifra `pgcrypto` do bloco de saúde) que esta sprint implementa pela primeira vez. Por fim, o **setup base do BullMQ** (registro de filas, WorkerFactory, DLQ handler, drenagem graciosa) que as Sprints 2+ vão consumir para geração de protocolo e mensageria.

### Objetivo

Ao final da Sprint 1, um usuário do perfil do Cahuã consegue: abrir a landing, escolher um objetivo, preencher os 3 blocos da anamnese com progresso salvo e retomável, consentir de forma válida com o tratamento dos seus dados de saúde, ter o PAR-Q avaliado com bloqueio real em caso de risco, e chegar a uma tela de confirmação que o direciona ao WhatsApp — **tudo com o dado de saúde cifrado em repouso e isolado por RLS**. A geração e a entrega do protocolo no WhatsApp são a Sprint 2; esta sprint entrega o funil até `anamnesis_session.status = SUBMITTED` com o usuário criado e (quando aplicável) marcado para revisão profissional.

### Resultado esperado do épico

- Landing page mobile-first no ar (`pnpm --filter web build` verde) com CTA único, pré-qualifying de objetivo e selo CREF, sob o design system "O Pulso".
- Formulário conversacional de 3 blocos funcional, com PATCH por bloco, token de retomada (72h), tela-ponte de consentimento, gate PAR-Q bloqueante e tela de confirmação.
- API com os contratos REST de anamnese (`POST /anamnesis/start`, `GET /anamnesis/session/{token}`, `PATCH /anamnesis/session/{token}/block/{n}`, `POST /anamnesis/session/{token}/submit`) e de auth (`POST /auth/login`, `/auth/refresh`, `/auth/logout`) funcionando com Zod/DTO compartilhado.
- Consentimento granular persistido em `consents` com versão imutável do texto, IP e user-agent; consentimento de saúde separado do de marketing.
- `data_block_2` cifrado com `pgcrypto`; RLS `FORCE` ativa nas tabelas que Sprint 1 toca, com `SET LOCAL` por transação no `DatabaseModule`; teste automatizado provando que um tenant não lê o dado do outro.
- AUTH com JWT RS256 (access 15min) + refresh rotation (httpOnly 30d) + denylist `jti` em Redis + RBAC (`USER`/`PROFESSIONAL`/`ADMIN`).
- BullMQ configurado (registro das 5 filas com parâmetros de §6, DLQ handler, WorkerFactory, drenagem no shutdown), provado por um job de sanidade — sem lógica de negócio ainda.
- Todos os eventos de funil de anamnese instrumentados no PostHog (`form_started`, `form_block_completed`, `form_abandoned`, `form_submitted`).
- CI verde; cobertura ≥ 80%; checklist de pentest da anamnese (Sato §8) executado por Mariana sem achado HIGH.

### Não-escopo desta sprint (para não haver ambiguidade)

Geração de protocolo (Motor Determinístico e LLM), `LLMRouter`, RAG, integração AraraHQ/WhatsApp (incluindo o envio real da confirmação e da mensagem de retomada +1h), AI Coach, pagamentos (Stripe/Asaas), sequência de conversão do trial, check-in semanal e o **Dashboard CREF em si** (a UI de fila/assinatura é Sprint 5 — nesta sprint só se constrói o AUTH/RBAC que ele consumirá). O **audit_logs append-only garantido por banco** (GRANT+RULE+hash chain, Sato §11) permanece na Sprint 5; nesta sprint a trilha de consentimento vive na própria tabela `consents` (append-only por convenção via `revoked_at`, com versão/IP/UA) — decisão a ser confirmada por Alexandre e Sato na US-1.1.

### Mapa de dependências entre User Stories

```
US-1.1 (fundação de segurança: RLS SET LOCAL + FORCE + pgcrypto + schema auth · Leonardo+Sato)
   ├──> US-1.2 (CONSENT · Leonardo, valida Alexandre)
   ├──> US-1.3 (ANAMNESIS · Leonardo) ── depende de US-1.2 (consentimento antes do bloco 2)
   └──> US-1.4 (AUTH · Leonardo, revisa Sato)
US-1.5 (Frontend landing · Felipe)  ──┐
US-1.6 (Frontend formulário 3 blocos · Felipe) ── consome contratos de US-1.2/US-1.3
US-1.7 (BullMQ base · Leonardo, colabora Henrique) ── consome RedisModule (Sprint 0)
US-1.8 (QA + revisão de segurança · Mariana+Sato) ── valida US-1.1 a US-1.7
```

Sequência prática recomendada (10 dias úteis): **US-1.1 começa no dia 1** (é a fundação que destrava todo o resto) em paralelo a **US-1.5** (landing, sem dependência de backend). US-1.2 (CONSENT) dias 3-4; US-1.3 (ANAMNESIS) dias 4-7; US-1.4 (AUTH) dias 3-6 (paralelo, outro trilho de Leonardo ou pareado). US-1.6 (formulário) dias 4-9, consumindo os contratos à medida que US-1.2/1.3 estabilizam. US-1.7 (BullMQ) dias 6-8. US-1.8 (QA + segurança) corre do dia 3 ao 10, fechando a sprint.

---

## US-1.1 — Fundação de segurança para dado sensível (RLS + pgcrypto + schema de auth)

**Agentes:** Leonardo (lead — implementa) · Sato (co-desenha e valida a especificação de RLS/cifra, §4 e §7.3).
**Depende de:** Sprint 0 (schema das 9 tabelas, roles `movivo_migrator`/`movivo_app`, `DatabaseModule`, extensão `pgcrypto` já criada). É a **primeira US** a começar.
**Habilita:** US-1.2, US-1.3, US-1.4 (nenhuma pode persistir dado real sem esta fundação).

### Jornada

A Sprint 0 preparou o terreno (coluna `user_id`, `movivo_app` sem `BYPASSRLS`, colunas marcadas `-- LGPD Art.11`), mas **não implementou** nem RLS nem cifra — porque nenhum dado real era persistido. A Sprint 1 persiste dado de saúde real (bloco 2 da anamnese + PAR-Q), então os controles do `ARQUITETURA.md` §8 e do relatório de Sato deixam de ser "futuros". Leonardo, com a especificação de Sato, implementa três coisas que toda US seguinte vai herdar: (1) o wrapper de transação com `SET LOCAL app.current_user_id` no `DatabaseModule` — sem o qual, sob PgBouncer transaction mode, o contexto de tenant vaza entre requests (Sato §4.4); (2) as políticas `FORCE ROW LEVEL SECURITY` nas tabelas que a sprint toca; (3) o helper de cifra/decifra `pgcrypto` para o bloco de saúde, com a chave vinda de secret. Além disso, o AUTH (US-1.4) exige duas estruturas que **não existem** nas 9 tabelas da Sprint 0 — credencial/role do profissional e armazenamento de refresh token — cuja migração nasce aqui para não bloquear US-1.4.

### Objetivo

Ter, no `DatabaseModule`, um contrato de execução de query **tenant-scoped** por transação (`SET LOCAL`), políticas RLS `FORCE` ativas nas tabelas de Sprint 1, cifra `pgcrypto` disponível para colunas de saúde, e o schema de auth migrado — tudo aplicável em banco limpo via migração versionada.

### Resultado esperado

Uma migração aplica as políticas RLS e os grants; o `DatabaseModule` expõe um `runAsUser(userId, role, fn)` (ou equivalente) que abre transação, faz `SET LOCAL`, executa e commita; um helper `encryptHealth`/`decryptHealth` cifra/decifra com a chave de `PGCRYPTO_KEY_FILE`; um teste prova que uma query fora do contexto de tenant não retorna linhas de outro usuário.

### Tasks

**TASK-1.1.1 — Wrapper de transação tenant-scoped no `DatabaseModule` (Leonardo).**
Implementar, sobre o client Drizzle da Sprint 0 (5433, `prepare:false`), um método `runAsUser(userId, role, callback)` que: abre transação explícita, executa `SET LOCAL app.current_user_id = <userId>` e `SET LOCAL app.current_role = <role>` (Sato §4.4), roda o callback com o `tx` e commita/rollback. Documentar que **nunca** se usa `SET` sem `LOCAL` (vaza na conexão física do pooler). Prever também um modo **token-scoped** para o fluxo público de anamnese anônima (ver decisão em TASK-1.1.4).
**Conclusão:** `runAsUser` disponível via DI; teste unitário confirma que `SET LOCAL` é emitido dentro de transação e revertido no commit; lint/typecheck verdes.

**TASK-1.1.2 — Políticas RLS `FORCE ROW LEVEL SECURITY` nas tabelas de Sprint 1 (Leonardo + Sato).**
Migração Drizzle (rodada por `movivo_migrator`) que, para as tabelas que a sprint persiste com `user_id` (`users`, `consents`, e `anamnesis_sessions` quando vinculada a usuário): `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ... FORCE ROW LEVEL SECURITY;` e políticas `USING (user_id = current_setting('app.current_user_id', true)::uuid)` para SELECT/UPDATE/DELETE e `WITH CHECK` no INSERT (Sato §4.2). Incluir a policy baseada em role para `PROFESSIONAL` onde aplicável (Sato §4.3), mesmo que o consumo pleno seja Sprint 5. Confirmar que `movivo_app` **não** é dona das tabelas e **não** tem `BYPASSRLS`.
**Conclusão:** migração aplica em banco limpo; `movivo_app` sob RLS forçada; teste de integração prova bloqueio cross-tenant (integra com US-1.8); Sato assina a especificação.

**TASK-1.1.3 — Cifra `pgcrypto` do bloco de saúde (Leonardo + Sato).**
Helper de aplicação `encryptHealth(value)`/`decryptHealth(ciphertext)` usando `pgp_sym_encrypt`/`pgp_sym_decrypt` com a chave carregada de `PGCRYPTO_KEY_FILE` (contrato `*_FILE` da Sprint 0), **nunca** hardcoded nem persistida no banco (Sato §7.3). Aplicar a cifra na escrita/leitura de `anamnesis_sessions.data_block_2` (dado de saúde + PAR-Q). Garantir que a chave nunca aparece em log (LoggerModule já redige PII; validar). Documentar o procedimento de rotação anual da chave (Sato §9.3) como runbook, sem implementar o re-encrypt automático (Fase B).
**Conclusão:** `data_block_2` é gravado cifrado (verificável por `SELECT` bruto retornar ciphertext) e lido decifrado pela aplicação; chave vem de secret; teste unitário do round-trip cifra/decifra verde.

**TASK-1.1.4 — Decisão e migração do modelo de acesso da anamnese anônima (Leonardo + Sato).**
A sessão de anamnese começa **anônima** (`user_id` nulo até o submit — Sofia §8.1), acessada por token opaco. RLS por `current_user_id` não protege uma linha sem `user_id`; portanto o fluxo público é **token-scoped**, não user-scoped: o handler **sempre** filtra por `token` e **nunca** aceita `user_id` do cliente (proteção IDOR, Sato §8.1). Definir e documentar: enquanto `status=IN_PROGRESS` e `user_id IS NULL`, o acesso é por token (validação de aplicação + índice único no token); no `submit`, cria-se o `users` (status `ONBOARDING`) a partir do bloco 1, vincula-se `anamnesis_sessions.user_id`, e a partir daí a linha passa a ser protegida por RLS. Ajustar a policy de `anamnesis_sessions` para permitir a fase anônima sem furar o isolamento das linhas já vinculadas.
**Conclusão:** documento curto de decisão anexado ao PR; policy de `anamnesis_sessions` cobre as duas fases; teste prova que token A não acessa sessão de token B e que sessão vinculada respeita RLS.

**TASK-1.1.5 — Migração do schema de AUTH (credencial/role + refresh session) (Leonardo).**
As 9 tabelas da Sprint 0 não têm onde guardar credencial do profissional nem refresh tokens. Criar migração adicionando: (a) o mínimo para autenticar `PROFESSIONAL`/`ADMIN` — coluna `role` (enum `USER`/`PROFESSIONAL`/`ADMIN`) e `password_hash` (Argon2id) em `users`, ou tabela dedicada se preferível, sem quebrar o schema existente; (b) tabela `auth_sessions` (ou `refresh_tokens`) guardando **hash** do refresh, `jti`, `family_id`, `user_id`, `expires_at`, `revoked_at` (Sato §9.1 — nunca o token em claro). Marcar `password_hash` e o hash do refresh como sensíveis (nunca logados). RLS aplicável.
**Conclusão:** migração aplica em banco limpo; `db:generate` não produz diff residual; colunas/tabela prontas para US-1.4 consumir.

### Definição de Pronto (US-1.1 "validada")

- [ ] Tasks 1.1.1–1.1.5 concluídas.
- [ ] `runAsUser` com `SET LOCAL` disponível; RLS `FORCE` ativa; `data_block_2` cifrado em repouso; schema de auth migrado.
- [ ] **Checklist de segurança (Sato §4/§7.3/§8.1) verde:** `movivo_app` sem `BYPASSRLS`/ownership; chave `pgcrypto` via secret; IDOR do token tratado; nenhum `SET` sem `LOCAL`.
- [ ] **Validada por:** code review + revisão de especificação de Sato + teste de integração de isolamento cross-tenant verde no CI (US-1.8).

---

## US-1.2 — CONSENT: consentimento LGPD granular com trilha auditável

**Agentes:** Leonardo (lead) · Alexandre (valida o texto de consentimento, a granularidade e a base legal — BLOQUEADOR 3 e §3.1).
**Depende de:** US-1.1 (RLS/cifra; `consents` sob RLS). Precede o bloco 2 de US-1.3 (nenhum dado de saúde antes do consentimento).
**Habilita:** US-1.3 (anamnese só coleta saúde após consentimento válido) e US-1.6 (tela-ponte de consentimento).

### Jornada

Antes de qualquer dado de saúde entrar no banco, o consentimento específico e destacado do Art. 11, II, "a" da LGPD precisa estar registrado — e registrado como **prova** (versão exata do texto, timestamp, IP, user-agent), não como anotação (Alexandre §3.1; comentário do schema `consents.ts`). Leonardo implementa o `ConsentService` que grava consentimentos granulares e independentes (`HEALTH_DATA`, `MARKETING`, `TERMS_OF_SERVICE`), impede que o de saúde seja inferido do aceite dos termos, e suporta revogação (`revoked_at`, sem DELETE). Alexandre fornece e valida o **artefato de texto versionado e imutável** que a coluna `version` referencia — sem esse texto aprovado, o formulário não pode coletar saúde (é conteúdo, é bloqueador jurídico, não de engenharia).

### Objetivo

Ter um serviço e endpoint que registram consentimento granular versionado com trilha de prova, recusando qualquer tentativa de amarrar saúde a marketing ou a termos, e suportando revogação — tudo sob RLS.

### Resultado esperado

Ao aceitar o consentimento de saúde na tela-ponte, o backend grava `consents(HEALTH_DATA, versão, accepted=true, ip, user_agent, accepted_at)`; o consentimento de marketing é linha separada e opcional; reaceitar a mesma versão é idempotente (unique `user_id+type+version`); revogar carimba `revoked_at` sem apagar histórico.

### Tasks

**TASK-1.2.1 — Artefato de texto de consentimento versionado (Alexandre → Leonardo).**
Alexandre entrega o texto final do consentimento de saúde (finalidade específica, quem acessa — o profissional CREF nº ___, revogabilidade) e do consentimento de marketing, cada um com um identificador de versão imutável (ex.: `2026-07-v1`). Leonardo versiona esse texto como artefato do repositório (ex.: `packages/shared` ou `apps/api` como constante/arquivo versionado) referenciado por `consents.version`, garantindo que a versão apresentada ao usuário e a registrada sejam a mesma (Alexandre §3.1).
**Conclusão:** artefato de texto versionado no repo; `version` do registro referencia exatamente o texto exibido; Alexandre aprova o conteúdo por escrito (comentário no PR).

**TASK-1.2.2 — `ConsentService` e contrato Zod compartilhado (Leonardo).**
Implementar `ConsentService.record(userId|sessionToken, type, version, accepted, ip, userAgent)` e `revoke(userId, type)`. DTOs Zod em `@movivo/shared` para o payload de consentimento. Regras: `HEALTH_DATA`, `MARKETING` e `TERMS_OF_SERVICE` são **independentes** (Alexandre — vedação de consentimento genérico); marketing default **não** marcado; recusa (`accepted=false`) também é registrada. Idempotência pela unique `uq_consents_user_type_version`. Persistir `ip`/`user_agent` (nunca em log — LoggerModule redige).
**Conclusão:** serviço grava/revoga corretamente; teste unitário cobre idempotência, independência de finalidades e revogação; DTO compartilhado consumível pelo frontend.

**TASK-1.2.3 — Endpoint de consentimento integrado à sessão de anamnese (Leonardo).**
Expor o registro de consentimento no fluxo público da anamnese (tela-ponte antes do bloco 2), associado ao `token` da sessão enquanto anônima, e migrável para `user_id` no submit. Regra de negócio dura: `PATCH .../block/2` (dado de saúde) **falha** se não houver `HEALTH_DATA accepted=true` registrado para aquela sessão (Alexandre BLOQUEADOR 3). Instrumentar evento PostHog de consentimento.
**Conclusão:** tentativa de salvar bloco 2 sem consentimento de saúde retorna erro claro (4xx) e não persiste nada; com consentimento, prossegue; teste de integração cobre os dois caminhos.

### Definição de Pronto (US-1.2 "validada")

- [ ] Tasks 1.2.1–1.2.3 concluídas.
- [ ] Consentimento de saúde separado, destacado, opt-in ativo, versionado e com trilha (IP/UA/timestamp); marketing independente; revogação sem DELETE.
- [ ] Bloco 2 é intransponível sem consentimento de saúde válido.
- [ ] **Validada por:** code review + **aprovação jurídica de Alexandre** do texto e da granularidade + teste de integração verde (US-1.8).

---

## US-1.3 — ANAMNESIS: sessão em 3 blocos, retomada por token e gate PAR-Q bloqueante

**Agentes:** Leonardo (lead) · Alexandre (define/valida o conjunto de perguntas do PAR-Q e as respostas que disparam bloqueio — §5) · Sato (revisa pentest do token/IDOR — §8).
**Depende de:** US-1.1 (RLS/cifra/decisão de acesso anônimo) e US-1.2 (consentimento antes do bloco 2).
**Habilita:** US-1.6 (formulário frontend consome estes contratos) e a Sprint 2 (protocolo parte de `status=SUBMITTED`).

### Jornada

O formulário de anamnese é, ao mesmo tempo, o ponto de maior risco de abandono (Lucas Risco 1: 60-70%) e a superfície não-autenticada que coleta dado de saúde (Sato §8). Leonardo implementa os quatro contratos REST de Rafael (§§1160-1163) sobre a tabela `anamnesis_sessions`: iniciar sessão (gera token CSPRNG, 72h de expiração), retomar por token, salvar bloco `n` via PATCH (salvamento de progresso — Sofia §8.3), e submeter. O bloco 2 grava cifrado (US-1.1) e exige consentimento (US-1.2). A peça crítica é o **gate PAR-Q bloqueante** (Alexandre §5, Sofia §8.5): respostas de risco (dor torácica, problema cardíaco, tontura/desmaio, medicação para pressão/coração, gestação, lesão ativa, cirurgia recente) marcam `requires_professional_review=true` no usuário e colocam a sessão em estado que **impede** a geração automática — não é flag, é trava. No submit, cria-se o `users` (ONBOARDING), vincula-se a sessão, e a saída alimenta a Sprint 2.

### Objetivo

Ter os endpoints de anamnese funcionando com salvamento por bloco, retomada por token, cifra do bloco de saúde, avaliação determinística do PAR-Q com bloqueio real, e criação/vínculo do usuário no submit — com IDOR e SQLi mitigados.

### Resultado esperado

Um usuário inicia a sessão, preenche os 3 blocos com progresso salvo e retomável, e ao submeter: se sem flags de risco → sessão `SUBMITTED`, usuário `ONBOARDING`, pronto para a Sprint 2; se com flag de risco → `requires_professional_review=true` e sessão bloqueada para geração automática, com o estado que a tela de cuidado (US-1.6) reflete.

### Tasks

**TASK-1.3.1 — Contratos REST e DTOs Zod da anamnese (Leonardo).**
Implementar em `AnamnesisModule`: `POST /api/v1/anamnesis/start` (cria sessão + token CSPRNG `crypto.randomUUID()`/64 chars, `expires_at`=+72h, opcional `primary_goal` da landing), `GET /api/v1/anamnesis/session/{token}` (retoma no `last_block`), `PATCH /api/v1/anamnesis/session/{token}/block/{n}` (salva `data_block_n`, avança `last_block`), `POST /api/v1/anamnesis/session/{token}/submit`. DTOs Zod por bloco em `@movivo/shared` (validação de entrada — regra §12). Rate limit `/anamnesis/*` 60 req/min por IP (Rafael §1217). `Referrer-Policy: no-referrer` e não logar query string com token (Sato §8.1).
**Conclusão:** os 4 endpoints respondem conforme contrato; DTOs compartilhados; rate limit ativo; token nunca aparece em log.

**TASK-1.3.2 — Salvamento de progresso, retomada e expiração (Leonardo).**
PATCH por bloco persiste imediatamente (não espera o form completo — Rafael §5, Sofia §8.3). Bloco 2 cifrado via helper de US-1.1 e barrado sem consentimento (US-1.2). Retomada abre no `last_block` com dados preservados. **Expiração 72h**: sessões `IN_PROGRESS` expiradas viram `EXPIRED` e têm o dado sensível descartado (minimização LGPD — Lucas/Rafael §5; índice `idx_anamnesis_sessions_expires_at` já existe). Deixar o expurgo pronto para ser agendado por um job (o agendamento real usa o BullMQ de US-1.7; se a fila não estiver pronta, um comando manual/documentado é aceitável nesta sprint).
**Conclusão:** progresso sobrevive a abandono e retorno; sessão expirada não expõe `data_block_2`; teste cobre salvar→abandonar→retomar e expiração.

**TASK-1.3.3 — Gate PAR-Q bloqueante determinístico (Leonardo + Alexandre).**
Alexandre entrega o conjunto autoritativo de perguntas do PAR-Q e o mapa de **respostas de risco** que disparam bloqueio (§5). Leonardo implementa a avaliação **determinística** (sem IA — regra §12.4/§12.5) no submit: qualquer resposta de risco → `users.requires_professional_review=true` e a sessão entra em estado que **impede geração automática de protocolo** (Alexandre BLOQUEADOR 3 / Sofia estados `BLOQUEADO_AGUARDANDO_CLEARANCE` / `LIBERADO_COM_RESSALVA_RT` / `LIBERADO`). Nenhuma linguagem de diagnóstico no retorno (guardrail §5). O caso fica visível para o profissional CREF (a UI é Sprint 5; aqui basta o estado persistido e consultável).
**Conclusão:** resposta de risco no PAR-Q bloqueia a geração e marca revisão profissional; resposta sem risco segue fluxo normal; teste cobre cada gatilho de risco; Alexandre valida o mapa de respostas.

**TASK-1.3.4 — Submit: criação e vínculo do usuário (Leonardo).**
No `submit`: validar que os 3 blocos estão completos, criar `users` (status `ONBOARDING`) a partir do bloco 1 (nome, telefone E.164, e-mail), vincular `anamnesis_sessions.user_id` e migrar os consentimentos da sessão para o `user_id` (US-1.2), setar `status=SUBMITTED`, emitir `form_submitted`. A partir daqui a linha é protegida por RLS (US-1.1). A entrega do protocolo e a confirmação via WhatsApp são Sprint 2 — o submit **não** dispara AraraHQ nesta sprint.
**Conclusão:** submit cria usuário, vincula sessão, migra consentimento e emite evento; teste de integração cobre o caminho feliz e o bloqueado (PAR-Q de risco).

### Definição de Pronto (US-1.3 "validada")

- [ ] Tasks 1.3.1–1.3.4 concluídas.
- [ ] 4 contratos REST verdes; salvamento/retomada/expiração funcionando; bloco 2 cifrado e gated por consentimento.
- [ ] Gate PAR-Q **bloqueia de verdade** (não flag) e marca revisão profissional; sem linguagem de diagnóstico.
- [ ] **Validada por:** code review + validação de Alexandre (perguntas/respostas PAR-Q) + revisão de pentest de Sato (IDOR/SQLi/token) + testes de integração verdes (US-1.8).

---

## US-1.4 — AUTH: JWT com refresh token rotation e RBAC

**Agentes:** Leonardo (lead) · Sato (revisa a estratégia de rotação/revogação — ADR-006 / §9.1).
**Depende de:** US-1.1 (schema de auth: `role`, `password_hash`, `auth_sessions`; RLS).
**Habilita:** o Dashboard CREF (Sprint 5), a assinatura de protocolo (`PROFESSIONAL`, Sprint 2/5) e todo endpoint autenticado das próximas sprints.

### Jornada

No MVP, o usuário final **não** se autentica (acessa o produto pelo WhatsApp e o formulário por token — ADR-006). Quem precisa de login é o **profissional CREF** e o admin, para o dashboard de operações. Mesmo que a UI do dashboard só chegue na Sprint 5, o AUTH é construído agora (é o item explícito da Sprint 1 no roadmap §10) para que as demais sprints tenham guards, RBAC e emissão/renovação de token prontos. Leonardo implementa JWT `RS256` (nunca `HS256`/`alg:none`), access de 15min com claims mínimos (`sub`, `role`, `jti`), refresh em cookie httpOnly+Secure+SameSite=Strict de 30 dias com **rotation** (o token antigo é invalidado a cada renovação), hash do refresh no banco, denylist de `jti` em Redis para logout/revogação, e **detecção de reuse** que invalida a família inteira (indício de roubo — Sato §9.1). RBAC com `USER`/`PROFESSIONAL`/`ADMIN` via guard + `@Roles()`.

### Objetivo

Ter login/refresh/logout funcionando com JWT RS256 + refresh rotation seguro + RBAC, prontos para os endpoints protegidos das próximas sprints.

### Resultado esperado

`POST /auth/login` autentica um profissional (Argon2id), emite access (15min) + refresh (httpOnly 30d); `POST /auth/refresh` rotaciona e invalida o anterior; reuso de refresh já rotacionado invalida a família; `POST /auth/logout` coloca o `jti` na denylist; um guard `@Roles('PROFESSIONAL')` barra `USER`.

### Tasks

**TASK-1.4.1 — Emissão e validação de JWT RS256 (Leonardo).**
Configurar `@nestjs/passport` + `passport-jwt` com **algoritmo fixo `RS256`**, validando `algorithms: ['RS256']` explicitamente (rejeitar `alg:none`/`HS256`). Par de chaves via secret (`JWT_PRIVATE_KEY_FILE`/`JWT_PUBLIC_KEY_FILE`, contrato `*_FILE`), com `kid` para rotação sem downtime (aceitar N e N-1 — Sato §9.3). Access token 15min, claims `sub`/`role`/`iat`/`exp`/`jti`.
**Conclusão:** access token válido é aceito; token com `alg:none`/`HS256` é rejeitado; chaves via secret; teste cobre validação de algoritmo.

**TASK-1.4.2 — Refresh token rotation com detecção de reuse (Leonardo + Sato).**
`POST /auth/refresh`: valida o refresh (cookie httpOnly+Secure+SameSite=Strict), confere o **hash** armazenado em `auth_sessions`, emite novo par e **invalida o refresh anterior** (rotation). Se um refresh já rotacionado for reapresentado → invalidar toda a `family_id` (Sato §9.1). `POST /auth/logout` adiciona `jti` à **denylist em Redis** com TTL = validade restante (usar o helper de namespacing da Sprint 0). Guardar sempre hash, nunca o token em claro.
**Conclusão:** rotation funciona; reuse invalida a família; logout revoga via denylist; testes cobrem os três cenários.

**TASK-1.4.3 — RBAC (`USER`/`PROFESSIONAL`/`ADMIN`) e rate limit de login (Leonardo).**
Guard NestJS + decorator `@Roles()`; aplicar a esqueleto de endpoint protegido (ex.: um `GET /admin/ping` de sanidade) provando que `USER` é barrado e `PROFESSIONAL` passa. Rate limit `/auth/login` 10 req/min por IP (proteção brute force — Rafael §1218). Hash de senha **Argon2id**.
**Conclusão:** RBAC barra role insuficiente; rate limit ativo; senha com Argon2id; testes de autorização verdes.

### Definição de Pronto (US-1.4 "validada")

- [ ] Tasks 1.4.1–1.4.3 concluídas.
- [ ] JWT RS256 (sem HS256/none); refresh rotation com hash no banco + denylist Redis + detecção de reuse; RBAC funcional; rate limit de login.
- [ ] **Validada por:** code review + **revisão de segurança de Sato** (ADR-006/§9.1) + testes de auth/autorização verdes (US-1.8).

---

## US-1.5 — Frontend: landing page com pré-qualificação de objetivo

**Agentes:** Felipe (lead).
**Depende de:** Sprint 0 (Next.js + design system "O Pulso" configurado). Sem dependência de backend — começa no dia 1.
**Habilita:** US-1.6 (o CTA e o `primary_goal` alimentam o início da sessão de anamnese).

### Jornada

A landing é a primeira impressão e o filtro do funil (Lucas Épico 1; Sofia §9.1). Felipe constrói a página mobile-first sobre o design system já pronto, com **CTA único** (elimina paralisia de plano — Lucas), **pré-qualifying de objetivo em 1 clique** (perder peso / ganhar massa / condicionamento) que segue como `primary_goal`, o "como funciona" em 3 passos com o profissional CREF explícito, social proof básico e o **selo CREF** como elemento de conversão (não decorativo). Toda a copy respeita os guardrails: nenhuma promessa de resultado, presença do CREF visível, sem termos proibidos (Sofia §13).

### Objetivo

Uma landing mobile-first, acessível e performática, com CTA único e pré-qualifying, que inicia o fluxo carregando o objetivo escolhido.

### Resultado esperado

`pnpm --filter web build` verde; a landing renderiza (RSC onde possível), o clique no objetivo + CTA leva ao início do formulário com `primary_goal` preservado; LCP alvo ≤ 1,5s (Lucas Épico 1).

### Tasks

**TASK-1.5.1 — Estrutura e conteúdo da landing (Felipe).**
Implementar a landing conforme wireframe de Sofia §9.1: header com símbolo Pulso, H1/subtítulo com a essência "Treino de verdade, no seu WhatsApp" + CREF por trás, chips de objetivo (pré-qualifying), CTA "Começar agora" (Verde Pulso sobre Petróleo), microcopy "grátis por 7 dias · sem cartão · cancele quando quiser" (Eduardo), seção "como funciona" (3 passos), social proof e selo CREF sóbrio. Tokens do design system "O Pulso" (Sprint 0). **Sem termos proibidos** (Sofia §13).
**Conclusão:** landing corresponde ao wireframe; copy passa pelo checklist de guardrails; build verde.

**TASK-1.5.2 — Pré-qualifying e handoff para o formulário (Felipe).**
A seleção de objetivo pinta o chip (Verde Pulso) e é persistida (query param/estado) até o início da sessão de anamnese, chegando como `primary_goal` no `POST /anamnesis/start` (US-1.3). CTA único e inequívoco; redirecionamento percebido como fluxo contínuo (Lucas — evitar drop 30-50% na transição).
**Conclusão:** objetivo escolhido chega ao início do formulário; transição sem perda de contexto; teste E2E de smoke (Playwright) cobre landing→início do form.

**TASK-1.5.3 — Performance, acessibilidade e analytics (Felipe).**
Mobile-first real (alvos de toque 44×44px), semântica HTML, `lang="pt-BR"`, sem violação crítica de axe (WCAG 2.2 AA — Sofia §14), `prefers-reduced-motion` no Pulso animado. Instrumentar `form_started` no início do fluxo (PostHog stub da Sprint 0). LCP alvo ≤ 1,5s.
**Conclusão:** axe sem violação crítica; evento `form_started` dispara; Lighthouse sem regressão grosseira.

### Definição de Pronto (US-1.5 "validada")

- [ ] Tasks 1.5.1–1.5.3 concluídas.
- [ ] Landing mobile-first no ar, CTA único, pré-qualifying funcional, selo CREF visível, copy dentro dos guardrails.
- [ ] Build/lint/typecheck verdes; axe sem violação crítica.
- [ ] **Validada por:** code review + revisão de copy (guardrails) + smoke E2E verde (US-1.8).

---

## US-1.6 — Frontend: formulário conversacional, consentimento, gate PAR-Q e confirmação

**Agentes:** Felipe (lead) · consome contratos de US-1.2 (consentimento) e US-1.3 (anamnese) · Sofia como referência de UX (§§8-9, 13).
**Depende de:** US-1.5 (entrada), US-1.2 e US-1.3 (contratos de backend). Pode começar com mocks e integrar à medida que os endpoints estabilizam.
**Habilita:** o funil completo de aquisição→submissão (fecha o Épico 1).

### Jornada

Este é o coração da Sprint 1 no frontend e o maior fator de conversão/abandono do produto (Lucas Risco 1; Sofia §6: forms conversacionais completam 47,3% vs. 21,5% dos tradicionais). Felipe implementa o formulário **conversacional** (uma pergunta/micro-grupo por vez), em **3 blocos** com **progresso rotulado** ("Sobre você · Sua saúde · Sua rotina"), salvamento por bloco via PATCH, retomada por token, a **tela-ponte de consentimento de saúde** (opt-in ativo, checkbox não pré-marcado, marketing separado), o **gate PAR-Q** com ramificação condicional e a **tela de cuidado** bloqueante, e a **tela de confirmação/micro-onboarding** (salvar contato + SLA + deep link wa.me). Toda a microcopy segue os guardrails (Sofia §13): erros gentis em Coral, nunca vermelho-alarme; nenhuma linguagem de diagnóstico; CREF presente.

### Objetivo

Um formulário conversacional de 3 blocos, acessível e mobile-first, que salva progresso, coleta consentimento válido, trata o PAR-Q com bloqueio real e confirma com micro-onboarding — integrado aos contratos reais do backend.

### Resultado esperado

O usuário percorre Bloco 0 (identificação) → Bloco 1 → tela-ponte de consentimento → Bloco 2 (saúde/PAR-Q) → Bloco 3 → confirmação; cada bloco salva via PATCH; abandono+retorno preserva o progresso; PAR-Q de risco leva à tela de cuidado; confirmação oferece salvar o número e abrir o WhatsApp.

### Tasks

**TASK-1.6.1 — Motor do formulário conversacional com progresso e salvamento (Felipe).**
Implementar o fluxo dos wireframes de Sofia §§9.2-9.3, 9.5, 9.7: card conversacional, foco automático, chips de seleção, teclado numérico para números, **progresso rotulado** + barra fina, **voltar sem perder dado**, validação inline gentil (Coral). Cada bloco concluído dispara `PATCH /anamnesis/session/{token}/block/{n}` e emite `form_block_completed(n)`. Retomada por token abre no `last_block`. Instrumentar `form_abandoned` (último bloco) na saída.
**Conclusão:** os 3 blocos navegáveis com progresso salvo e retomável; eventos de funil disparando; mobile-first (alvos 44px).

**TASK-1.6.2 — Tela-ponte de consentimento de saúde (Felipe).**
Implementar a tela dedicada antes do Bloco 2 (Sofia §9.4): linguagem clara (não juridiquês), o que se coleta / para quê / quem acessa (profissional CREF) / revogável; **checkbox de saúde não pré-marcado** (opt-in ativo) que habilita o "Continuar"; **checkbox de marketing separado e opcional**; link para a Política. No aceite, chama o endpoint de consentimento (US-1.2) com a **versão** do texto exibido. Sem o checkbox de saúde, o avanço é impossível.
**Conclusão:** consentimento granular registrado com a versão correta; "Continuar" desabilitado sem o aceite de saúde; marketing independente.

**TASK-1.6.3 — Bloco 2 (saúde/PAR-Q) com ramificação e tela de cuidado bloqueante (Felipe).**
Bloco 2 conforme Sofia §9.5: perguntas PAR-Q binárias com follow-up condicional sem alarme ("Obrigada por contar. Isso é importante pra sua segurança."), chips de lesão, campo opcional de medicação. Se o submit retornar estado de risco (US-1.3), exibir a **tela de cuidado** (Sofia §9.6): tom sério-acolhedor, opção de enviar liberação médica ou "fazer depois no WhatsApp", **sem diagnóstico** e sem "você não pode treinar". Microcopy exatamente dentro da tabela de guardrails (Sofia §13).
**Conclusão:** ramificação condicional funciona; PAR-Q de risco leva à tela de cuidado (não à confirmação normal); nenhum termo proibido na copy.

**TASK-1.6.4 — Tela de confirmação / micro-onboarding (Felipe).**
Implementar a tela de confirmação (Sofia §9.8): Pulso animado (respeitando `prefers-reduced-motion`), reforço CREF + expectativa de SLA de 2h, card "salve o número da MOVIVO", deep link `wa.me` para abrir a conversa. Emitir `form_submitted` já foi feito no backend; aqui garantir o evento de visualização da confirmação. O envio real da mensagem no WhatsApp é Sprint 2 — o deep link é estático.
**Conclusão:** confirmação corresponde ao wireframe; deep link abre o WhatsApp; animação degrada com `prefers-reduced-motion`.

**TASK-1.6.5 — Acessibilidade e resiliência do formulário (Felipe).**
WCAG 2.2 AA (Sofia §14): labels associados (nunca só placeholder), mensagens de erro programáticas e descritivas, `autocomplete` nos campos de identificação, foco visível (anel Verde Pulso), navegação por teclado. Tratar erros de rede sem perder o dado do bloco (o progresso salvo protege). Tela de retomada expirada explica o descarte de 72h com transparência (Sofia §8.3).
**Conclusão:** axe sem violação crítica no formulário; erro de rede não perde progresso; retomada expirada comunicada.

### Definição de Pronto (US-1.6 "validada")

- [ ] Tasks 1.6.1–1.6.5 concluídas.
- [ ] Formulário conversacional de 3 blocos com progresso salvo/retomável; consentimento granular; gate PAR-Q com tela de cuidado bloqueante; confirmação com micro-onboarding.
- [ ] Microcopy 100% dentro dos guardrails (Sofia §13); WCAG 2.2 AA sem violação crítica.
- [ ] **Validada por:** code review + revisão de UX/copy + E2E do fluxo completo (feliz e bloqueado) verde (US-1.8).

---

## US-1.7 — Setup base do BullMQ (filas, WorkerFactory, DLQ)

**Agentes:** Leonardo (lead) · Henrique (colabora — parâmetros de Redis/Sentinel, ajuste de infra/CI se necessário).
**Depende de:** Sprint 0 (`RedisModule` via Sentinel, AOF habilitado). Sem dependência das demais US de domínio.
**Habilita:** Sprint 2 (geração de protocolo), Sprint 3 (AI response/whatsapp-outbound), Sprint 4 (conversão), Sprint 5 (check-in) — e o expurgo agendado da anamnese (US-1.3).

### Jornada

As próximas sprints são movidas a filas (Rafael §6: 5 filas com parâmetros fixos). Para evitar que cada sprint reinvente a infraestrutura de jobs, Leonardo preenche o `JobsModule` (esqueleto da Sprint 0) com o **setup base** do BullMQ sobre o Redis+Sentinel: um `QueueManager` que registra as filas com seus parâmetros de §6, um `WorkerFactory` padronizado, um **DLQ handler** genérico (alerta + fallback + task manual — a integração com Sentry/WhatsApp é das sprints futuras, aqui fica o hook), e a **drenagem graciosa** no shutdown (o `enableShutdownHooks` já foi preparado na Sprint 0). Nenhuma lógica de negócio de fila nasce aqui — só a fundação, provada por um job de sanidade (echo/no-op) e, se pronto a tempo, o job de expurgo de anamnese expirada de US-1.3.

### Objetivo

Ter o BullMQ conectado ao Redis+Sentinel, com as filas registradas (parâmetros de §6), WorkerFactory, DLQ handler e drenagem graciosa — validado por um job de sanidade.

### Resultado esperado

O `JobsModule` sobe as filas configuradas; um job de teste é enfileirado, processado e confirmado; um job que falha além dos retries cai na DLQ e dispara o hook; no shutdown, os workers drenam sem perder job (AOF garante durabilidade).

### Tasks

**TASK-1.7.1 — `QueueManager` e registro das filas (Leonardo).**
Registrar no BullMQ (conexão via Sentinel, senha por secret) as filas de §6 com seus parâmetros fixos: `protocol-generation` (5 workers, lock 120s, 3 retries backoff 2/8/32s, DLQ), `ai-response` (20, lock 45s, 2 retries, priority por tier, rate 80/s), `whatsapp-outbound` (10, lock 30s, 5 retries, rate 80/s global), `checkin-weekly` (10, cron seg 08h São_Paulo, spread 0-7200s), `conversion-sequence` (5, delayed d7/10/13/14). Registrar as definições **sem** implementar os processadores de negócio (Sprints 2-5).
**Conclusão:** filas registradas com os parâmetros corretos; conexão via Sentinel; senha via secret.

**TASK-1.7.2 — WorkerFactory, DLQ handler e drenagem graciosa (Leonardo + Henrique).**
`WorkerFactory` padronizado para criar workers com observabilidade mínima (log estruturado por job, correlation id). **DLQ handler** genérico: job que falha após os retries cai na DLQ e dispara um hook (interface) para alerta/fallback/task manual — a implementação concreta (Sentry, mensagem WhatsApp) é sprint futura. Drenagem graciosa no `SIGTERM` (drenar in-flight antes de encerrar — stateless, §12.6). AOF já habilitado (Sprint 0) garante que jobs não se percam em restart.
**Conclusão:** worker processa job de teste; job que estoura retries cai na DLQ e chama o hook; shutdown drena sem perder job (teste de integração).

**TASK-1.7.3 — Job de sanidade e (se pronto) expurgo de anamnese expirada (Leonardo).**
Um job echo/no-op que prova o pipeline enqueue→process→complete. Se o tempo permitir, ligar o expurgo de sessões de anamnese expiradas (72h) de US-1.3 como um job agendado — caso contrário, documentar o comando manual e deixar o gancho pronto para a Sprint 2.
**Conclusão:** job de sanidade verde no CI de integração; expurgo agendado ou comando documentado.

### Definição de Pronto (US-1.7 "validada")

- [ ] Tasks 1.7.1–1.7.3 concluídas.
- [ ] Filas registradas com os parâmetros de §6; WorkerFactory + DLQ handler + drenagem graciosa; job de sanidade verde.
- [ ] Nenhuma lógica de negócio de fila implementada (fora de escopo); senha do Redis via secret.
- [ ] **Validada por:** code review + teste de integração do pipeline de fila (enqueue/process/DLQ/drain) verde (US-1.8).

---

## US-1.8 — QA de fluxo, isolamento multi-tenant e revisão de segurança

**Agentes:** Mariana (lead — testes, cobertura, quality gate) · Sato (revisão de segurança: RLS, cifra, pentest da anamnese, auth).
**Depende de:** US-1.1 a US-1.7 (há o que testar). **Alimenta** o CI da Sprint 0 (quality gate).
**Habilita:** a entrada segura da Sprint 1 em `main` e a disciplina de qualidade das próximas sprints.

### Jornada

A Sprint 1 é a primeira a manipular dado de saúde real, então o QA de Mariana e a revisão de Sato deixam de ser "smoke" e passam a incluir **isolamento multi-tenant** e o **pentest do formulário de anamnese** (Sato §8.2). Mariana escreve os testes de fluxo (anamnese ponta a ponta, feliz e bloqueado), os testes de isolamento (RLS Postgres + namespacing Redis), os testes de auth (rotation, reuse, RBAC), e mantém a cobertura ≥ 80%. Sato executa (com Mariana) o checklist de pentest da anamnese e revisa RLS/cifra/auth conforme seus relatórios. Os testes de isolamento multi-tenant, que a Sprint 0 marcou como **reservados**, tornam-se **bloqueantes** agora que o código que eles protegem existe.

### Objetivo

Cobertura ≥ 80% do código de Sprint 1, testes de isolamento multi-tenant bloqueantes, pentest da anamnese sem achado HIGH, e revisão de segurança de Sato registrada — tudo integrado ao CI.

### Resultado esperado

O CI reprova qualquer PR que quebre isolamento de tenant, derrube cobertura abaixo de 80%, ou introduza um achado HIGH no pentest; o fluxo de anamnese (feliz e bloqueado) tem E2E verde; a revisão de Sato está anexada.

### Tasks

**TASK-1.8.1 — Testes de fluxo da anamnese (Mariana, com Leonardo/Felipe).**
Integração/E2E do funil: landing→início→3 blocos→consentimento→submit (caminho feliz) e o caminho **bloqueado** (PAR-Q de risco → tela de cuidado, sem geração). Cobrir salvamento por bloco, retomada por token, expiração 72h, e o bloqueio do bloco 2 sem consentimento.
**Conclusão:** E2E dos dois caminhos verde local e no CI.

**TASK-1.8.2 — Testes de isolamento multi-tenant (Mariana + Sato) — agora bloqueantes.**
Provar que: (a) uma query sob `runAsUser(A)` **não** retorna linhas do usuário B (RLS `FORCE` + `SET LOCAL`); (b) `movivo_app` não consegue burlar RLS; (c) chaves Redis são namespaced por `user_id` (helper da Sprint 0); (d) token de anamnese A não acessa sessão B (IDOR). Marcar como **gate bloqueante** no CI (promove o item "reservado" da Sprint 0).
**Conclusão:** testes de isolamento verdes e configurados como bloqueantes; um teste que simule vazamento cross-tenant falha o pipeline.

**TASK-1.8.3 — Testes de auth (Mariana).**
Cobrir: rejeição de `alg:none`/`HS256`; access expira em 15min; refresh rotation invalida o anterior; reuse de refresh invalida a família; logout via denylist Redis; RBAC barra role insuficiente; rate limit de login.
**Conclusão:** suíte de auth verde cobrindo os cenários de Sato §9.1.

**TASK-1.8.4 — Pentest do formulário de anamnese (Sato + Mariana).**
Executar o checklist de Sato §8.2: SQLi nos campos e JSONB (esperado: bloqueado por Drizzle parametrizado + Zod), XSS armazenado (campo livre renderizado depois no dashboard — output encoding + CSP), XSS refletido em erros, injeção NoSQL/JSONB, e o teste de **prompt injection via anamnese** (campo de lesão com instrução maliciosa — deve ser neutralizado; a defesa plena é do scrubber/Motor na Sprint 2, mas registrar o baseline). Registrar achados e severidade.
**Conclusão:** checklist executado; nenhum achado HIGH sem correção/exceção documentada; relatório anexado ao PR.

**TASK-1.8.5 — Quality gate da Sprint 1 e revisão de segurança de Sato (Mariana + Sato).**
Cobertura ≥ 80% sobre o código novo; wiring dos testes bloqueantes no CI (isolamento, auth, anamnese). Sato registra a revisão de segurança consolidada (RLS, cifra `pgcrypto`, token, auth) — conforme seus §4/§7.3/§8/§9. Atualizar o documento de quality gates da Sprint 0 marcando "isolamento multi-tenant" como **ativo/bloqueante**.
**Conclusão:** CI reprova PR abaixo de 80% ou que quebre isolamento; revisão de Sato registrada; documento de gates atualizado.

### Definição de Pronto (US-1.8 "validada")

- [ ] Tasks 1.8.1–1.8.5 concluídas.
- [ ] E2E do fluxo (feliz e bloqueado) verde; isolamento multi-tenant bloqueante; auth coberto; pentest sem HIGH.
- [ ] Cobertura ≥ 80%; gates integrados ao CI da Sprint 0.
- [ ] **Validada por:** review de Mariana + revisão de segurança de Sato registrada + CI verde com os novos gates ativos.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-1.1 | Fundação de segurança (RLS + pgcrypto + schema auth) | Leonardo | Sato | Sato (spec) + teste de isolamento (Mariana) |
| US-1.2 | CONSENT granular | Leonardo | Alexandre (texto) | **Alexandre (jurídico)** + review |
| US-1.3 | ANAMNESIS + gate PAR-Q bloqueante | Leonardo | Alexandre (PAR-Q), Sato (pentest) | Alexandre + Sato + Mariana |
| US-1.4 | AUTH (JWT + refresh + RBAC) | Leonardo | Sato | **Sato (segurança)** + Mariana |
| US-1.5 | Frontend landing | Felipe | Sofia (UX ref.) | Review + copy + smoke E2E |
| US-1.6 | Frontend formulário + consent + PAR-Q + confirmação | Felipe | Sofia (UX ref.) | Review + UX/copy + E2E |
| US-1.7 | BullMQ base | Leonardo | Henrique | Review + teste de integração de fila |
| US-1.8 | QA + revisão de segurança | Mariana | Leonardo, Felipe, Sato | Mariana + Sato + gate no CI |

> **Victor (IA) não participa da Sprint 1** — confirmado: não há geração de protocolo, LLM, RAG nem AI Coach nesta sprint. Victor entra na Sprint 2 (Motor Determinístico + LLMRouter). **Henrique** tem participação leve (US-1.7 e eventuais ajustes de CI/secret para as novas migrações e chaves JWT/pgcrypto).

## Critério de conclusão da Sprint 1 (aceite do Épico 1)

A Sprint 1 é **entregue** quando as 8 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. Um usuário do perfil do Cahuã percorre landing → 3 blocos → consentimento → submit, com progresso salvo e retomável por token.
2. O consentimento de saúde é granular, destacado, versionado e com trilha (IP/UA/timestamp); nenhum dado de saúde é persistido sem ele.
3. O gate PAR-Q **bloqueia de verdade** respostas de risco e marca revisão profissional — nunca é só flag.
4. `data_block_2` está **cifrado em repouso** (`pgcrypto`) e as tabelas de Sprint 1 estão sob **RLS `FORCE` com `SET LOCAL`**; um teste prova que um tenant não lê o dado do outro.
5. AUTH com JWT RS256 + refresh rotation seguro + RBAC pronto para as próximas sprints.
6. BullMQ configurado (filas de §6, WorkerFactory, DLQ, drenagem) e provado por job de sanidade.
7. Eventos de funil de anamnese instrumentados no PostHog.
8. CI verde; cobertura ≥ 80%; isolamento multi-tenant **bloqueante**; pentest da anamnese sem HIGH; toda entrega via PR + 6 checks (`main` protegida).

### Pré-requisitos / bloqueadores a resolver no início da sprint

- **[Conteúdo jurídico — Alexandre] Texto de consentimento de saúde e de marketing, versionado e imutável** (US-1.2, TASK-1.2.1): é insumo de conteúdo, não de engenharia. Sem ele aprovado, o formulário não pode coletar saúde (BLOQUEADOR 3 de Alexandre).
- **[Conteúdo clínico-jurídico — Alexandre/RT CREF] Conjunto autoritativo de perguntas do PAR-Q e mapa de respostas que disparam bloqueio** (US-1.3, TASK-1.3.3): engenharia implementa determinismo, mas precisa da lista oficial.
- **[Schema] Duas estruturas ausentes nas 9 tabelas da Sprint 0** — credencial/role do profissional e armazenamento de refresh token — nascem na US-1.1 (TASK-1.1.5); não são bloqueador externo, mas exigem nova migração já no início.
- **[Segredos] Gerar o par de chaves RS256 (`JWT_*_KEY_FILE`) e a chave `PGCRYPTO_KEY_FILE`** — reservados no `.env.example` da Sprint 0, mas precisam ser gerados como Docker Secrets locais e GitHub Secrets no CI (Henrique).
- **[Decisão a confirmar] `audit_logs` append-only garantido por banco fica na Sprint 5** — nesta sprint a trilha de consentimento vive na tabela `consents`. Confirmar com Alexandre e Sato que isso é suficiente para o consentimento de Sprint 1 (US-1.1/US-1.2).
- **[Marca] Lançamento público da landing/formulário permanece condicionado à liberação INPI (MOVIVO × VIVO)** — trava herdada de Alexandre/Kimura. Construir e testar é liberado; **go-live com usuário real** depende do parecer de PI (não bloqueia esta sprint de desenvolvimento).

### Handoff para a Sprint 2 (Pipeline de Protocolo)

Concluída a Sprint 1, a Sprint 2 (Motor Determinístico + LLMRouter + ProtocolGenerationWorker + integração AraraHQ) recebe: o usuário criado (`ONBOARDING`) e a `anamnesis_session` em `SUBMITTED` com `data_block_2` cifrado, o estado de `requires_professional_review` já resolvido pelo gate PAR-Q, o BullMQ com a fila `protocol-generation` registrada, o AUTH/RBAC para a assinatura do protocolo pelo `PROFESSIONAL`, e a fundação de RLS/cifra que a Sprint 2 vai estender. Antes de implementar o Motor Determinístico, Leonardo e Victor devem observar que ele exige **100% de cobertura** (§12.8 — vira bloqueante na Sprint 2) e que **nenhum identificador direto vai ao LLM** (PII Scrubber, §3.1). Este documento cobre **apenas** a Sprint 1; o planejamento da Sprint 2 será feito por Lucas depois, com o aprendizado desta.

---

*Documento de planejamento operacional da Sprint 1 — Lucas Monteiro (PM/PO). Escopo de: `ARQUITETURA.md` §10 (Sprint 1). Requisitos jurídicos de `06-relatorio-alexandre.md` (consentimento, gate PAR-Q). Requisitos de segurança de `11-relatorio-sato.md` §4/§7.3/§8/§9 (RLS, cifra, pentest, auth). UX de `09-relatorio-sofia.md` §§8-9, 13. Consistência de produto com os Épicos 1-2 de `08-relatorio-lucas.md`. Construído sobre a fundação entregue na Sprint 0 (`sprint-0-fundacao.md`).*
