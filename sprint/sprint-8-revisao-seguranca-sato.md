# Revisão de Segurança Consolidada — Sprint 8 (Os Dados Que Nunca Foram Gravados)

**Revisor:** Sato (Distinguished Security Engineer) · **Tasks:** TASK-8.9.1, 8.9.6, 8.9.7 · **Data:** 2026-08-13

## Veredito

**APROVADO COM RESSALVAS** — a superfície financeira nova está sólida. Nenhuma
vulnerabilidade explorável foi encontrada. Dois **gaps de cobertura** foram corrigidos nesta
revisão (um vazamento latente de payload de gateway em log e a ausência total de teste sobre
as defesas do controller do webhook). Com as correções aplicadas e testadas, a Sprint 8 pode
entrar em `main`.

O que sustenta o veredito: as três defesas do webhook (rate limit → teto de corpo →
assinatura antes de qualquer efeito) estão na ordem certa e a idempotência está **no banco**,
não em código. Correção de valor monetário é estorno em toda a superfície — não existe um
único `@Put`/`@Patch`/`@Delete` nos quatro controllers financeiros.

## Escopo verificado

Leitura direta do código, não do resumo dos agentes anteriores:

| Área | Arquivo(s) | Resultado |
|---|---|---|
| Webhook — autenticação e veredito | `subscription/payment-webhook.controller.ts`, `payment-webhook.service.ts` | OK |
| Webhook — idempotência no banco | `payment-reconciliation.worker.ts`, `drizzle/*payments*` | OK |
| Webhook — rate limit e teto de corpo | `payment-webhook.controller.ts`, `main.ts` | OK, **sem teste — Achado 2** |
| `raw_payload` fora do log | `payment-webhook.service.ts`, `payment-reconciliation.worker.ts`, `jobs/dlq.handler.ts` | **Achado 1 — corrigido** |
| Imutabilidade das 5 tabelas novas | `core/database/security-policies.ts` | OK |
| Cap table fecha em 10.000 bps | `drizzle/0025_partners.sql`, `schema/partners.ts` | OK |
| Ausência de `UPDATE` de valor monetário | `finance/marketing/partners/payment-webhook.controller.ts` | OK |
| `PARTNERS_READ`/`PARTNERS_WRITE` | `packages/shared/src/rbac/capabilities-by-role.ts`, `partners.controller.ts` | OK |
| PII/valor financeiro em log | `admin/finance.service.ts`, `marketing.service.ts`, `partners.service.ts` | OK |
| Ressalva 1 da Sprint 7 (redirect) | `apps/web/src/app/dashboard/_lib/session.ts` + 14 `page.tsx` | **Fechada** |

TASK-8.9.2 (imutabilidade em banco real), 8.9.3 (RBAC) e 8.9.4 (conferência numérica) são de
Mariana e não foram duplicadas aqui — o que segue é a verificação de segurança sobre o mesmo
código, por outro eixo.

---

## TASK-8.9.1 — Webhook de liquidação

### Autenticação e rejeição registrada — OK

`PaymentWebhookService.ingest` nunca lança ao chamador: devolve `REJECTED` para corpo ausente
e para assinatura inválida, e o controller traduz para **401 uniforme**. Confirmo o que o
agente da US-8.5 relatou: o 401 é o mesmo para `missing_body` e `bad_signature`, e a mensagem
é genérica (`'assinatura inválida'`) — **não vaza qual verificação falhou** (T-15 do relatório
original). O motivo real fica só no log estruturado, em `warn`.

Ordem correta e crítica: `gateway.parseWebhookEvent(rawBody, signature, timestamp)` roda
**antes** de qualquer persistência ou enfileiramento. Nada é gravado nem enfileirado por um
evento não autenticado — verificado linha a linha, não por comentário.

