# Decisão US-1.1 — Acesso token-scoped da anamnese anônima e modelo RLS

**Autor:** Leonardo (Backend, agente #13) · **Valida:** Sato (Segurança, §4/§7.3/§8.1)
**Data:** 2026-07-23 · **Revisão:** 2026-10-06 · **Escopo:** TASK-1.1.2 e TASK-1.1.4 · **Status:** revisado na auditoria RLS

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
| `runAsToken(cb, token)` | — (NULL) | `ANONYMOUS` | Fase anônima da anamnese |
| `runAsSystem()` | — (NULL) | `SYSTEM` | Criar usuário, login, migrar consentimento |

**Fase anônima — revisão RLS 2026-10-06:** o token opaco CSPRNG de 256 bits
é parametrizado no GUC LOCAL `app.current_anamnesis_token`. A política exige
essa correspondência tanto no lookup inicial quanto no INSERT da sessão nova,
inclusive quando a consulta omite o filtro `WHERE token`. Depois de resolver o
token, `runAsTokenScoped` limita leitura/UPDATE da anamnese e leitura/INSERT dos
consentimentos ao UUID da sessão validado pelo servidor. Sem token ou escopo,
nenhuma sessão órfã é visível. O handler nunca aceita `user_id` como credencial.
Tokens continuam sujeitos à expiração server-side e não devem aparecer em logs.

**Vínculo no submit:** o submit roda em `runAsSystem`, cria o `users` (`ONBOARDING`),
seta `anamnesis_sessions.user_id` e migra os consentimentos. A partir daí a linha é
protegida por RLS por `user_id` como as demais — provado no `security-foundation.int-spec`.

**Criação de usuário sob RLS — revisão de segurança 2026-10-05:** a policy de
INSERT de `users` exige `SYSTEM` ou `ADMIN`. Ausência de identidade/papel não
é autorização, e um titular não pode criar outra conta ou autocadastrar staff.
O onboarding público continua criando o aluno dentro de `runAsSystem`, após as
verificações do fluxo. Ver `docs/fitness-ia-whatsapp/11-auditoria-autorizacao-rls.md`.

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

## Fontes Consultadas

- https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- https://www.postgresql.org/docs/17/sql-createpolicy.html
