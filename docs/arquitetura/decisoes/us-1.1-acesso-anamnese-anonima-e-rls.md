# Decisão US-1.1 — Acesso token-scoped da anamnese anônima e modelo RLS

**Autor:** Leonardo (Backend, agente #13) · **Valida:** Sato (Segurança, §4/§7.3/§8.1)
**Data:** 2026-07-23 · **Escopo:** TASK-1.1.2 e TASK-1.1.4 · **Status:** proposto (aguarda review de Sato na US-1.8)

## Contexto

A sessão de anamnese começa **anônima**: `anamnesis_sessions.user_id` é `NULL` até o
submit (Sofia §8.1). A RLS por `current_user_id` não consegue isolar uma linha que
ainda não tem titular. Além disso, dois fluxos legítimos operam **sem** usuário
autenticado: o onboarding cria o `users` no submit, e o login busca o profissional por
credencial. As policies não podem travar esses caminhos.

## Decisão

Três contextos de execução no `TenantDatabase` (`SET LOCAL` via `set_config(...,true)`),
distinguidos pelo GUC `app.current_role`:

| Contexto | `app.current_user_id` | `app.current_role` | Uso |
|---|---|---|---|
| `runAsUser(id, role)` | UUID do titular | `USER`/`PROFESSIONAL`/`ADMIN` | Todo acesso autenticado |
| `runAsToken()` | — (NULL) | `ANONYMOUS` | Fase anônima da anamnese |
| `runAsSystem()` | — (NULL) | `SYSTEM` | Criar usuário, login, migrar consentimento |

**Fase anônima (token-scoped, não user-scoped):** enquanto `user_id IS NULL`, o isolamento
**não** é dado pela RLS e sim pelo **token opaco** (`crypto`, 122 bits) + `WHERE token = $1`
na aplicação. O handler **nunca** aceita `user_id` do cliente para localizar a sessão
(proteção IDOR — Sato §8.1). A policy de `anamnesis_sessions` só **permite** ler/gravar
linha sem titular quando `app.current_role = 'ANONYMOUS'`; ela não substitui o filtro por
token. Consequência aceita e documentada: no contexto `ANONYMOUS`, a RLS por si só não
distingue uma sessão anônima de outra — por isso o token de alta entropia é a credencial,
e ele nunca vai para log/URL sem `Referrer-Policy: no-referrer` (aplicado na US-1.3).

**Vínculo no submit:** o submit roda em `runAsSystem`, cria o `users` (`ONBOARDING`),
seta `anamnesis_sessions.user_id` e migra os consentimentos. A partir daí a linha é
protegida por RLS por `user_id` como as demais — provado no `security-foundation.int-spec`.

**Criação de usuário sob RLS:** a policy de INSERT de `users` libera quando
`current_setting('app.current_user_id', true) IS NULL` (contexto anônimo/sistema) ou
quando a linha é o próprio titular. Assim o onboarding público insere sem travar, e um
titular autenticado não consegue inserir usuários arbitrários.

## Armadilha resolvida — FORCE RLS × seed/migração de dados

`FORCE ROW LEVEL SECURITY` sujeita **até o dono da tabela** (`movivo_migrator`) à RLS.
O `seed.ts` roda como `movivo_migrator` sem contexto de tenant e seria bloqueado pela
policy de INSERT/SELECT. **Decisão:** conceder `BYPASSRLS` ao `movivo_migrator`
(`infra/postgres/init/02-roles.sh`). É seguro porque essa role **nunca** serve tráfego
de runtime (exclusivo de `movivo_app`, que permanece `NOBYPASSRLS`, não-dona e sob FORCE).
É a role de manutenção que bypassa a RLS; a de aplicação, jamais. O boot do Postgres agora
**verifica** ambos os invariantes (migrator com BYPASSRLS, app sem) e o runner de migração
confirma ENABLE+FORCE em toda tabela de titular.

## Alternativas descartadas

- **Seed setando `SET LOCAL` por linha:** exigiria pré-gerar UUIDs e não cobre futuras
  migrações de dados; frágil.
- **`OR current_user = 'movivo_migrator'` embutido em cada policy:** polui toda policy
  com um caminho de bypass — pior de auditar que o atributo `BYPASSRLS` explícito.
- **`BYPASSRLS` em `movivo_app`:** proibido (regra inegociável #8 / Sato §4).