Registro da rejeição confirmado por teste existente:
`payment-webhook.service.spec.ts` → `'rejeição é REGISTRADA no log — tentativa de forja não é
descartada em silêncio'`, que assere `logger.warn` com `event: 'webhook_rejected'`. Descartar
em silêncio apagaria o único sinal de tentativa de fraude, e isso não acontece.

### Idempotência — OK, e garantida pelo banco

A garantia é `onConflictDoNothing({ target: [payments.gateway, payments.gatewayEventId] })`
sobre a UNIQUE `(gateway, gateway_event_id)`, no `PaymentReconciliationWorker`. Confirmo que
**não** é checagem em código: o `SET NX` do Redis e o `jobId` determinístico do BullMQ existem,
mas são otimizações de fila, não a barreira.

A decisão de enfileirar a conciliação **antes** do dedup do Redis está certa e merece registro:
se o Redis barrasse primeiro, uma queda entre o `SET NX` e o enqueue perderia a receita
permanentemente. Deixando o banco decidir, 5 entregas → 1 linha, e a receita agregada não muda.
Coberto por `'reentrega (dedup do Redis) ainda enfileira a conciliação, mas não reaplica a
transição'`.

### `raw_payload` no log — ACHADO 1 (corrigido)

**Severidade: Baixa hoje, Média no lançamento.** Não é exploração remota; é um vazamento
latente que se ativa por uma mudança de infraestrutura, não por uma mudança no webhook.

O caminho do payload estava correto onde eu esperava: o `PaymentWebhookService` não loga o
corpo (teste `'o payload bruto NUNCA vai para o log de aplicação'` prova isso com um número de
cartão plantado), e o `PaymentReconciliationWorker` loga só `gateway`/`status`/`correlationId`.

O buraco está fora do módulo. `rawPayload` viaja no `data` do job de conciliação, e
`toDeadLetterRecord` (`jobs/dlq.handler.ts:52`) copia **`job.data` inteiro** para o
`DeadLetterRecord`. O `LoggingDeadLetterHandler` atual não serializa `data`, então nada vaza
hoje — mas o cabeçalho do próprio arquivo declara a premissa que a US-8.5 acabou de invalidar:

> *"O payload nunca carrega PII em claro (§ payload de job = `userId` UUID)"*

O handler real (Sentry + fallback WhatsApp, previsto para uma sprint futura) vai serializar
`record.data`, e nesse dia o payload de cobrança do gateway sai para um terceiro sem que
ninguém toque em uma linha do webhook. Além disso, `rawPayload` não estava em `PII_FIELDS`
nem em `REDACT_PATHS` — ou seja, estava fora da camada estrutural do pino também.

**Correção aplicada** (`apps/api/src/core/logger/redaction.util.ts`): `rawPayload` e
`raw_payload` entram em `PII_FIELDS`. Isso fecha as duas camadas de uma vez — os caminhos do
pino (`rawPayload`, `data.rawPayload`, `*.rawPayload`, …) e o `redactObject` para serialização
manual. É redação por **nome de campo**, então vale para todo log presente e futuro, sem
depender de quem escrever o próximo handler lembrar da regra.

Teste novo em `redaction.util.spec.ts`: `'redige o payload bruto do gateway de pagamento, na
raiz e dentro de `data`'` — verifica os três caminhos e prova, com o mesmo número de cartão
plantado, que um `DeadLetterRecord` redigido não o contém.

### Rate limit e teto de corpo — ACHADO 2 (corrigido)

Os dois **existem** e estão corretos:

- `@Throttle({ default: { limit: 30, ttl: 60_000 } })` + `@UseGuards(ThrottlerGuard)` no
  `payment(...)`. 30/min por IP: folgado para a reentrega esparsa e com backoff de um gateway
  legítimo, apertado para quem varre a rota testando assinaturas. Sem isso, um endpoint
  público que calcula HMAC a cada request é um amplificador de CPU.
