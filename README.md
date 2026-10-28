# MOVIVO

> **Move your potential.**

**MOVIVO** é uma assessoria de movimento, performance e bem-estar entregue via **WhatsApp**.
Agentes de IA montam e ajustam o plano de cada pessoa (musculação, corrida, HYROX ou híbrido, mais
alimentação) **dentro de políticas versionadas escritas por profissionais** registrados nos
conselhos (CREF, CRN e CRM). O profissional entra por exceção: sinal de segurança, situação sem
política aplicável ou pedido de revisão. O modelo de linguagem nunca escreve nada diretamente: ele
devolve uma proposta tipada, e o código valida, decide e executa.

Este repositório é um **monorepo** (pnpm workspaces + Turborepo). O contexto de produto, a
arquitetura e as regras de trabalho estão em [`CLAUDE.md`](CLAUDE.md).

---

## Sumário

- [Requisitos](#requisitos)
- [Estrutura do monorepo](#estrutura-do-monorepo)
- [Setup rápido](#setup-rápido)
- [Ambiente e segredos](#ambiente-e-segredos)
- [Ambiente local (Docker Compose)](#ambiente-local-docker-compose--dados--aplicação-espelho-da-produção)
- [Scripts da raiz](#scripts-da-raiz)
- [Backend (`apps/api`)](#backend-appsapi)
- [Banco de dados](#banco-de-dados-schema-migrações-e-seed)
- [Frontend (`apps/web`)](#frontend-appsweb)
- [O pacote `@movivo/shared`](#o-pacote-movivoshared)
- [Testes](#testes)
- [Padrões de código](#padrões-de-código)
- [Regras inegociáveis](#regras-inegociáveis)
- [Convenção de commits](#convenção-de-commits)

---

## Requisitos

| Ferramenta | Versão fixada       | Onde está fixada                           |
| ---------- | ------------------- | ------------------------------------------ |
| Node.js    | `22.22.0`           | `.nvmrc` / `.node-version` / `engines`     |
| pnpm       | `11.15.1`           | `packageManager` no `package.json` da raiz |
| TypeScript | `5.9.3`             | devDependency da raiz e de cada workspace  |
| Turborepo  | `2.10.6`            | devDependency da raiz                      |
| Docker     | 29+ com Compose v2+ | necessário para o ambiente local           |

Ative o pnpm via Corepack:

```bash
corepack enable
corepack prepare pnpm@11.15.1 --activate
```

> **Por que TypeScript 5.9 e não 7.x?** O `typescript-eslint` (v8) declara peer
> `typescript >=4.8.4 <6.1.0`. Subir para TS 6/7 hoje quebraria o lint de todo o monorepo.
> A migração é uma decisão consciente e adiada, a ser revisitada quando o `typescript-eslint`
> suportar a linha 7.

---

## Estrutura do monorepo

```
/
├─ apps/
│  ├─ api/                 # Backend, monólito modular NestJS (porta 3001)
│  │  ├─ src/core/         # infraestrutura: config, database, ai, agents, redis, logger…
│  │  ├─ src/modules/      # domínios: anamnesis, planning, training, nutrition, coaching…
│  │  ├─ drizzle/          # migrações versionadas
│  │  └─ test/             # testes de integração (Postgres e Redis reais)
│  └─ web/                 # Frontend, Next.js App Router (porta 3000)
│     ├─ src/app/          # páginas do aluno (links mágicos) e do painel interno (/dashboard)
│     └─ e2e/              # Playwright (painel e anamnese) com mock da API
├─ packages/
│  └─ shared/              # @movivo/shared: enums, schemas Zod e contratos back ↔ front
├─ infra/                  # Postgres, PgBouncer, Redis, nginx e deploy da VPS
├─ scripts/                # segredos locais, subir/verificar o ambiente
├─ eslint.config.mjs · tsconfig.base.json · turbo.json · knip.jsonc
└─ CLAUDE.md · AGENTS.md · README.md
```

---

## Setup rápido

```bash
git clone https://github.com/Os-Guri-do-Vibe/movivo.git
cd movivo
corepack enable
pnpm install
pnpm run build
```

Validação completa da fundação (o mesmo que o CI roda):

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run format:check
```

---

## Ambiente e segredos

> **Nenhum segredo real entra no Git — nunca.** Só `*.env.example` com placeholders.

### 1. Gere os segredos locais

Valores aleatórios e descartáveis, gravados em `secrets/desenvolvimento/` (100% ignorado pelo Git; `secrets/producao/` guarda as chaves de fornecedores de produção):

```bash
# Linux, macOS ou Git Bash no Windows
bash scripts/gen-local-secrets.sh
```

```powershell
# Windows nativo (equivalente 1:1 do script bash)
powershell -ExecutionPolicy Bypass -File scripts/gen-local-secrets.ps1
```

Idempotente: rodar de novo não sobrescreve. Para rotacionar tudo, use `--force`
(bash) / `-Force` (PowerShell) e depois recrie os volumes do Postgres.

### 2. Copie os arquivos de ambiente

```bash
cp .env.example .env                        # raiz — perfil do Docker Compose
cp apps/api/.env.example apps/api/.env      # API rodando no host
cp apps/web/.env.example apps/web/.env.local
```

### 3. Como a aplicação lê um segredo — contrato `*_FILE`

Nenhuma senha aparece em `environment:` do Compose (vazaria em `docker inspect`).
Os valores são montados como **Docker Secrets** em `/run/secrets/*` e a aplicação
os lê pelo par `<VAR>_FILE`:

| Precedência | Origem                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1º          | `<VAR>_FILE` — caminho de arquivo. **Vence sempre.** Arquivo ausente/vazio = falha fatal no boot, nunca fallback silencioso. |
| 2º          | `<VAR>` — env direta.                                                                                                        |
| 3º          | Ausente → o `ConfigModule` falha rápido no boot (Zod), citando os dois nomes.                                                |

Caminho absoluto vale como está (`/run/secrets/...` no container); caminho relativo
resolve contra o `cwd` do processo (`../../secrets/desenvolvimento/...` rodando no host).

### 4. Regras que valem para qualquer variável

- A aplicação conecta no Postgres **sempre na 5433** (PgBouncer). Nunca na 5432.
  A única exceção é o `drizzle-kit`, que migra na 5432 como `movivo_migrator`.
- `NEXT_PUBLIC_*` vai para o bundle do browser: **jamais** um segredo ali.
- Nada sensível em log, erro, span de telemetria ou resposta de `/health`.

---

## Ambiente local (Docker Compose) — dados + aplicação, espelho da produção

> Definido em [`docker-compose.yml`](docker-compose.yml) +
> [`docker-compose.secrets.yml`](docker-compose.secrets.yml) (puxado por `include:`)
> e nas configs de [`infra/`](infra). **Pré-requisito: os segredos da seção
> anterior já gerados** — os containers falham no boot sem eles, de propósito.

### Subir tudo

```bash
pnpm run infra:up      # constrói e sobe TUDO; BLOQUEIA até 100% ficar healthy
pnpm run infra:verify  # roda o checklist completo de sanidade e segurança
```

O `infra:up` sobe os mesmos containers da VPS (`infra/vps/docker-compose.prod.yml`):
dados, **migração** (one-shot), **API** e **web**, estes dois construídos dos mesmos
Dockerfiles da produção (`NODE_ENV=production`, usuário não-root). Web em
http://localhost:3000 e API em http://localhost:3001/api/v1. A API lê o **mesmo**
`infra/vps/api.env` da VPS; só as URLs mudam (bloco `environment:` do serviço `api`).

- **Pré-requisito extra:** as chaves de terceiros em `secrets/desenvolvimento/` (`asaas_api_key`,
  `openai_api_key`, `deepseek_api_key`, `anthropic_api_key`, `groq_api_key`)
  são exclusivas de desenvolvimento. O `deploy.sh` só provisiona credenciais de produção
  a partir de `secrets/producao/` (ou de `PRODUCTION_SECRETS_DIR`). Com
  `NODE_ENV=production` a API recusa subir sem OpenAI e sem Asaas (Sandbox).
- **Mudou código?** Rode `pnpm run infra:up` de novo (reconstrói só o que mudou).
  `pnpm run infra:rebuild` refaz as imagens sem cache.
- **Sem Nginx/TLS/Cloudflare:** o browser fala direto com web e API em
  `http://localhost`. É a única diferença estrutural em relação à VPS.
- **Hot reload (`pnpm dev`):** pare os containers da aplicação (`docker compose stop api web`)
  ou deixe `COMPOSE_PROFILES=` vazio no `.env` para subir só os dados.
  O CI faz o segundo (job de integração).

Quem tem `make` (Linux/macOS/WSL) pode usar `make up` / `make verify` — os alvos
do [`Makefile`](Makefile) são equivalentes 1:1. No Windows, use os scripts pnpm.

### Serviços

| Serviço          | Imagem (fixada)                | Porta no host     | Papel                                             |
| ---------------- | ------------------------------ | ----------------- | ------------------------------------------------- |
| `postgres`       | `pgvector/pgvector:pg17`       | `127.0.0.1:5432`  | PostgreSQL 17 + `vector`, `uuid-ossp`, `pgcrypto` |
| `pgbouncer`      | `edoburu/pgbouncer:v1.24.1-p1` | `127.0.0.1:5433`  | Pooler em **transaction mode** — o caminho da app |
| `redis-master`   | `redis:8.2.2-alpine`           | `127.0.0.1:6379`  | Cache + filas BullMQ, AOF `everysec`              |
| `redis-replica`  | `redis:8.2.2-alpine`           | `127.0.0.1:6380`  | Réplica de leitura / alvo de failover             |
| `redis-sentinel` | `redis:8.2.2-alpine`           | `127.0.0.1:26379` | Descoberta do master (`movivo-master`, quorum 2)  |

Todas as portas são publicadas **apenas em `127.0.0.1`**. Publicar em `0.0.0.0`
numa VPS exporia o serviço na internet mesmo com UFW ativo, porque o Docker
escreve suas regras de iptables antes das do firewall.

### As duas portas do Postgres — leia antes de conectar

|                     | Runtime da aplicação | Migração / DDL                     |
| ------------------- | -------------------- | ---------------------------------- |
| Porta               | **5433** (PgBouncer) | 5432 (Postgres direto)             |
| Role                | `movivo_app`         | `movivo_migrator`                  |
| Quem usa            | NestJS, sempre       | `drizzle-kit`, `psql` de depuração |
| Prepared statements | **proibidos**        | permitidos                         |

A aplicação **nunca** abre conexão na 5432 (regra §12.3). A exceção da migração
existe porque `drizzle-kit` usa DDL e _advisory locks de sessão_, que não
sobrevivem ao transaction pooling. Consequências do transaction mode para quem
escreve código:

- `prepare: false` no driver (`DATABASE_PREPARE=false`).
- `LISTEN/NOTIFY` proibidos — use Redis Pub/Sub.
- `SET` de sessão não persiste; use `SET LOCAL` — que é exatamente o que a RLS
  exige (`SET LOCAL app.current_user_id`, `ARQUITETURA.md` §12.13).

> **Se a porta 5432 já estiver ocupada** na sua máquina (é comum ter um
> PostgreSQL nativo instalado), altere `HOST_POSTGRES_PORT` no seu `.env` — por
> exemplo `15432` — e ajuste `MIGRATION_DATABASE_PORT` em `apps/api/.env` para o
> mesmo valor. Nada mais muda: a 5433 continua sendo o caminho da aplicação.

### Roles do Postgres

Criadas pelo init em [`infra/postgres/init/`](infra/postgres/init):

- **`movivo_migrator`** — dono do schema `public`. Roda as migrações. Nunca usada em runtime.
- **`movivo_app`** — a única role da API. `NOBYPASSRLS`, sem `CREATE` no schema,
  nunca dona de tabela. É o que torna a RLS (isolamento entre titulares de dados
  de saúde) efetiva e não decorativa. `pnpm run infra:verify` falha se isso regredir.

### Redis com Sentinel

A aplicação **não** conecta no master pelo nome: ela pergunta ao Sentinel
(`REDIS_SENTINEL_HOSTS`, `REDIS_SENTINEL_MASTER_NAME=movivo-master`). O Sentinel
devolve o endereço anunciado, que é o hostname do serviço (`redis-master:6379`).

- API **dentro** do Compose: funciona direto, o DNS da rede `movivo-net` resolve.
- API **no host**: `redis-master` não resolve no Windows/macOS. Use o `natMap` do
  ioredis para mapear os nomes anunciados para as portas publicadas em loopback:

  ```ts
  new Redis({
    sentinels: [{ host: '127.0.0.1', port: 26379 }],
    name: 'movivo-master',
    natMap: {
      'redis-master:6379': { host: '127.0.0.1', port: 6379 },
      'redis-replica:6379': { host: '127.0.0.1', port: 6380 },
    },
  });
  ```

> **Failover não é exercitável localmente**, e isso é proposital: o quorum é 2
> (idêntico ao de produção, onde sobem 3 Sentinels) e em dev sobe apenas 1. Baixar
> o quorum para 1 mascararia em produção um erro que só apareceria num incidente.
> O ambiente local prova descoberta, autenticação e replicação — não o failover.

### Operação do dia a dia

| Comando                     | Equivalente `make` | O que faz                                                         |
| --------------------------- | ------------------ | ----------------------------------------------------------------- |
| `pnpm run infra:up`         | `make up`          | Constrói, sobe (dados + API + web) e espera `healthy`             |
| `pnpm run infra:rebuild`    | —                  | Refaz as imagens da API e do web sem cache e sobe                 |
| `pnpm run infra:down`       | `make down`        | Derruba containers e rede — **volumes preservados**               |
| `pnpm run infra:ps`         | `make ps`          | Estado e health de cada serviço                                   |
| `pnpm run infra:logs`       | `make logs`        | Segue os logs                                                     |
| `pnpm run infra:reset`      | `make reset`       | **DESTRÓI os volumes** e sobe do zero (reexecuta o init do banco) |
| `pnpm run infra:verify`     | `make verify`      | Checklist de DoD/segurança — 35 checagens, exit 1 se falhar       |
| `pnpm run infra:psql`       | `make psql`        | `psql` como `movivo_app` **via PgBouncer**                        |
| `pnpm run infra:psql:admin` | `make psql-admin`  | `psql` como `movivo_migrator` direto na 5432                      |
| `pnpm run infra:pools`      | `make pools`       | `SHOW POOLS` — confirma o transaction mode                        |
| `pnpm run infra:redis`      | `make redis-cli`   | `redis-cli` autenticado no master                                 |
| `pnpm run infra:sentinel`   | `make sentinel`    | Estado do master conforme o Sentinel                              |

`infra:down` **preserva os dados**; use `infra:reset` quando quiser um banco limpo
ou depois de rotacionar segredos (a senha de uma role já criada não muda sozinha).

---

## Scripts da raiz

| Script                                           | O que faz                                                            |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `pnpm run dev`                                   | Sobe todos os apps em modo desenvolvimento (`turbo run dev`)         |
| `pnpm run build`                                 | Builda todos os workspaces respeitando a ordem de dependências       |
| `pnpm run typecheck`                             | `tsc --noEmit` em todos os workspaces                                |
| `pnpm run lint`                                  | **ESLint em todo o monorepo, a partir da raiz** (`--max-warnings=0`) |
| `pnpm run lint:fix`                              | Idem, aplicando correções automáticas                                |
| `pnpm run lint:api` / `lint:web` / `lint:shared` | Lint escopado a um workspace                                         |
| `pnpm run test`                                  | Roda os testes de todos os workspaces                                |
| `pnpm run format`                                | Formata o repositório com Prettier                                   |
| `pnpm run format:check`                          | Verifica formatação sem escrever (usado no CI)                       |
| `pnpm run clean`                                 | Remove `dist/` e `*.tsbuildinfo` de todos os workspaces              |

Para rodar em um workspace específico:

```bash
pnpm --filter @movivo/api run build
pnpm --filter @movivo/web run dev
pnpm --filter @movivo/shared run build
```

> ⚠️ **Lint roda apenas na raiz, nunca por workspace.** O ESLint flat config resolve os
> patterns de `files` relativos ao diretório do próprio config; um `eslint .` executado
> dentro de `apps/api` lintaria **zero arquivos silenciosamente** — um falso-positivo
> perigoso no CI. Por isso os workspaces não têm script `lint` próprio: use
> `pnpm run lint` na raiz ou os atalhos `lint:api` / `lint:web` / `lint:shared`.

---

## Backend (`apps/api`)

Monólito modular NestJS. Os módulos de domínio ficam em `src/modules` e a infraestrutura
compartilhada em `src/core` (lista completa em [`CLAUDE.md`](CLAUDE.md)).

### Rodar localmente

```bash
pnpm run infra:up                      # dados + API + web em Docker (http://localhost:3001/api/v1)
```

Para desenvolver com hot reload, rode a API no host (a porta 3001 precisa estar livre):

```bash
docker compose stop api web            # libera 3000/3001 (os dados continuam no ar)
cp apps/api/.env.example apps/api/.env # perfil de quem roda a API no host
pnpm --filter @movivo/api run dev      # http://localhost:3001/api/v1
```

### `GET /api/v1/health`

Sem autenticação (healthcheck de container, load balancer e smoke test). Retorna **200**
quando banco e Redis respondem e **503** quando qualquer um cai. Não expõe segredo nem string
de conexão.

### Regras de quem escreve backend aqui

1. **Config só pelo `AppConfigService`.** Nunca ler `process.env` direto.
2. **Chave de Redis só pelo `RedisKeyBuilder`.** `forUser(userId, …)` para dado de titular.
3. **Nunca logar PII.** Use `redactPii`/`redactObject` de `core/logger`.
4. **`SET LOCAL`, nunca `SET`.** O PgBouncer em transaction mode recicla a conexão a cada transação.
5. **Módulo de domínio nunca importa módulo de domínio:** evento ou fila. Zero `forwardRef()`.
6. **O modelo nunca escreve.** Agentes devolvem propostas tipadas; quem muda estado é o motor de
   políticas e o executor de decisões.

---

## Banco de dados (schema, migrações e seed)

O schema vive em `apps/api/src/core/database/schema/` (um arquivo por tabela) e as
migrações versionadas em `apps/api/drizzle/`. As duas coisas precisam estar sempre
em sincronia: se `db:generate` produzir um arquivo novo, é porque alguém alterou o
schema sem gerar a migração.

### Comandos

```bash
pnpm --filter @movivo/api db:generate   # gera migração a partir do schema
pnpm --filter @movivo/api db:migrate    # aplica migrações + reconcilia grants
pnpm --filter @movivo/api db:seed       # popula dados sintéticos de dev (idempotente)
pnpm --filter @movivo/api db:studio     # UI do Drizzle Studio
```

Ciclo completo do zero (o que o CI e um clone limpo fazem):

```bash
pnpm run infra:reset                    # destrói volumes e recria o stack
pnpm --filter @movivo/api db:migrate
pnpm --filter @movivo/api db:seed
```

### Por que a migração NÃO passa pelo PgBouncer

O runtime da aplicação fala com o Postgres **exclusivamente pela 5433** (regra
inegociável §12.3). A migração é a **única exceção** e usa conexão direta
(`MIGRATION_DATABASE_*`, porta 5432 do container), por duas razões técnicas:

1. o `drizzle-kit` serializa migrações com **advisory locks de sessão** — em
   transaction pooling, o lock seria adquirido numa conexão de backend e perdido
   em outra;
2. DDL com `CREATE TYPE`/`CREATE EXTENSION` não sobrevive ao rebind de sessão do pooler.

Isso não afrouxa a regra §12.3, que trata do caminho da **aplicação**. Há uma trava
explícita: tanto `drizzle.config.ts` quanto `db:migrate` **abortam** se a porta de
migração apontar para 5433.

> **Porta 5432 ocupada?** Se você já tem um PostgreSQL nativo na máquina, defina
> `HOST_POSTGRES_PORT=15432` no `.env` da raiz e o **mesmo valor** em
> `MIGRATION_DATABASE_PORT` no `apps/api/.env`.

### Modelo de permissões

| Role              | Papel                                   | Pode                                                     |
| ----------------- | --------------------------------------- | -------------------------------------------------------- |
| `movivo_migrator` | Dona do schema `public`, roda migrações | DDL, `CREATE` no banco (schema `drizzle` do bookkeeping) |
| `movivo_app`      | Runtime da aplicação                    | `SELECT/INSERT/UPDATE/DELETE` apenas                     |

`movivo_app` **não é dona de nenhuma tabela** e **não tem `BYPASSRLS`** — as duas
condições que fazem as políticas `FORCE ROW LEVEL SECURITY` de toda tabela de titular
serem inescapáveis. O `db:migrate` **verifica isso a cada execução** e falha se
alguém tiver afrouxado o modelo. Os grants são reconciliados automaticamente a cada
migração, então tabela nova já nasce acessível ao runtime sem passo manual.

### RLS, arquivo do legado e squash

- As políticas de RLS (FORCE) das tabelas de titular são geradas por
  `src/core/database/security-policies.ts` e reconciliadas a cada `db:migrate`.
- As tabelas `legacy_*_archive` guardam, somente leitura e por 5 anos, o que o serviço anterior
  produziu. Nenhum fluxo as lê; o acesso é só de ADMIN/SISTEMA.
- A cadeia de migrações só deve ser condensada numa base única depois que a produção aplicar todas
  as migrações; o procedimento está no relatório de entrega M11 (`movivo-docs/v2/entregas/`).

---

## Frontend (`apps/web`)

Next.js (App Router, React 19) com Tailwind CSS v4 e shadcn/ui, carregados com os tokens do
design system "O Pulso" (todo o tema vive em `src/app/globals.css`).

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @movivo/web run dev        # http://localhost:3000
```

> ⚠️ **Rode `pnpm run build` na raiz pelo menos uma vez antes de usar `pnpm --filter`.**
> `@movivo/shared` é consumido pelo seu `dist/`; sem o build, qualquer task escopada falha com
> `TS2307: Cannot find module '@movivo/shared'`.

Duas superfícies:

- **Aluno:** sem login, por links mágicos enviados no WhatsApp (`/hoje`, `/check-in`, `/alimentacao`,
  `/evolucao`, `/plano/[token]`, `/conta`, `/assinar`) e a anamnese (`/anamnese`,
  `/anamnese/complementar`).
- **Painel interno:** `/dashboard`, protegido por sessão em cookies httpOnly (BFF em
  `src/app/api/dashboard`). A landing pública e as páginas legais ficam em `/`, `/termos` e `/privacidade`.

### Regras de quem escreve frontend aqui

1. **Server Component até prova em contrário.** `'use client'` só com estado, efeito ou handler.
2. **`NEXT_PUBLIC_*` é público.** Nunca segredo.
3. **Regra cromática:** Verde Pulso e Coral nunca são cor de texto pequeno sobre fundo claro (AA).
4. **Toda cor nova entra em `globals.css`**, nas duas camadas (claro e escuro).
5. **Acessibilidade é requisito de merge:** WCAG 2.2 AA, HTML semântico, nome acessível.
6. **Guardrails de linguagem valem para a UI:** nunca "diagnóstico", "tratamento", "cura" ou
   "resultado garantido"; a IA nunca aparece decidindo sozinha.
7. O Next.js usado aqui tem mudanças incompatíveis: confira `node_modules/next/dist/docs/` antes
   de escrever código novo.

---

## O pacote `@movivo/shared`

Fonte única de verdade dos contratos entre backend e frontend.

```ts
import { APP_VERSION, SubscriptionStatus, paginationQuerySchema } from '@movivo/shared';
```

Regras do pacote:

1. **Isomórfico:** nada de APIs de Node nem do browser.
2. **Sem lógica de negócio:** enums são constantes; regras vivem nos módulos de domínio.
3. **Sem `enum` do TypeScript:** objeto `as const` + type derivado.
4. **Import só pelo barrel.**
5. **Zod é obrigatório** para todo DTO de contrato.

O pacote é consumido pelo seu `dist/`: rode `pnpm --filter @movivo/shared run build` após alterá-lo
e antes de testar a API ou o web isoladamente.

---

## Testes

| Camada                       | Comando                                                                                                                                   | Observação                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Unitários (API, web, shared) | `pnpm run test`                                                                                                                           | sem I/O                                          |
| Integração da API            | `HOST_POSTGRES_PORT=5432 DEV_PROFESSIONAL_PASSWORD_FILE= pnpm --filter @movivo/api exec vitest run --config vitest.integration.config.ts` | Postgres e Redis reais; pare `movivo-api` antes  |
| E2E do painel                | `pnpm --filter @movivo/web exec playwright test`                                                                                          | usa a porta 3000: pare o container `movivo-web`  |
| Avaliação de agentes         | `pnpm --filter @movivo/api run eval --task <id>`                                                                                          | chama o modelo real e grava em `eval_runs`       |
| Código sem uso               | `pnpm run knip`                                                                                                                           | falha com arquivo, export ou dependência sem uso |

---

## Padrões de código

- **TypeScript `strict: true`** + `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitReturns`, `noImplicitOverride`. Sem exceções.
- **`any` é erro de lint**, assim como non-null assertion (`!`).
- **Formatação é 100% do Prettier**; o ESLint não formata.
- Imports de tipo com `import type` / `type` inline.
- `console.log` é bloqueante (`--max-warnings=0`); use o logger estruturado e **nunca** logue PII.
- Sem resíduo: ao substituir algo, apague código, testes, schemas, filas, rotas, permissões,
  variáveis e documentação na mesma mudança.

---

## Regras inegociáveis

1. **Nunca versionar segredos.** Apenas `.env.example` com placeholders.
2. **Drizzle é o ORM.** Nunca Prisma nem TypeORM.
3. **PgBouncer sempre no caminho do Postgres:** a aplicação conecta na **5433**, nunca na 5432.
4. **O modelo nunca escreve e nunca recebe ferramenta.** Agentes devolvem propostas; o motor de
   políticas decide; o executor grava com versão da política e motivos.
5. **Segurança sem tolerância:** os casos de avaliação de segurança não admitem falha.
6. **`ModelGateway` é o único ponto autorizado a chamar um LLM**, e todo prompt passa pelo
   scrubber de PII. Nunca enviar dado de saúde a fornecedor sem aprovação (ADR-005-R2).
7. **RLS FORCE em toda tabela com dado de aluno**, com teste de isolamento.
8. **Stateless:** nenhum estado em memória local do container.
9. **Toda API é versionada** (`api/v1`).
10. **Guardrails de linguagem:** nunca "diagnóstico", "tratamento", "cura" ou "resultado garantido"
    em código, copy, prompt ou UI; a IA é sempre ferramenta de apoio, com o profissional visível.

---

## Convenção de commits

**Conventional Commits** com tipo em inglês e descrição em **PT-BR**, uma única
responsabilidade por commit. Regras completas em [`CLAUDE.md`](CLAUDE.md).

```
feat(anamnesis): adiciona salvamento de progresso por bloco no formulário
fix(whatsapp): corrige validação do token no webhook da EvolutionAPI
chore(monorepo): fixa versao do pnpm no packageManager
```

Tipos aceitos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `build`, `ci`.
