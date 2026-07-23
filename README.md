# MOVIVO

> **Ciência que treina com você.**

**MOVIVO** é um AI Coach de treino individualizado entregue via **WhatsApp**, que combina IA
conversacional com metodologia e supervisão de um profissional de Educação Física registrado
no **CREF**. A IA nunca prescreve sozinha: o protocolo é calculado por um **Motor Determinístico**
e assinado/supervisionado por um profissional CREF — o LLM apenas gera linguagem natural a
partir do estado já decidido.

Este repositório é um **monorepo** (pnpm workspaces + Turborepo).

---

## Sumário

- [Requisitos](#requisitos)
- [Estrutura do monorepo](#estrutura-do-monorepo)
- [Setup rápido](#setup-rápido)
- [Ambiente e segredos](#ambiente-e-segredos)
- [Ambiente local de dados (Docker Compose)](#ambiente-local-de-dados-docker-compose)
- [Scripts da raiz](#scripts-da-raiz)
- [Backend (`apps/api`)](#backend-appsapi)
- [Banco de dados (schema, migrações e seed)](#banco-de-dados-schema-migrações-e-seed)
- [Frontend (`apps/web`)](#frontend-appsweb)
- [O pacote `@movivo/shared`](#o-pacote-movivoshared)
- [Padrões de código](#padrões-de-código)
- [Regras inegociáveis](#regras-inegociáveis)
- [Documentação de referência](#documentação-de-referência)
- [Convenção de commits](#convenção-de-commits)

---

## Requisitos

| Ferramenta | Versão fixada       | Onde está fixada                           |
| ---------- | ------------------- | ------------------------------------------ |
| Node.js    | `22.22.0`           | `.nvmrc` / `.node-version` / `engines`     |
| pnpm       | `11.15.1`           | `packageManager` no `package.json` da raiz |
| TypeScript | `5.9.3`             | devDependency da raiz e de cada workspace  |
| Turborepo  | `2.10.6`            | devDependency da raiz                      |
| Docker     | 29+ com Compose v2+ | necessário a partir da US-0.2              |

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

Estrutura **fixa**, definida em [`docs/arquitetura/ARQUITETURA.md`](docs/arquitetura/ARQUITETURA.md) §2.
Não criar novos `apps/` ou `packages/` sem ADR formal.

```
/
├─ apps/
│  ├─ api/                 # Backend — monólito modular NestJS (porta 3001)
│  │  ├─ src/
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  └─ web/                 # Frontend — Next.js 15 App Router (porta 3000)
│     ├─ src/
│     ├─ package.json
│     └─ tsconfig.json
├─ packages/
│  └─ shared/              # @movivo/shared — tipos, schemas Zod e enums de domínio
│     ├─ src/
│     │  ├─ enums/         # enums de domínio (const objects, nunca `enum` do TS)
│     │  ├─ schemas/       # schemas Zod (DTOs de contrato back ↔ front)
│     │  ├─ types/         # tipos TypeScript compartilhados
│     │  └─ index.ts       # barrel — único ponto de entrada público
│     ├─ package.json
│     └─ tsconfig.json     # composite + declaration (project references)
├─ docs/                   # relatórios do pipeline de agentes + ARQUITETURA.md
├─ sprint/                 # planejamento operacional das sprints
├─ eslint.config.mjs       # ESLint flat config — única, compartilhada
├─ .prettierrc.json        # Prettier — regra única
├─ .editorconfig
├─ tsconfig.base.json      # TypeScript base (strict) + paths de @movivo/shared
├─ turbo.json              # orquestração e cache de tasks
├─ pnpm-workspace.yaml
├─ package.json            # scripts da raiz
├─ .nvmrc / .node-version
└─ README.md
```

> **Status atual:** `apps/api` é o **NestJS real** (US-0.3 — ver
> [Backend (`apps/api`)](#backend-appsapi)) e `apps/web` é o **Next.js 15 real**
> (US-0.5 — ver [Frontend (`apps/web`)](#frontend-appsweb)).

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

> Política completa: **[`docs/SECURITY.md`](docs/SECURITY.md)**. Dono: Henrique (US-0.6).
> **Nenhum segredo real entra no Git — nunca.** Só `*.env.example` com placeholders.

### 1. Gere os segredos locais

Valores aleatórios e descartáveis, gravados em `secrets/` (100% ignorado pelo Git):

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
resolve contra o `cwd` do processo (`../../secrets/...` rodando no host). A
especificação normativa que o `ConfigModule` implementa está em
[`docs/SECURITY.md` §2](docs/SECURITY.md#2-contrato-de-consumo-de-secrets-_file--normativo).

### 4. Regras que valem para qualquer variável

- A aplicação conecta no Postgres **sempre na 5433** (PgBouncer). Nunca na 5432.
  A única exceção é o `drizzle-kit`, que migra na 5432 como `movivo_migrator`.
- `NEXT_PUBLIC_*` vai para o bundle do browser: **jamais** um segredo ali.
- Nada sensível em log, erro, span de telemetria ou resposta de `/health`.

---

## Ambiente local de dados (Docker Compose)

> Dono: Henrique (US-0.2). Definido em [`docker-compose.yml`](docker-compose.yml) +
> [`docker-compose.secrets.yml`](docker-compose.secrets.yml) (puxado por `include:`)
> e nas configs de [`infra/`](infra). **Pré-requisito: os segredos da seção
> anterior já gerados** — os containers falham no boot sem eles, de propósito.

### Subir tudo

```bash
pnpm run infra:up      # sobe e BLOQUEIA até 100% dos serviços ficarem healthy
pnpm run infra:verify  # roda o checklist completo de sanidade e segurança
```

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
escreve código (US-0.3/US-0.4):

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
| `pnpm run infra:up`         | `make up`          | Sobe e espera todos ficarem `healthy`                             |
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
ou depois de rotacionar segredos (a senha de uma role já criada não muda sozinha —
ver [`docs/SECURITY.md` §4.1](docs/SECURITY.md)).

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

Monólito modular NestJS 11. A árvore de módulos espelha o **C4 nível 3** do
[`ARQUITETURA.md` §4](docs/arquitetura/ARQUITETURA.md).

```
src/
├─ main.ts                  prefixo api/v1 · ValidationPipe global · CORS por env
│                           graceful shutdown · porta 3001
├─ app.module.ts            raiz — CORE + Health + 9 módulos de domínio
├─ core/                    BLOCO CORE (infraestrutura compartilhada)
│  ├─ config/               Zod + contrato *_FILE (docs/SECURITY.md §2) · fail-fast no boot
│  ├─ database/             Drizzle + postgres.js via PgBouncer 5433 · prepare: false
│  ├─ redis/                ioredis via Sentinel · RedisKeyBuilder (isolamento por titular)
│  ├─ logger/               pino JSON · correlation id · redação de PII
│  ├─ telemetry/            stub (Sprint 6)
│  └─ event-bus/            stub (CQRS)
├─ health/                  GET /api/v1/health (@nestjs/terminus)
└─ modules/                 auth · anamnesis · protocol · whatsapp · ai-coach
                            subscription · checkin · jobs · admin  (cascas vazias)
```

### Rodar localmente

```bash
pnpm run infra:up                      # stack de dados (uma vez)
cp apps/api/.env.example apps/api/.env # perfil de quem roda a API no host
pnpm --filter @movivo/api run dev      # http://localhost:3001/api/v1
```

### `GET /api/v1/health`

Sem autenticação (consumido por healthcheck de container, load balancer e smoke test).
Retorna **200** quando as duas dependências respondem e **503** quando qualquer uma cai.
Não expõe segredo nem string de conexão.

```jsonc
{
  "status": "ok",
  "info": {
    "db": { "status": "up", "port": 5433, "via": "pgbouncer", "preparedStatements": false },
    "redis": { "status": "up", "via": "sentinel", "masterName": "movivo-master" },
  },
}
```

### Regras de quem escreve backend aqui

1. **Config só pelo `AppConfigService`.** Nunca ler `process.env` direto: os segredos
   deliberadamente **não** são injetados em `process.env` (docs/SECURITY.md §2.1.8).
2. **Chave de Redis só pelo `RedisKeyBuilder`.** `forUser(userId, …)` para dado de
   titular, `global(…)` para o resto. Telefone nunca entra em nome de chave.
3. **Nunca logar PII.** Use `redactPii`/`redactObject` de `core/logger` para qualquer
   texto de origem externa. Corpo de request não é logado por padrão — mantenha assim.
4. **`SET LOCAL`, nunca `SET`.** O PgBouncer em transaction mode recicla a conexão de
   servidor a cada transação; um `SET` vazaria contexto de um titular para o próximo.
5. **Módulo de domínio nunca importa módulo de domínio** — evento ou fila. Zero
   `forwardRef()` no repositório.

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
condições que fazem as políticas `FORCE ROW LEVEL SECURITY` das próximas sprints
serem inescapáveis. O `db:migrate` **verifica isso a cada execução** e falha se
alguém tiver afrouxado o modelo. Os grants são reconciliados automaticamente a cada
migração, então tabela nova já nasce acessível ao runtime sem passo manual.

### O que ficou para sprints futuras (deliberado)

Índices HNSW (RAG), particionamento mensal de `conversations`, triggers de auditoria
append-only e as políticas RLS propriamente ditas. O terreno está preparado —
`user_id` é coluna líder dos índices por usuário e as colunas de saúde já estão
marcadas com `-- LGPD Art. 11` para a cifra `pgcrypto` da sprint de anamnese.

---

## Frontend (`apps/web`)

Next.js 15 (App Router, React 19) com Tailwind CSS v4 + shadcn/ui carregados com os
tokens do design system **"O Pulso"** (`docs/fitness-ia-whatsapp/04-relatorio-kimura.md`,
nomes de token conforme `09-relatorio-sofia.md` §15).

```
apps/web/
├─ next.config.ts            headers de segurança · outputFileTracingRoot do monorepo
├─ postcss.config.mjs        Tailwind v4 (não existe tailwind.config.*)
├─ components.json           registry do shadcn/ui (style new-york, RSC, alias @/*)
├─ instrumentation-client.ts PostHog — import dinâmico, opt-in por env
└─ src/
   ├─ app/
   │  ├─ layout.tsx          lang="pt-BR" · next/font · metadata/SEO · ThemeProvider
   │  ├─ page.tsx            home — Server Component, consome @movivo/shared
   │  ├─ not-found.tsx       404
   │  ├─ icon.svg            favicon — símbolo "O Pulso"
   │  └─ globals.css         ►► FONTE DA VERDADE DOS TOKENS ◄◄
   ├─ components/
   │  ├─ ui/button.tsx       shadcn/ui
   │  ├─ theme-provider.tsx  next-themes (client)
   │  └─ theme-toggle.tsx    alternador claro/escuro (client)
   └─ lib/
      ├─ env.ts              config PÚBLICA (NEXT_PUBLIC_*) — nunca segredo
      └─ utils.ts            cn()
```

### Rodar localmente

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @movivo/web run dev        # http://localhost:3000
```

> ⚠️ **Rode `pnpm run build` na raiz pelo menos uma vez antes de usar `pnpm --filter`.**
> `@movivo/shared` é consumido pelo seu `dist/`; com o pacote não-buildado, qualquer
> task escopada por `--filter` falha com `TS2307: Cannot find module '@movivo/shared'`.
> Só o Turborepo, a partir da raiz, garante a ordem via `dependsOn: ["^build"]`.

### Os tokens de Kimura no código

Tailwind v4 é configurado em CSS, não em JS: **todo** o tema vive em
`src/app/globals.css`, em três camadas — tokens brutos da marca, tokens semânticos por
tema, e o bloco `@theme inline` que os expõe como utilitários.

| Token de marca (Kimura) | CSS variable      | Utilitário Tailwind |
| ----------------------- | ----------------- | ------------------- |
| Petróleo Vivo `#06302A` | `--petroleo-vivo` | `bg-petroleo`       |
| Verde Pulso `#25E27E`   | `--verde-pulso`   | `bg-verde-pulso`    |
| Coral Vivo `#FF6A3D`    | `--coral-vivo`    | `bg-coral`          |
| Névoa `#F4F7F3`         | `--nevoa`         | `bg-nevoa`          |
| Grafite `#14201C`       | `--grafite`       | `text-grafite`      |
| Musgo `#5B6B63`         | `--musgo`         | `text-musgo`        |

No dia a dia, porém, **use os tokens semânticos** (`bg-background`, `text-foreground`,
`bg-primary`, `border-input`, `text-muted-foreground`…): eles já trocam sozinhos entre
tema claro e escuro. Os tokens de marca ficam para quando a cor é a marca em si.

Tipografia (`next/font`, auto-hospedada — zero requisição a domínio de terceiro):
**Hanken Grotesk** em `font-sans` e **JetBrains Mono** em `font-mono`. Mono só para
**dado** (carga, séries, semana, nº do CREF), em dose cirúrgica. A escala de Kimura
está nos utilitários `text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body` e
`text-label`.

### Regras de quem escreve frontend aqui

1. **Component é Server Component até prova em contrário.** `'use client'` só quando
   houver estado, efeito ou handler de evento — e o mais fundo possível na árvore.
2. **`NEXT_PUBLIC_*` é público.** O valor é inlined no bundle e visível a qualquer um.
   Segredo de servidor segue o contrato `*_FILE` de [`docs/SECURITY.md`](docs/SECURITY.md) §2 e
   nunca é lido por `src/lib/env.ts`.
3. **Regra cromática de Kimura, inegociável:** Verde Pulso e Coral **nunca** são cor de
   texto pequeno sobre fundo claro (reprovam em AA). Texto sobre claro é Grafite ou
   Petróleo; o verde fica para preenchimento, ícone grande e realce.
4. **Toda cor nova entra em `globals.css`**, nas duas camadas (claro e escuro), com a
   razão de contraste anotada. Nada de hex solto em `className`.
5. **Acessibilidade é requisito de merge, não polimento:** WCAG 2.2 AA, HTML semântico,
   nome acessível em todo controle, `prefers-reduced-motion` respeitado (já global).
6. **Guardrails de linguagem valem para a UI** (regra §12.10): nunca "diagnóstico",
   "tratamento", "cura" ou "resultado garantido"; a IA nunca aparece decidindo sozinha.

### Analytics (PostHog)

`instrumentation-client.ts` inicializa o SDK **por import dinâmico**: sem
`NEXT_PUBLIC_POSTHOG_KEY` válida (o placeholder do `.env.example` conta como ausente),
nada é baixado e a analytics simplesmente não existe — custo zero para o usuário e
nenhuma quebra. Nesta sprint é só o stub: a taxonomia de eventos de funil é de Lucas §8
e Sofia §16.2, e será instrumentada junto das telas reais.

---

## O pacote `@movivo/shared`

Fonte única de verdade dos contratos entre backend e frontend.

```ts
import { APP_VERSION, ProtocolStatus, paginationQuerySchema } from '@movivo/shared';
```

Regras do pacote:

1. **Isomórfico.** Nunca importar APIs de Node (`fs`, `path`, `crypto`, `node:*`) nem do
   browser. Há uma regra de ESLint (`no-restricted-imports`) que bloqueia isso.
2. **Sem lógica de negócio.** Enums são apenas constantes; máquinas de estado e regras
   vivem nos módulos de domínio do backend.
3. **Sem `enum` do TypeScript.** Usar objeto `as const` + type derivado — apagável,
   serializável e compatível com `z.enum()`.
4. **Import só pelo barrel.** Nada de caminho profundo (`@movivo/shared/src/...`).
5. **Zod é obrigatório** para todo DTO de contrato (`ARQUITETURA.md` §2).

O pacote é `composite: true` e é consumido pelos apps via **project references** +
alias `@movivo/shared` no `tsconfig.base.json`. Como o `tsconfig.base.json` define
`disableSourceOfProjectReferenceRedirect: true`, o `packages/shared` precisa estar
**buildado** antes do typecheck dos apps — o Turborepo garante isso via `dependsOn: ["^build"]`.
Se for rodar `tsc` na mão dentro de um app, rode antes:

```bash
pnpm --filter @movivo/shared run build
```

---

## Padrões de código

- **TypeScript `strict: true`** + `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`, `noImplicitOverride`. Sem exceções.
- **`any` é erro de lint**, assim como non-null assertion (`!`).
- **Formatação é 100% do Prettier.** O ESLint não formata (`eslint-config-prettier`
  é sempre a última camada do flat config).
- Imports de tipo devem usar `import type` / `type` inline (`consistent-type-imports`).
- `console.log` é warning bloqueante (`--max-warnings=0`); use o logger estruturado
  do backend (`LoggerModule`, US-0.3) — e **nunca** logue telefone ou PII em texto claro.
- `docs/` e `sprint/` são ignorados por ESLint e Prettier: são relatórios editoriais
  do pipeline de agentes, não código.

---

## Regras inegociáveis

Resumo executável de [`docs/arquitetura/ARQUITETURA.md`](docs/arquitetura/ARQUITETURA.md) §12 —
leia o documento completo antes de escrever código:

1. **Nunca versionar segredos** (`.env`, chaves, credenciais). Apenas `.env.example` com placeholders.
2. **Drizzle é o ORM.** Nunca Prisma nem TypeORM.
3. **PgBouncer sempre no caminho do Postgres** — a aplicação conecta na porta **5433**, nunca na 5432.
4. **Redis nunca sobe sem o patch da CVE-2025-49844 (RediShell).**
5. **A IA nunca decide o protocolo** — sempre o Motor Determinístico (100% de cobertura de teste).
6. **`LLMRouter` é o único ponto autorizado a chamar um LLM**, e todo prompt passa pelo PII Scrubber.
7. **Nunca usar DeepSeek** em nenhum fluxo (ADR-005-R). LLM principal: GPT-4.1; fallback: Claude Sonnet 4.5.
8. **Stateless** — nenhum estado em memória local do container.
9. **Toda API é versionada** (`api/v1`), com dual-support de 90 dias em breaking changes.
10. **Guardrails de linguagem:** nunca escrever "diagnóstico", "tratamento", "cura" ou
    "resultado garantido" em código, copy, prompt de IA ou UI. A formulação correta é sempre
    "profissional CREF, usando IA como ferramenta".

---

## Documentação de referência

| Documento                                                            | Conteúdo                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`docs/arquitetura/ARQUITETURA.md`](docs/arquitetura/ARQUITETURA.md) | Stack obrigatória, ADRs, C4, segurança, roadmap, regras inegociáveis                                                        |
| [`docs/SECURITY.md`](docs/SECURITY.md)                               | Política de segredos: contrato `*_FILE`, Docker Secrets, segredos de CI, inventário e cadência de rotação                   |
| [`sprint/sprint-0-fundacao.md`](sprint/sprint-0-fundacao.md)         | Planejamento operacional da Sprint 0 (Épico 0)                                                                              |
| `docs/fitness-ia-whatsapp/`                                          | Relatórios completos do pipeline de agentes (negócio, marca, jurídico, financeiro, produto, UX, arquitetura, segurança, IA) |

---

## Convenção de commits

**Conventional Commits** com tipo em inglês e descrição em **PT-BR**, uma única
responsabilidade por commit e **sem coautor de IA**.

```
feat(anamnesis): adiciona salvamento de progresso por bloco no formulário
fix(whatsapp): corrige validação de HMAC no webhook da AraraHQ
chore(monorepo): fixa versao do pnpm no packageManager
```

Tipos aceitos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `build`, `ci`.