- `app.useBodyParser('json', { limit: PAYMENT_WEBHOOK_BODY_LIMIT })` no `main.ts`, com a
  constante (`'100kb'`) exportada pelo controller. O valor é o mesmo default do express — o
  ganho não é apertar, é parar de depender de um default implícito numa rota pública.

**O gap:** `grep` por `PAYMENT_WEBHOOK_BODY_LIMIT` e `Throttle` em `apps/api/src/**/*.spec.ts`
retornava **zero**. Não havia um único teste sobre o controller do webhook — nem sobre o
status 401, nem sobre o rate limit, nem sobre o teto de corpo. A TASK-8.9.1 pede explicitamente
"corpo excessivo e rate limit cobertos". Essas três defesas não são quebradas de propósito;
são quebradas por remoção acidental num refactor, e sem teste isso passa no CI em silêncio.

**Correção aplicada:** `apps/api/src/modules/subscription/payment-webhook.controller.spec.ts`
(novo, 5 testes):

1. `REJECTED` → `UnauthorizedException` (401, nunca 200, nunca 500);
2. a mensagem do 401 não contém `timestamp`/`hmac`/`body`/`replay`/`expired` — **prova
   automatizada da uniformidade**, não confiança no comentário;
3. `ACCEPTED` → `{ ok: true }` repassando corpo bruto, assinatura e correlation id;
4. o handler carrega a metadata de throttle 30/60s **e** o `ThrottlerGuard`;
5. `PAYMENT_WEBHOOK_BODY_LIMIT === '100kb'`.

Remover o `@Throttle`, trocar o 401 por 200 ou detalhar o motivo da rejeição passa a falhar o
pipeline.

---

## Imutabilidade e ausência de `UPDATE` de valor

`security-policies.ts` aplica o mesmo molde já provado na Sprint 7 (`audit_logs`,
`agent_config`) às cinco tabelas novas. Verifiquei as **três** camadas em cada uma:

| Tabela | Trigger `BEFORE UPDATE OR DELETE` | Trigger `BEFORE TRUNCATE` | `REVOKE UPDATE, DELETE, TRUNCATE FROM movivo_app` |
|---|---|---|---|
| `user_status_transitions` | ✅ | ✅ | ✅ (grant reduzido a `SELECT, INSERT`) |
| `expenses` | ✅ | ✅ | ✅ |
| `payments` | ✅ | ✅ | ✅ |
| `ad_spend` | ✅ | ✅ | ✅ |

Três detalhes que separam isso de imutabilidade decorativa: (a) o trigger `TRUNCATE` é
`FOR EACH STATEMENT` — `TRUNCATE` não dispara triggers de linha, e sem ele o `REVOKE` seria a
única defesa; (b) `REVOKE ALL ON FUNCTION ... FROM PUBLIC` impede que a própria função de
rejeição seja executada/redefinida por quem não deveria; (c) o `REVOKE` vem **depois** do grant
genérico, então a ordem no arquivo importa e está certa.

RLS por titular: `workout_completions`, `user_status_transitions` e `payments` estão na lista
com `column: 'user_id'` e `professional: 'read'` — o RT CREF lê, não escreve. `expenses`,
`ad_spend` e `partners` ficam **fora** da RLS por titular de propósito e corretamente: são
dado de negócio, não de titular; o corte deles é por capability, não por dono da linha.

**Cap table fecha em 10.000 bps:** `0025_partners.sql` — `ck_partners_share_range` limita cada
linha a `> 0 AND <= 10000`, e `trg_partners_share_total` é um `CONSTRAINT TRIGGER ...
DEFERRABLE INITIALLY DEFERRED` que soma as linhas vigentes (`valid_to IS NULL`) **no commit**.
Deferir é o que torna o versionamento possível: a substituição do cap table inteiro passa por
um estado intermediário inválido dentro da transação, e só o estado final é julgado. Um cap
table que não fecha é rejeitado pelo banco, não pela aplicação.

**Ausência de `UPDATE` de valor monetário — confirmado por varredura.** `@Put`, `@Patch` e
`@Delete` em `finance.controller.ts`, `marketing.controller.ts`, `partners.controller.ts` e
`payment-webhook.controller.ts`: **zero ocorrências**. Só `@Get` e `@Post`, e as duas rotas de
correção são `POST expenses/:id/reverse` e `POST ad-spend/:id/reverse` — estorno, exatamente a
regra. `POST partners` substitui a vigência inteira em vez de editar um sócio isolado, o que é
o que mantém a soma verificável.

---

## `PARTNERS_READ` / `PARTNERS_WRITE`

As três condições pedidas, confirmadas em `capabilities-by-role.ts`:

1. **Só `ADMIN` alcança.** `FINANCE` recebe exatamente `[FINANCE_READ, FINANCE_WRITE]` — as
   capabilities de cap table não aparecem na entrada dele, e o comentário no código registra o
   porquê (cap table é de sócio, não do setor financeiro). Nenhum outro papel as recebe.
2. **`ADMIN` as recebe por herança**, via `ALL_CAPABILITIES.filter(não estar na denylist)`.
3. **Fora da `ADMIN_INHERITANCE_DENYLIST`** — correto, e por um motivo que vale registrar: a
   denylist existe para separar administração de sistema de **aprovação de conteúdo clínico**
   (é o que sustenta a defensabilidade da supervisão CREF). Cap table não é conteúdo clínico;
   pôr `PARTNERS_*` ali diluiria o significado da denylist e tornaria a exceção uma lista de
   "coisas sensíveis" genérica.

`partners.controller.ts` exige `PARTNERS_READ` na leitura e **`PARTNERS_READ` + `PARTNERS_WRITE`**
na escrita (AND, mesma semântica do guard). Já coberto por `partners.service.spec.ts:162-175`,
que inclusive assere a ausência nas duas pontas — nenhum papel não-ADMIN as concede, e elas não
estão na denylist. Nada a acrescentar.

Nenhuma capability financeira nova toca `STUDENTS_HEALTH_READ`: `finance.service.ts`,
`marketing.service.ts` e `partners.service.ts` não referenciam anamnese, check-in, protocolo ou
PAR-Q.

---

## Dado financeiro sensível em log

Varredura de `logger.` e `console.` em `finance.service.ts`, `marketing.service.ts` e
`partners.service.ts`: **zero ocorrências**. Nenhum valor de despesa, nenhum bps por sócio,
nenhum lucro apurado passa por log de aplicação — os números vivem na resposta HTTP autorizada
e na tabela, e em nenhum outro lugar. É o resultado certo, ainda que por omissão: o custo é que
não há trilha operacional desses módulos, o que é aceitável enquanto a trilha real for
`audit_logs`.

Payload de gateway: coberto pelo Achado 1 acima. Correlation id e id de evento (hasheado com
SHA-256 antes de virar chave de Redis/`jobId`) são o que se registra — suficiente para
correlacionar, insuficiente para reconstruir a cobrança.

**Entrada não confiável de UTM (US-8.2):** a captura vem do navegador e é, por definição,
controlada pelo visitante. Verifiquei que os valores são validados na fronteira por schema e
usados como **chave de agregação**, nunca concatenados em SQL — a `sql.identifier()` do Drizzle
(vetor do CVE-2026-39356, abaixo) não é alimentada por UTM em nenhum ponto. O risco residual é
poluição da taxonomia de canal (alguém empurrando UTMs falsas para sujar o CAC), que é
integridade de métrica, não de segurança, e é mitigável por allowlist de canal quando houver
volume real.

---

## Status das ressalvas herdadas da Sprint 7

### Ressalva 1 — título de rota no shell sem capability: **FECHADA** ✅

Confirmo o fechamento e a cobertura das rotas novas. `requireDashboardCapability`
(`apps/web/src/app/dashboard/_lib/session.ts`) resolve a sessão no **servidor**, exige TODAS as
capabilities da rota (AND, mesma semântica de `roleHasCapabilities` no backend — um OR aqui
renderizaria páginas que o backend devolveria 403) e, na falta, faz `redirect()` **antes** de
qualquer render. A moldura do shell não chega a ser montada.

Aplicada em **14 rotas**, incluindo todas as desta sprint:
`/dashboard/socios` (`control_center.partners.read`), `/dashboard/financeiro`
(`finance.read`), `/dashboard/analytics` (`marketing.read`). Nenhuma página nova ficou de fora
— conferido rota a rota contra a árvore de `app/dashboard/`.

O redirect vai para `/dashboard`, que por sua vez encaminha para `landingPathForRole(...)`
quando o papel não tem `overview.read`, e para `/entrar?erro=sem-permissao` quando não há
destino algum. São dois saltos em vez de um, mas o destino final é a rota padrão do papel, que
é o que a ressalva pedia. Sem objeção.

### Ressalva 2 — `nextVersion` sem lock: **ACEITA, sem ação** ⏸️

Inalterada e inalterada de propósito. Colisão de duas publicações simultâneas falha a segunda
no UNIQUE; nada grava errado. `ponytail:` já documentado no código. Não revisitei.

### Ressalva 3 — `detectInjection` é denylist: **NO RADAR, sem ação** ⏸️

Inalterada. Ainda não há produção, logo ainda não há dados reais de tentativa para calibrar os
padrões. Nada nesta sprint aumentou a exposição (a superfície financeira não alimenta prompt).
Permanece o pedido: revisar quando houver telemetria real.

---

## TASK-8.9.6 — Revalidação de CVEs

**Declaração explícita: a Sprint 8 não introduziu nenhuma dependência nova.** `git diff
ed533af..HEAD` sobre todo `package.json` e `pnpm-lock.yaml` mostra **uma única linha alterada**
— um script `db:backfill-transitions` em `apps/api/package.json`. Zero pacotes adicionados. O
webhook usa o `MockGateway` existente; **nenhum SDK de gateway de pagamento real entrou**, e o
adaptador Stripe segue como seam de lançamento em `real-gateways.ts`. Confirmado, como o
enunciado previa.

Revalidação das três dependências nomeadas no fecho da Sprint 7:

| Dependência | Versão no repo | Advisory relevante | Situação |
|---|---|---|---|
| `drizzle-orm` | **0.45.2** (pin exato) | **CVE-2026-39356** — SQL injection por identificador mal escapado em `sql.identifier()`/`sql.as()`, CVSS 7.5 | **Não afetado.** A versão corrigida é ≥ 0.45.2 e o repo já está exatamente nela. |
| `pgvector` | imagem `pgvector/pgvector:pg17` | **CVE-2026-3172** — buffer overflow em build paralelo de índice HNSW, corrigido em pgvector 0.8.2 (fev/2026) | **Não afetado na prática**, com ressalva de supply chain (abaixo). |
| SDK da OpenAI | **não é dependência** | (n/a) | Nenhum pacote `openai`/`@anthropic-ai` em `package.json`. A revalidação fica pendente para a sprint que introduzir o cliente de LLM real. |

**Nenhuma vulnerabilidade alta ou crítica afeta o repo — a TASK-8.9.6 não bloqueia o fecho da
sprint.**

Sobre o `drizzle-orm`: o pin exato (`"0.45.2"`, sem `^`) foi o que evitou a exposição, e o
vetor do CVE — identificador de tabela/coluna vindo de fonte não confiável — é exatamente o
padrão que a US-8.2 poderia ter introduzido com UTM. Não introduziu (verificado acima), mas a
combinação merece atenção permanente.

**Observação para Henrique (não bloqueante):** `pgvector/pgvector:pg17` é uma **tag flutuante**,
não um digest. Isso hoje ajuda (um `pull` traz a build já com pgvector ≥ 0.8.2 e os patches de
PostgreSQL do ciclo 2026 — incluindo os de `pgcrypto`, CVE-2026-2005/2006, RCE), mas é uma
faca de dois gumes: a mesma tag pode mudar debaixo do ambiente sem registro, e ambientes
provisionados em datas diferentes divergem em silêncio. **Recomendação:** pinar por digest
(`pgvector/pgvector:pg17@sha256:...`) e atualizar deliberadamente, com Renovate/Dependabot
abrindo o PR. É decisão de plataforma, não bloqueia esta sprint.

---

## Correções aplicadas nesta revisão

| # | Arquivo | Mudança |
|---|---|---|
| 1 | `apps/api/src/core/logger/redaction.util.ts` | `rawPayload` e `raw_payload` entram em `PII_FIELDS` — fecha o vazamento latente do `DeadLetterRecord` nas duas camadas de redação. |
| 2 | `apps/api/src/core/logger/redaction.util.spec.ts` | Teste novo: os três caminhos redigidos + prova com número de cartão plantado. |
| 3 | `apps/api/src/modules/subscription/payment-webhook.controller.spec.ts` | **Novo.** 5 testes: 401, uniformidade do 401, 200 com repasse, rate limit 30/60s + guard, teto de corpo. |

Nenhuma mudança de comportamento de produção — o Achado 1 é redação defensiva e o Achado 2 é
cobertura. Suíte verde (17/17 nos dois arquivos), `tsc --noEmit` e `lint` limpos.

---

## Recomendações para o fecho e para a Sprint 9

1. **Ao trocar o `MockGateway` pelo Stripe/Asaas real**, esta revisão precisa ser refeita no
   ponto do adaptador: `stripe-signature` carrega timestamp e assinatura no mesmo header e
   exige verificação de **janela temporal** (anti-replay) que o mock não modela. É o único
   lugar onde o resultado deste relatório não se transfere.
2. **Substituir o `LoggingDeadLetterHandler` pelo handler real (Sentry)** é o momento de
   reverificar o Achado 1 na prática: a redação por nome de campo está lá, mas um handler que
   serialize com `JSON.stringify` fora do pino não passa por `REDACT_PATHS` — tem que chamar
   `redactObject` explicitamente.
3. **Allowlist de canal para UTM** quando houver tráfego pago real, para proteger a integridade
   do CAC contra poluição de origem.
4. **Pinar as imagens Docker por digest** (item de Henrique, acima).

## Fontes consultadas

- [Drizzle ORM SQL injection via improperly escaped SQL identifiers — CVE-2026-39356 (GitHub Advisory GHSA-gpj5-g38j-94v9)](https://github.com/advisories/GHSA-gpj5-g38j-94v9)
- [CVE-2026-39356 — SQL Injection in drizzle-orm (Snyk)](https://security.snyk.io/vuln/SNYK-JS-DRIZZLEORM-16000009)
- [pgvector 0.8.2 Released — correção do CVE-2026-3172 (PostgreSQL.org)](https://www.postgresql.org/about/news/pgvector-082-released-3245)
- [Amazon RDS for PostgreSQL release notes — fix do CVE-2026-3172](https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-versions.html)
- [CVE-2026-2005 — PostgreSQL pgcrypto heap buffer overflow levando a RCE (ZeroDay.cloud)](https://www.zeroday.cloud/blog/postgres-xint)
- [Our response to the TanStack npm supply chain attack (OpenAI)](https://openai.com/index/our-response-to-the-tanstack-npm-supply-chain-attack/)

**Limitação declarada:** a pesquisa web cobriu apenas a TASK-8.9.6 (advisories de dependência),
única task do documento que a exige. O restante da revisão é leitura de código do repositório.
A busca não retornou advisory específico para `@nestjs/throttler` 6.x nem para
`edoburu/pgbouncer` 1.24 — ausência de resultado não é prova de ausência de vulnerabilidade, e
ambos entram na próxima revalidação.
