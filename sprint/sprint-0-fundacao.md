# Sprint 0 — Fundação Técnica (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-07-22
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (início)
**Duração alvo:** 1 semana (5 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + QA (Mariana)
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§2 stack, §4 C4, §8 segurança, §10 roadmap, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/10-relatorio-rafael.md` §17 · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` §9/§12 · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` §9 (schema lógico)

---

## Como ler este documento

Hierarquia: **Épico → User Stories (US-0.x) → Tasks (TASK-0.x.y)**.

- Cada **User Story** declara: jornada (o que se constrói e por quê), objetivo, resultado esperado, agentes participantes e ordem, dependências e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é considerada **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas**. O significado de "validada" está explícito no DoD de cada US (revisão de código, teste automatizado verde, checklist de segurança, healthcheck, etc.).
- Esta é a **única** sprint planejada agora. Sprints 1-6 serão planejadas depois, com base no aprendizado desta. Nada aqui entrega funcionalidade de produto ao usuário final — é fundação técnica ("Épico 0") que antecede os Épicos 1-7 de produto (`08-relatorio-lucas.md`).

### Regras inegociáveis que já valem na Sprint 0 (de `ARQUITETURA.md` §12 e `11-relatorio-sato.md`)

1. **Nunca versionar segredos** (`.env`, chaves, senhas) no Git — só `.env.example` com placeholders.
2. **Redis nunca sobe sem o patch da CVE-2025-49844 (RediShell)** — versão mínima `8.2.2 / 8.0.4 / 7.4.6 / 7.2.11`, bind interno, sem exposição pública.
3. **PgBouncer em transaction mode desde o MVP** — porta 5433; a app nunca fala direto na 5432.
4. **Drizzle é o ORM — nunca Prisma/TypeORM.**
5. **Monólito modular NestJS** — módulos com contratos explícitos, sem imports circulares.
6. **Stateless** — nada de estado em memória local do container.
7. **DevSecOps no CI** — SAST + SCA + secret scanning **antes de qualquer merge para `main`**.
8. **Role `movivo_app` nunca com `BYPASSRLS`** e nunca dona das tabelas (preparar o terreno já na Sprint 0).

---

# ÉPICO 0 — Fundação Técnica da Plataforma MOVIVO

### Descrição

Estabelecer o esqueleto técnico compartilhado que todo o desenvolvimento subsequente (Sprints 1-6) vai consumir: um **monorepo** com `apps/web` (Next.js 15), `apps/api` (NestJS) e `packages/shared` (tipos e schemas Zod compartilhados); um **ambiente local reprodutível** via Docker Compose com PostgreSQL+PGVector, PgBouncer, Redis+Sentinel (já com o patch da RediShell); o **boilerplate NestJS** com os módulos CORE de infraestrutura; o **schema Drizzle inicial** das tabelas-base; o **boilerplate Next.js 15** mínimo; um **pipeline CI/CD** (lint → test → build) já com os estágios de segurança de Sato; **gestão de secrets** para local e CI; e um **quality gate mínimo** que torne merges seguros a partir do dia 1.

### Objetivo

Reduzir a zero o atrito de setup e o retrabalho de fundação nas próximas sprints. Ao final da Sprint 0, qualquer um dos três devs deve conseguir clonar o repositório, rodar um único comando (`make up` / `pnpm dev`) e ter o stack completo no ar localmente, com CI barrando qualquer merge que quebre lint, testes, build, ou que introduza secret vazado / CVE crítica.

### Resultado esperado do épico

- Monorepo funcional com workspaces e tooling compartilhado (lint, format, typecheck, test).
- `docker compose up` sobe PG+PGVector, PgBouncer, Redis master+replica+sentinel, todos com healthcheck verde.
- NestJS sobe localmente, conecta no Postgres **via PgBouncer (5433)** e no Redis, e responde `GET /health` com status dos recursos.
- Migração Drizzle inicial aplicada, criando as tabelas-base e as extensões (`vector`, `uuid-ossp`, `pgcrypto`).
- Next.js 15 sobe localmente com App Router e a home renderizando via RSC.
- CI verde no GitHub Actions: `lint → typecheck → test → build` + `secret-scan → SAST → SCA`.
- Nenhum secret real no repositório; apenas `.env.example` e Docker Secrets locais.
- Quality gate ativo: PRs para `main` bloqueados sem status checks verdes.

### Não-escopo desta sprint (para não haver ambiguidade)

Nenhuma lógica de negócio (AUTH real, ANAMNESIS, Motor Determinístico, LLMRouter, integrações AraraHQ/Stripe/Asaas, RAG). Os módulos de domínio são criados apenas como **esqueleto vazio** (pasta + módulo NestJS registrado + placeholder), sem implementação. Observabilidade completa (Prometheus/Grafana/Loki/Sentry), Kubernetes, testes de carga e pentest ficam para as sprints/roadmap posteriores (§10 do `ARQUITETURA.md`).

### Mapa de dependências entre User Stories

```
US-0.1 (monorepo/tooling · Leonardo+Felipe)
   ├──> US-0.3 (NestJS boilerplate · Leonardo) ──> US-0.4 (Drizzle schema · Leonardo)
   └──> US-0.5 (Next.js boilerplate · Felipe)
US-0.6 (secrets · Henrique) ──> US-0.2 (Docker Compose · Henrique) ──> US-0.3 / US-0.4 (rodar local)
US-0.8 (quality gate + test infra · Mariana) ──> US-0.7 (CI/CD · Henrique)
   (US-0.7 também depende de US-0.1, US-0.3, US-0.5 existirem para ter o que buildar)
```

Sequência prática recomendada: **US-0.6 e US-0.1 começam em paralelo no dia 1** → US-0.2 (Henrique) e US-0.3/US-0.5 (Leonardo/Felipe) no dia 2 → US-0.4 (Leonardo) dia 3 → US-0.8 (Mariana) do dia 2 ao 4 → US-0.7 (Henrique) fecha do dia 3 ao 5.

---

## US-0.1 — Estrutura do monorepo e tooling compartilhado

**Agentes:** Leonardo (lead — dono do root, `apps/api` e `packages/shared`) · Felipe (colaborador — valida que `apps/web` e o consumo de `packages/shared` funcionam no workspace).
**Depende de:** nada. É a primeira US a começar.
**Habilita:** US-0.3, US-0.4, US-0.5, US-0.7.

### Jornada

Antes de escrever qualquer linha de backend ou frontend, o time precisa de um repositório único com a estrutura fixa exigida pela arquitetura (`ARQUITETURA.md` §2: `apps/web`, `apps/api`, `packages/shared`) e de um conjunto de ferramentas compartilhadas (gerenciador de pacotes com workspaces, TypeScript base, ESLint, Prettier, orquestrador de tarefas) para que lint, testes e build rodem de forma idêntica na máquina de qualquer dev e no CI. Sem essa fundação, cada app teria configuração divergente e o CI seria impossível de padronizar. Leonardo estabelece o esqueleto; Felipe valida o lado web para evitar surpresas na US-0.5.

### Objetivo

Ter um monorepo com workspaces, tooling unificado e scripts padronizados (`lint`, `typecheck`, `test`, `build`, `dev`) que funcionam tanto por app quanto na raiz.

### Resultado esperado

`pnpm install` na raiz instala tudo; `pnpm -w run lint` / `typecheck` / `build` percorrem todos os workspaces; `packages/shared` é importável por `apps/api` e `apps/web`.

### Tasks

**TASK-0.1.1 — Inicializar o monorepo com workspaces (Leonardo).**
Criar o repositório Git com a estrutura fixa:
```
/
├─ apps/
│  ├─ api/        (NestJS — US-0.3)
│  └─ web/        (Next.js 15 — US-0.5)
├─ packages/
│  └─ shared/     (tipos + Zod schemas compartilhados)
├─ package.json   (root, workspaces)
├─ pnpm-workspace.yaml
├─ turbo.json     (orquestrador de tasks; alternativa aceitável: scripts npm-run-all)
├─ tsconfig.base.json
├─ .gitignore
├─ .nvmrc / .node-version  (fixar versão do Node LTS)
└─ README.md
```
Usar **pnpm workspaces** (gerenciador padrão do projeto) + **Turborepo** para cache de tasks. Fixar versões de Node e pnpm (`packageManager` no `package.json` root). Definir os scripts raiz: `dev`, `lint`, `typecheck`, `test`, `build`, `format`.
**Conclusão:** `pnpm install` roda sem erro na raiz e resolve os três workspaces; `pnpm -w run build` executa (mesmo que ainda não haja código, os stubs devem buildar).

**TASK-0.1.2 — Configurar TypeScript base compartilhado (Leonardo).**
Criar `tsconfig.base.json` com `strict: true`, `target`/`module` adequados, `paths` para alias de `@movivo/shared`. Cada app estende o base. `packages/shared` exporta um `tsconfig.json` de build (declaration + composite para project references).
**Conclusão:** `pnpm -w run typecheck` passa em todos os workspaces; import `@movivo/shared` resolve em `apps/api` e `apps/web`.

**TASK-0.1.3 — Configurar ESLint + Prettier compartilhados (Leonardo).**
Config única na raiz (flat config recomendado), com presets para TS/NestJS e TS/React-Next. Prettier com regra única. Adicionar `.editorconfig`. Garantir que lint e format rodem por workspace e na raiz.
**Conclusão:** `pnpm -w run lint` e `pnpm -w run format:check` retornam 0 em um repositório recém-criado.

**TASK-0.1.4 — Esqueleto do `packages/shared` (Leonardo).**
Criar o pacote `@movivo/shared` com estrutura para: (a) tipos TypeScript compartilhados entre back e front, (b) schemas **Zod** compartilhados (DTOs de contrato), (c) enums de domínio (ex.: `SubscriptionStatus`, `ProtocolStatus` — apenas as constantes, sem lógica). Exportar um `index.ts` com um símbolo de exemplo (`APP_VERSION`) para provar o consumo cross-app.
**Conclusão:** `apps/api` e `apps/web` conseguem `import { APP_VERSION } from '@movivo/shared'` e compilar.

**TASK-0.1.5 — Validação de consumo pelo frontend (Felipe).**
Confirmar que o alias `@movivo/shared` resolve no ambiente Next.js 15 (transpilePackages se necessário) e que o tooling de lint/format da raiz cobre `apps/web` sem conflito com regras específicas de React. Reportar a Leonardo qualquer ajuste necessário no `tsconfig.base`/ESLint antes do fechamento da US.
**Conclusão:** relatório curto (comentário no PR) confirmando que `apps/web` consome `packages/shared` e passa em lint/typecheck da raiz.

### Definição de Pronto (US-0.1 "validada")

- [ ] Todas as tasks 0.1.1–0.1.5 concluídas.
- [ ] `pnpm install`, `pnpm -w run lint`, `typecheck`, `build` verdes em clone limpo.
- [ ] Estrutura de pastas idêntica à exigida no `ARQUITETURA.md` §2.
- [ ] **Validada por:** code review de pelo menos 1 outro dev (Felipe revisa o PR de Leonardo) + execução local reproduzível confirmada por Felipe (TASK-0.1.5).

---

## US-0.2 — Ambiente local reprodutível via Docker Compose

**Agentes:** Henrique (lead — dono de todo o `docker-compose`, configs de infra e healthchecks).
**Depende de:** US-0.6 (secrets já definidos para não colocar senha em `environment:`). Pode ser desenvolvida em paralelo a US-0.1.
**Habilita:** US-0.3 e US-0.4 (que precisam do PG/Redis no ar para rodar localmente).

### Jornada

O backend não roda sem banco, pooler e cache. Henrique entrega um `docker-compose.yml` que sobe, em uma rede interna isolada, todos os serviços de dados que a arquitetura exige, já configurados segundo as regras inegociáveis: PostgreSQL com as extensões, PgBouncer em transaction mode na 5433, e Redis em alta disponibilidade (master + replica + Sentinel, quorum=2) — obrigatoriamente numa imagem **já corrigida contra a CVE-2025-49844**. Esse ambiente precisa ser idêntico para os três devs e servir de base para o CI de integração no futuro. É a infraestrutura sobre a qual Leonardo sobe o NestJS.

### Objetivo

Um único comando sobe o stack de dados local completo, com healthchecks, restart policies e resource limits, sem nenhum secret em texto claro no arquivo.

### Resultado esperado

`docker compose up -d` deixa todos os containers `healthy`; a app consegue conectar no Postgres pela 5433 (PgBouncer) e no Redis pela porta interna; o Redis está numa versão patcheada e não exposto à internet.

### Tasks

**TASK-0.2.1 — Serviço PostgreSQL + PGVector (Henrique).**
Container Postgres (imagem com suporte a `pgvector`, ou init que instala a extensão). No script de init (`/docker-entrypoint-initdb.d/`): `CREATE EXTENSION IF NOT EXISTS vector; uuid-ossp; pgcrypto;`. Criar as roles preparando o terreno de RLS de Sato: `movivo_migrator` (dono do schema, roda migrações) e `movivo_app` (`LOGIN`, **`NOBYPASSRLS`**, sem ownership das tabelas) — senhas via Docker Secret. Volume nomeado para persistência. Healthcheck com `pg_isready`. Bind apenas na rede interna (não publicar 5432 fora do necessário para dev).
**Conclusão:** container `healthy`; `SELECT extname FROM pg_extension` lista `vector`, `uuid-ossp`, `pgcrypto`; roles `movivo_migrator` e `movivo_app` existem e `movivo_app` **não** tem `BYPASSRLS`.

**TASK-0.2.2 — Serviço PgBouncer em transaction mode (Henrique).**
Container PgBouncer com `pgbouncer.ini`: `pool_mode = transaction`, `default_pool_size = 50`, `max_client_conn` adequado, `listen_port = 5433`, apontando para o serviço Postgres. Auth via `userlist.txt`/secret (nunca senha em claro no compose). Documentar no README que **a aplicação conecta sempre na 5433**, nunca na 5432 direto.
**Conclusão:** conexão `psql -h localhost -p 5433 -U movivo_app` funciona; `SHOW POOLS;` no console admin do PgBouncer confirma transaction mode.

**TASK-0.2.3 — Redis master + replica + Sentinel, patcheado contra RediShell (Henrique).**
Três containers: `redis-master`, `redis-replica`, `redis-sentinel` (quorum=2). **Imagem obrigatoriamente `>= 8.2.2 / 8.0.4 / 7.4.6 / 7.2.11`** (patch CVE-2025-49844). Config: `appendonly yes`, `appendfsync everysec` (durabilidade de jobs BullMQ), `requirepass` via Docker Secret, `bind` apenas na rede interna, **sem publicar porta para a internet**. Onde EVAL/Lua não for necessário para a app, reduzir superfície conforme recomendação de Sato. Sentinel configurado com `down-after-milliseconds` e `failover-timeout` razoáveis para dev.
**Conclusão:** `redis-cli -a <secret> INFO server` reporta versão patcheada; `INFO replication` mostra replica conectada; Sentinel reporta o master monitorado; nenhuma porta Redis exposta no host além do necessário para dev local.

**TASK-0.2.4 — Orquestração, healthchecks e DX (Henrique).**
Consolidar tudo no `docker-compose.yml`: `depends_on` com `condition: service_healthy`, `restart: unless-stopped`, `deploy.resources.limits` de CPU/memória compatíveis com a VPS KVM 2 (2 vCPU/8GB) para o ambiente espelhar produção. Rede interna dedicada (`movivo-net`). Criar um `Makefile` (ou script pnpm) com alvos `up`, `down`, `logs`, `ps`, `reset` (drop de volumes). Documentar no README o fluxo de subida.
**Conclusão:** `make up` (ou equivalente) deixa 100% dos serviços `healthy` em clone limpo; `make down` e `make reset` funcionam.

### Definição de Pronto (US-0.2 "validada")

- [ ] Tasks 0.2.1–0.2.4 concluídas.
- [ ] `docker compose ps` mostra todos os serviços `healthy`.
- [ ] **Checklist de segurança (Sato) verde:** Redis em versão patcheada (RediShell), nenhum secret em `environment:` (tudo via Docker Secrets — cruzar com US-0.6), Redis/Postgres sem exposição pública indevida, `movivo_app` sem `BYPASSRLS`.
- [ ] **Validada por:** code review de Leonardo (que vai consumir o ambiente) + evidência de execução (saída de `docker compose ps` e das checagens de versão/extensões anexadas ao PR).

---

## US-0.3 — Boilerplate NestJS com módulos CORE

**Agentes:** Leonardo (lead). Consome o ambiente de US-0.2 e o tooling de US-0.1.
**Depende de:** US-0.1 (workspace), US-0.2 (PG/Redis no ar), US-0.6 (config de secrets/env).
**Habilita:** US-0.4 (schema), US-0.7 (algo para buildar/testar no CI).

### Jornada

Com o monorepo e o ambiente de dados prontos, Leonardo cria o `apps/api` como um monólito modular NestJS conforme o **C4 nível 3** de Rafael (`ARQUITETURA.md` §4). Nesta sprint só o **bloco CORE** (infraestrutura compartilhada) é implementado de verdade — `ConfigModule`, `DatabaseModule`, `RedisModule`, `LoggerModule`, e os stubs de `TelemetryModule` e `EventBusModule`. Os módulos de domínio (AUTH, ANAMNESIS, PROTOCOL, WHATSAPP, AI COACH, SUBSCRIPTION, CHECKIN, JOBS, ADMIN/CREF) são criados apenas como **esqueleto vazio registrado**, sem lógica, para que as próximas sprints tenham onde encaixar código sem reestruturar o app. É a fundação que prova que backend, banco (via PgBouncer) e Redis conversam.

### Objetivo

Ter um NestJS que sobe, valida a config por Zod, conecta no Postgres **pela 5433** e no Redis, expõe `GET /health`, e tem a árvore de módulos do C4 nível 3 esboçada com fronteiras explícitas (sem imports circulares).

### Resultado esperado

`pnpm --filter api dev` sobe o servidor; `GET /health` retorna 200 com o status de Postgres e Redis; a estrutura de módulos reflete o diagrama de Rafael.

### Tasks

**TASK-0.3.1 — Scaffold NestJS e bootstrap (Leonardo).**
Gerar `apps/api` (NestJS + TypeScript) dentro do workspace. Configurar `main.ts` com: prefixo global `api/v1` (versionamento de API — regra §12.10), `ValidationPipe` global com whitelist, graceful shutdown hook (`enableShutdownHooks` — preparar o terreno para drenagem de BullMQ das próximas sprints), CORS restrito por env. Porta 3001 (C4 nível 2).
**Conclusão:** `pnpm --filter api dev` sobe sem erro e responde em `http://localhost:3001/api/v1`.

**TASK-0.3.2 — `ConfigModule` com validação Zod das variáveis de ambiente (Leonardo).**
Módulo de configuração global que **valida o `process.env` com Zod no boot** e falha rápido se faltar variável obrigatória (DB, Redis, secrets). Nenhum valor default sensível hardcoded. As variáveis lidas de secrets montados em `/run/secrets/*` (padrão de US-0.6), não de `environment:`.
**Conclusão:** app **não sobe** se uma env obrigatória estiver ausente, com mensagem de erro clara indicando qual variável falta.

**TASK-0.3.3 — `DatabaseModule` (conexão Drizzle via PgBouncer) (Leonardo).**
Provider de conexão Postgres usando **Drizzle** com driver compatível com PgBouncer transaction mode — **desabilitar prepared statements** (regra do PgBouncer, `ARQUITETURA.md` §2/§12). Conectar **sempre na porta 5433** com a role `movivo_app`. Expor o client Drizzle via DI. Ainda sem tabelas (o schema vem em US-0.4), mas com `SELECT 1` de sanidade.
**Conclusão:** o módulo conecta no boot; um probe interno `SELECT 1` via PgBouncer retorna sucesso; confirmado que prepared statements estão desativados.

**TASK-0.3.4 — `RedisModule` (Leonardo).**
Provider de cliente Redis (ioredis) apontando para o Sentinel (descoberta de master), com senha via secret. Preparar convenção de **namespacing de chave por `user_id`** (helper de prefixo) exigida por Sato para tenant isolation — mesmo sem uso real ainda. Sem lógica de fila (BullMQ é sprint futura); apenas conexão + ping.
**Conclusão:** `PING` retorna `PONG` via Sentinel; helper de prefixo de chave disponível e testado por unit test simples.

**TASK-0.3.5 — `LoggerModule` estruturado + stubs de Telemetry/EventBus (Leonardo).**
`LoggerModule` com logging **estruturado em JSON** (pino ou nestjs-pino), com correlation id por request e **regra explícita de nunca logar telefone/PII em claro** (comentário + util de redaction) — requisito LGPD de Sato/Alexandre. Criar `TelemetryModule` e `EventBusModule` como **stubs vazios registrados** (só a casca, para as sprints de observabilidade/CQRS preencherem).
**Conclusão:** logs saem em JSON com correlation id; stubs registrados no `AppModule` sem quebrar o boot.

**TASK-0.3.6 — Esqueleto dos módulos de domínio + HealthController (Leonardo).**
Criar, **vazios**, os módulos de domínio do C4 nível 3: `AuthModule`, `AnamnesisModule`, `ProtocolModule`, `WhatsappModule`, `AiCoachModule`, `SubscriptionModule`, `CheckinModule`, `JobsModule`, `AdminModule` — cada um só com o `@Module({})` e um placeholder, registrados no `AppModule`, respeitando fronteiras (nenhum import circular; dependências só via CORE). Implementar `HealthController` (`GET /api/v1/health`) usando `@nestjs/terminus` para checar Postgres (via PgBouncer) e Redis.
**Conclusão:** árvore de módulos reflete o diagrama de Rafael; `GET /api/v1/health` retorna 200 com `{ db: up, redis: up }`; `nest build` não acusa dependência circular.

### Definição de Pronto (US-0.3 "validada")

- [ ] Tasks 0.3.1–0.3.6 concluídas.
- [ ] `GET /api/v1/health` verde com Postgres (via 5433) e Redis reportando `up`.
- [ ] Config falha-rápido por Zod; nenhum secret hardcoded; prepared statements desativados.
- [ ] Estrutura de módulos = C4 nível 3 de Rafael, sem imports circulares.
- [ ] **Validada por:** code review de outro dev + smoke test automatizado do `/health` verde no pipeline (integra com US-0.8) + confirmação de que o boot falha sem env obrigatória.

---

## US-0.4 — Schema inicial Drizzle e migração base

**Agentes:** Leonardo (lead).
**Depende de:** US-0.3 (`DatabaseModule`) e US-0.2 (Postgres com extensões).
**Habilita:** todas as sprints de domínio (que estendem esse schema).

### Jornada

As próximas sprints precisam de tabelas para persistir usuários, anamnese, protocolos, conversas, check-ins, assinaturas e jobs de IA. Leonardo materializa o **schema lógico já definido** por Lucas (`08-relatorio-lucas.md` §9) e Rafael (DDL completo no `10-relatorio-rafael.md`) como schema Drizzle e uma **primeira migração** versionada. Nesta sprint o foco é criar as tabelas-base com suas colunas essenciais, chaves e as extensões/estruturas transversais (UUID, timestamps, `user_id` para o isolamento futuro) — **não** é necessário o DDL 100% completo com todos os índices HNSW, particionamento e triggers de audit append-only; esses detalhes de segurança/performance são endereçados nas sprints correspondentes por Leonardo com Sato. O objetivo é ter o esqueleto relacional aplicável e reversível.

### Objetivo

Uma migração Drizzle inicial, aplicável e reversível, criando as tabelas-base referenciadas no schema lógico, rodada pela role `movivo_migrator`.

### Resultado esperado

`pnpm --filter api db:migrate` cria as tabelas no Postgres; `drizzle-kit` gera migrações versionadas commitadas; a role de aplicação (`movivo_app`) tem apenas os grants necessários (não é dona das tabelas).

### Tasks

**TASK-0.4.1 — Definir o schema Drizzle das tabelas-base (Leonardo).**
Traduzir para Drizzle o schema lógico de `08-relatorio-lucas.md` §9 (referência; não recopiar DDL): `users`, `anamnesis_sessions`, `consents`, `protocols`, `protocol_versions`, `conversations`, `checkins`, `subscriptions`, `ai_jobs`. Para cada tabela: PK UUID (`uuid-ossp`/`gen_random_uuid`), colunas essenciais do schema lógico, `created_at`/`updated_at`, e a coluna **`user_id`** onde aplicável (fundação do tenant isolation). Marcar com comentário `-- LGPD Art.11` as colunas de saúde que serão cifradas com `pgcrypto` na sprint de anamnese (não implementar a cifra agora). Não é exigido o DDL completo (índices HNSW, partições, triggers de audit) nesta sprint.
**Conclusão:** arquivos de schema Drizzle compilam e cobrem as 9 tabelas-base com PK, `user_id` e timestamps.

**TASK-0.4.2 — Configurar drizzle-kit e gerar a migração inicial (Leonardo).**
Configurar `drizzle.config.ts` (dialeto Postgres, saída de migrações versionadas em `apps/api/drizzle/`). Adicionar scripts `db:generate`, `db:migrate`, `db:studio`. Gerar a **migração `0000_init`** commitada no repositório. A migração deve incluir/garantir as extensões (`vector`, `uuid-ossp`, `pgcrypto`) caso não criadas no init do container.
**Conclusão:** `pnpm --filter api db:generate` produz a migração; ela está commitada; re-gerar não produz diff (schema e migração consistentes).

**TASK-0.4.3 — Aplicar migração com a role correta e definir grants (Leonardo).**
`db:migrate` roda com a role **`movivo_migrator`** (dona do schema). Definir `GRANT SELECT/INSERT/UPDATE/DELETE` mínimos para `movivo_app` nas tabelas — **sem** ownership e **sem** `BYPASSRLS** — deixando o terreno pronto para as políticas RLS `FORCE ROW LEVEL SECURITY` das próximas sprints (Sato §9). Documentar no README o comando de migração e o de reset.
**Conclusão:** tabelas existem no banco após `db:migrate`; `movivo_app` consegue CRUD mas não é dona das tabelas; migração é reversível/reaplicável em `make reset`.

**TASK-0.4.4 — Seed mínimo de desenvolvimento (Leonardo).**
Script de seed idempotente criando 1-2 usuários fictícios **sem PII real** (dados sintéticos) para desenvolvimento e para os testes de integração de Mariana (US-0.8). Nunca dados reais de pessoas.
**Conclusão:** `pnpm --filter api db:seed` popula o banco de forma idempotente; rodar duas vezes não duplica nem quebra.

### Definição de Pronto (US-0.4 "validada")

- [ ] Tasks 0.4.1–0.4.4 concluídas.
- [ ] Migração `0000_init` commitada, aplicável e reaplicável (via `make reset` + `db:migrate`).
- [ ] `movivo_app` sem ownership e sem `BYPASSRLS`; grants mínimos aplicados.
- [ ] Colunas de saúde marcadas para cifra futura; extensões garantidas.
- [ ] **Validada por:** code review + teste de integração que roda a migração num Postgres limpo e verifica a existência das 9 tabelas (integra com US-0.8) + confirmação do modelo de permissões (checklist Sato).

---

## US-0.5 — Boilerplate Next.js 15 (App Router) mínimo

**Agentes:** Felipe (lead).
**Depende de:** US-0.1 (workspace + `packages/shared`).
**Habilita:** US-0.7 (build do front no CI); Sprint 1 (landing + formulário).

### Jornada

O frontend precisa existir no monorepo desde já, mesmo sem telas de produto, para que o design system de Kimura ("O Pulso") e as futuras páginas (landing, formulário conversacional, dashboard CREF) tenham onde nascer, e para que o CI já saiba buildar o app web. Felipe cria o `apps/web` com Next.js 15 (App Router, React 19), Tailwind + shadcn/ui pré-configurados com os tokens da marca, PostHog instrumentado como stub, e uma home renderizada via RSC que consome `@movivo/shared` (provando a integração de monorepo). Nada de lógica de negócio — apenas a casca performática e acessível.

### Objetivo

Um Next.js 15 com App Router que builda, roda, renderiza a home via RSC, tem o design system e o Tailwind configurados com os tokens de Kimura, e consome `packages/shared`.

### Resultado esperado

`pnpm --filter web dev` sobe o app na 3000; `pnpm --filter web build` passa; a home usa um componente shadcn/ui estilizado com os tokens da marca.

### Tasks

**TASK-0.5.1 — Scaffold Next.js 15 + App Router (Felipe).**
Gerar `apps/web` com Next.js 15 (App Router, React 19, TypeScript), porta 3000. Estrutura base de rotas em `app/` com um layout raiz e a home. Configurar `transpilePackages` para `@movivo/shared` se necessário. Garantir que o app entra no tooling da raiz (lint/typecheck/build).
**Conclusão:** `pnpm --filter web dev` sobe; `pnpm --filter web build` passa; home renderiza como RSC.

**TASK-0.5.2 — Tailwind + shadcn/ui com tokens de Kimura (Felipe).**
Configurar Tailwind CSS e inicializar shadcn/ui. Mapear os **design tokens do design system "O Pulso"** (cores, tipografia, espaçamento — de `04-relatorio-kimura.md`) para o tema Tailwind e as CSS variables do shadcn (incluindo dark mode). Adicionar 1 componente de exemplo (ex.: `Button`) estilizado com os tokens da marca na home, para provar o pipeline de design system.
**Conclusão:** a home exibe um componente shadcn/ui com as cores/tipografia da marca; dark mode alterna corretamente.

**TASK-0.5.3 — Consumo de `packages/shared` e config por env (Felipe).**
Importar `APP_VERSION` (ou tipo compartilhado) de `@movivo/shared` e exibir/usar no app, provando a integração. Configurar leitura de variáveis públicas (`NEXT_PUBLIC_*`) via `.env.example` (nunca `.env` real commitado — cruzar com US-0.6). Nenhum secret de servidor exposto ao cliente.
**Conclusão:** o app usa um símbolo de `@movivo/shared`; build passa lendo apenas de `.env.example`/env locais.

**TASK-0.5.4 — Instrumentação PostHog (stub) e baseline de performance/acessibilidade (Felipe).**
Instalar e inicializar o **PostHog** como provider (stub — sem eventos de funil ainda, que são das sprints de produto), com a key vindo de env. Garantir baseline: metadata básica (SEO), `lang="pt-BR"`, HTML semântico, e um Lighthouse local sem regressões grosseiras (alvo LCP ≤ 1,5s da landing é meta de Sprint 1, mas a casca não deve nascer pesada).
**Conclusão:** PostHog inicializa sem erro quando a key está presente e degrada graciosamente quando ausente; home passa em checagem de acessibilidade básica (sem violações críticas de axe).

### Definição de Pronto (US-0.5 "validada")

- [ ] Tasks 0.5.1–0.5.4 concluídas.
- [ ] `pnpm --filter web build` e `lint`/`typecheck` verdes.
- [ ] Home renderiza via RSC com componente do design system de Kimura e consome `@movivo/shared`.
- [ ] Nenhum secret no cliente; só `.env.example`.
- [ ] **Validada por:** code review de outro dev + build verde no CI (US-0.7) + checagem de acessibilidade básica (axe) sem violação crítica.

---

## US-0.6 — Gestão de secrets para ambiente local e CI

**Agentes:** Henrique (lead — implementa) · aplica requisitos de Sato (`11-relatorio-sato.md` §9) · consumido por Leonardo (US-0.3) e Felipe (US-0.5).
**Depende de:** nada estrutural — começa no dia 1, em paralelo a US-0.1. **Precede** US-0.2 (compose usa os secrets) e US-0.7 (CI usa secret scanning).
**Habilita:** todas as demais US que precisam de credenciais.

### Jornada

Nenhum segredo pode ser versionado no Git — regra inegociável §12.7 e mandato de Sato. Antes de subir qualquer container ou pipeline, Henrique estabelece o **modelo de gestão de secrets**: em desenvolvimento local, **Docker Secrets** montados em `/run/secrets/*` (tmpfs), nunca em `environment:` (que vaza em `docker inspect`); no repositório, apenas um **`.env.example`** com placeholders e chaves documentadas; no CI, os secrets vêm de **GitHub Actions Secrets** com escopo mínimo. Isso protege desde o dia 1 as credenciais de Postgres, Redis, e (nas próximas sprints) JWT, webhooks e chaves de LLM/pagamento.

### Objetivo

Um esquema de secrets que garante que nada sensível entra no Git, que o ambiente local usa Docker Secrets, e que o CI usa GitHub Secrets — com `.gitignore` e secret scanning prontos para impedir vazamento acidental.

### Resultado esperado

Existe `.env.example` completo e documentado; existe convenção de Docker Secrets consumida pelo compose e pela app; `.gitignore` cobre `*.env`, `*.key`, `*.pem`, `certs/`; nenhum secret real no histórico.

### Tasks

**TASK-0.6.1 — `.env.example` e `.gitignore` blindados (Henrique).**
Criar `.env.example` na raiz e por app, listando **todas** as variáveis necessárias com placeholders e comentários (DB URL via 5433, Redis/Sentinel, chaves públicas de PostHog, e placeholders comentados para JWT/webhooks/LLM que entram nas próximas sprints). Ajustar `.gitignore` para cobrir `*.env` (exceto `*.env.example`), `*.key`, `*.pem`, `certs/`, `/run/secrets`. Validar que nenhum `.env` real está rastreado.
**Conclusão:** `git ls-files` não retorna nenhum `.env` real nem chave; `.env.example` cobre todas as variáveis usadas por US-0.2/0.3/0.5.

**TASK-0.6.2 — Docker Secrets para o ambiente local (Henrique).**
Definir os secrets no `docker-compose.yml` via bloco `secrets:` (arquivos locais em `secrets/` que estão no `.gitignore`), montados em `/run/secrets/*`. Cobrir: senha do Postgres (`movivo_app` e `movivo_migrator`), senha/ACL do Redis, `userlist` do PgBouncer. **Nunca** usar `environment:` para esses valores. Documentar no README como gerar os secrets locais (script `scripts/gen-local-secrets.sh` que cria valores aleatórios).
**Conclusão:** containers leem credenciais de `/run/secrets/*`; `docker inspect` não revela senha em `environment`; script de geração de secrets locais funciona.

**TASK-0.6.3 — Convenção de consumo de secrets pela aplicação (Henrique + Leonardo).**
Padronizar como o NestJS (US-0.3) lê secrets: preferir arquivo montado (`*_FILE` apontando para `/run/secrets/...`) sobre env direta. Henrique define o contrato; Leonardo o consome no `ConfigModule`. Garantir alinhamento para não haver secret em env de processo quando evitável.
**Conclusão:** o `ConfigModule` (US-0.3) lê as credenciais via arquivo de secret; documentado no README.

**TASK-0.6.4 — GitHub Actions Secrets e política de CI (Henrique).**
Definir no repositório os secrets de CI necessários (mínimos para Sprint 0: nenhum secret de produção; apenas tokens de scanners se aplicável) como **GitHub Actions Secrets**, com escopo mínimo e sem long-lived tokens (preferir OIDC quando deploy existir — deploy não é escopo da Sprint 0). Documentar a política: quais secrets existem, quem rotaciona, cadência (herdar a tabela de rotação de Sato §9 como referência para as próximas sprints).
**Conclusão:** documento curto no README/`docs/SECURITY.md` lista os secrets de CI e a política; nenhum secret hardcoded em workflow YAML.

### Definição de Pronto (US-0.6 "validada")

- [ ] Tasks 0.6.1–0.6.4 concluídas.
- [ ] **Checklist de segurança (Sato §9) verde:** nada sensível em `environment:`, `.gitignore` cobre `*.env`/`*.key`/`*.pem`/`certs/`, secrets locais via Docker Secrets, secrets de CI via GitHub Secrets.
- [ ] `.env.example` cobre 100% das variáveis usadas na sprint.
- [ ] **Validada por:** code review + execução do `gitleaks`/secret scanning (de US-0.7) sem nenhum achado em todo o histórico do repo.

---

## US-0.7 — CI/CD com quality gates e estágios de segurança (DevSecOps)

**Agentes:** Henrique (lead — implementa o workflow) · Mariana (define os quality gates e thresholds — US-0.8) · requisitos de Sato (`11-relatorio-sato.md` §12).
**Depende de:** US-0.1 (algo para lintar/buildar), US-0.3 e US-0.5 (apps com scripts de test/build), US-0.6 (secret scanning), US-0.8 (thresholds de qualidade definidos por Mariana).
**Habilita:** merges seguros em `main` a partir do fim da sprint.

### Jornada

A partir do primeiro merge, nada entra em `main` sem passar por um portão automatizado. Henrique constrói o pipeline no **GitHub Actions** com o fluxo `lint → typecheck → test → build`, encadeado com os **estágios de segurança obrigatórios de Sato**: secret scanning (gitleaks + GitHub push protection), SAST (semgrep/CodeQL) e SCA (`npm audit` / dependency scan). Mariana define os limiares de qualidade (cobertura, o que bloqueia). O resultado é um quality gate que torna a qualidade e a segurança "inevitáveis" — o vocabulário da própria Mariana.

### Objetivo

Um workflow de CI que roda em todo PR e push, executa qualidade + segurança em todos os workspaces, e é configurado como **status check obrigatório** para merge em `main` (branch protection).

### Resultado esperado

PR abre → CI roda `lint → typecheck → test → build` + `secret-scan → SAST → SCA` → merge bloqueado se qualquer etapa falhar ou se houver secret/CVE crítica.

### Tasks

**TASK-0.7.1 — Workflow base de qualidade (Henrique).**
Criar `.github/workflows/ci.yml` disparado em `pull_request` e `push`. Jobs: setup (Node LTS + pnpm com cache), `lint`, `typecheck`, `test` (unit; integração onde já houver — US-0.8), `build` de `apps/api` e `apps/web`. Usar cache do Turborepo/pnpm para velocidade. Matriz por workspace quando fizer sentido.
**Conclusão:** o workflow roda verde em um PR de teste, cobrindo os três workspaces.

**TASK-0.7.2 — Estágio de secret scanning (Henrique + Sato).**
Adicionar job de **secret scanning** com `gitleaks detect` e ativar **GitHub secret scanning + push protection** no repositório. Falhar o pipeline se qualquer secret for detectado.
**Conclusão:** o job roda em todo PR; um secret plantado de teste é detectado e bloqueia o merge; push protection ativo no repo.

**TASK-0.7.3 — Estágio SAST (Henrique + Sato).**
Adicionar **SAST** com `semgrep --config auto --error` (regras OWASP + TypeScript); opcionalmente CodeQL como 2ª camada. Falhar em finding HIGH.
**Conclusão:** job SAST roda em todo PR; findings HIGH bloqueiam merge; baseline sem findings HIGH no código da sprint.

**TASK-0.7.4 — Estágio SCA / dependency scanning (Henrique + Sato).**
Adicionar **SCA**: `npm/pnpm audit --audit-level=high` + (Snyk ou OWASP Dependency-Check) para CVEs transitivos. Ativar **Dependabot/Renovate** para bumps automáticos de dependências vulneráveis (ex.: ioredis/BullMQ/Redis client). Falhar em CVE HIGH/CRITICAL sem exceção documentada e datada.
**Conclusão:** job SCA roda em todo PR; CVE HIGH/CRITICAL bloqueia; Dependabot/Renovate ativo e abrindo PRs.

**TASK-0.7.5 — Branch protection e status checks obrigatórios (Henrique).**
Configurar branch protection em `main`: PR obrigatório com ≥1 review, **todos os status checks verdes** (qualidade + segurança) antes de merge, sem force-push. Least privilege nos tokens do GitHub Actions (escopo mínimo, sem long-lived).
**Conclusão:** é impossível fazer merge em `main` com CI vermelho ou sem review; configuração evidenciada em screenshot/descrição no PR.

**TASK-0.7.6 — Integração dos quality gates de Mariana (Henrique + Mariana).**
Incorporar ao job `test` os limiares definidos por Mariana em US-0.8 (cobertura mínima global, gates específicos). O CI deve **falhar** se a cobertura ficar abaixo do threshold definido.
**Conclusão:** o pipeline reprova um PR que derrube a cobertura abaixo do limiar de Mariana.

### Definição de Pronto (US-0.7 "validada")

- [ ] Tasks 0.7.1–0.7.6 concluídas.
- [ ] Pipeline `lint → typecheck → test → build` + `secret-scan → SAST → SCA` verde em PR real.
- [ ] **Quality gates de segurança de Sato (§12.3) ativos:** nenhum secret, zero CVE HIGH/CRITICAL sem exceção, SAST sem HIGH.
- [ ] Branch protection em `main` com status checks obrigatórios.
- [ ] **Validada por:** demonstração de que um PR "ruim" (secret plantado / dependência vulnerável / teste quebrado / cobertura baixa) é **bloqueado**, e um PR "bom" passa. Review de Sato (conceitual) e Mariana (gates) registrado.

---

## US-0.8 — Quality gate mínimo e infraestrutura de testes

**Agentes:** Mariana (lead — define estratégia, thresholds e infra de teste). Colabora com Leonardo (testes de `apps/api`), Felipe (testes de `apps/web`) e Henrique (integração no CI, US-0.7).
**Depende de:** US-0.3 e US-0.5 (apps existirem para configurar runners). **Alimenta** US-0.7 (thresholds).
**Habilita:** disciplina de qualidade em todas as sprints seguintes.

### Jornada

Mariana estabelece, desde a fundação, o **mínimo de qualidade automatizado** que precisa existir antes de aceitar qualquer merge — porque introduzir testes depois é sempre mais caro. Nesta sprint ela não escreve os testes de negócio (que virão com o código de domínio), mas monta a **infraestrutura de testes** (runners unitário e de integração para back e front), define os **quality gates** (cobertura mínima, o que é bloqueante) e cria os **testes-semente** que provam a fundação: smoke test do `/health` (US-0.3), teste de migração em banco limpo (US-0.4), teste de consumo de `packages/shared`. Já deixa **documentado e reservado** — sem exigir implementação agora — o mandato de Rafael/Sato de **100% de cobertura no Motor Determinístico** e os testes de isolamento multi-tenant, que se tornam bloqueantes nas sprints em que esse código nascer.

### Objetivo

Ter runners de teste configurados nos dois apps, thresholds de cobertura definidos e aplicados no CI, e uma suíte-semente que valida a fundação (health, migração, shared).

### Resultado esperado

`pnpm -w run test` roda unit + integração de fundação e reporta cobertura; o CI usa esses thresholds como gate; a política de quality gates da MOVIVO está documentada.

### Tasks

**TASK-0.8.1 — Infraestrutura de testes do backend (Mariana + Leonardo).**
Configurar **Vitest/Jest + Supertest** em `apps/api` com relatório de cobertura. Definir a convenção de testes (unit vs. integração) e o setup de um Postgres/Redis efêmeros para integração (reaproveitando o Docker Compose de US-0.2 ou testcontainers). Script `test` e `test:cov`.
**Conclusão:** `pnpm --filter api test` roda e emite cobertura; ambiente de integração sobe/derruba limpo.

**TASK-0.8.2 — Infraestrutura de testes do frontend (Mariana + Felipe).**
Configurar **Vitest + Testing Library** para componentes e **Playwright** para 1 smoke E2E (home carrega, componente do design system aparece). Script `test` e `test:e2e`.
**Conclusão:** `pnpm --filter web test` roda; smoke E2E do Playwright passa contra o dev server.

**TASK-0.8.3 — Testes-semente da fundação (Mariana, com Leonardo/Felipe).**
Escrever a suíte mínima que prova a fundação: (a) **smoke test** de `GET /api/v1/health` retornando `db: up, redis: up` (US-0.3); (b) **teste de integração de migração** que aplica `0000_init` num Postgres limpo e verifica as 9 tabelas (US-0.4); (c) **teste** de consumo de `@movivo/shared` entre apps (US-0.1). Sem dados reais — usar o seed sintético (US-0.4).
**Conclusão:** os três testes-semente passam localmente e no CI.

**TASK-0.8.4 — Definição dos quality gates e limiares (Mariana).**
Documentar (em `docs/qualidade/quality-gates.md` ou `TESTING.md`) os gates que valem já e os reservados:
- **Já bloqueantes na Sprint 0:** lint/typecheck/build verdes; testes-semente verdes; **cobertura global mínima ≥ 80%** (meta herdada de Rafael §17/Sato) medida sobre o código existente; secret/SAST/SCA verdes (US-0.7).
- **Reservados (viram bloqueantes quando o código nascer):** **100% de cobertura no Motor Determinístico** (Sprint 2), testes de **isolamento multi-tenant** Redis+Postgres (Sprints 1-3), testes de **compliance CREF** pós-geração (Sprint 3), testes de webhook/DLQ (Sprints 3-4), teste de cron do check-in em timezone São Paulo (Sprint 5), testes de carga 500 usuários / p95 30s (Sprint 6).
Entregar a Henrique os valores numéricos para wiring no CI (TASK-0.7.6).
**Conclusão:** documento de quality gates aprovado; thresholds numéricos entregues para US-0.7; distinção clara entre gate ativo e reservado.

**TASK-0.8.5 — Checklist de aceite de merge (Definition of Done do time) (Mariana).**
Criar o **checklist de DoD** que todo PR deve cumprir a partir de agora (base para PR template): CI verde (qualidade + segurança), review de ≥1 dev, sem secret, cobertura dentro do gate, sem CVE HIGH/CRITICAL não documentada. Publicar como `.github/pull_request_template.md`.
**Conclusão:** PR template presente no repositório e referenciando o checklist.

### Definição de Pronto (US-0.8 "validada")

- [ ] Tasks 0.8.1–0.8.5 concluídas.
- [ ] Runners de teste configurados em `apps/api` e `apps/web`; testes-semente verdes local e no CI.
- [ ] Documento de quality gates publicado, com gates ativos e reservados explícitos; thresholds integrados ao CI (US-0.7).
- [ ] PR template com checklist de DoD no repositório.
- [ ] **Validada por:** review de Mariana + confirmação de que o CI (US-0.7) efetivamente reprova PR abaixo do threshold de cobertura e aprova PR conforme.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-0.1 | Monorepo e tooling | Leonardo | Felipe | Felipe (review + exec) |
| US-0.2 | Docker Compose local | Henrique | — | Leonardo + checklist Sato |
| US-0.3 | Boilerplate NestJS CORE | Leonardo | Henrique (secrets) | Review + smoke `/health` (Mariana) |
| US-0.4 | Schema Drizzle inicial | Leonardo | — | Review + teste de migração (Mariana) + checklist Sato |
| US-0.5 | Boilerplate Next.js 15 | Felipe | — | Review + build CI + axe |
| US-0.6 | Gestão de secrets | Henrique | Leonardo | Review + gitleaks (Sato) |
| US-0.7 | CI/CD + DevSecOps | Henrique | Mariana, Sato | Demonstração PR bom/ruim |
| US-0.8 | Quality gate + test infra | Mariana | Leonardo, Felipe, Henrique | Review Mariana + gate ativo no CI |

## Critério de conclusão da Sprint 0 (aceite do Épico 0)

A Sprint 0 é considerada **entregue** quando **as 8 User Stories estiverem no estado "validada"** conforme seus DoDs, o que na prática significa:

1. Clone limpo + um comando sobem o stack local com todos os serviços `healthy`.
2. NestJS conecta em PG (via 5433) e Redis, e `/health` está verde.
3. Migração Drizzle inicial aplica as 9 tabelas-base num banco limpo.
4. Next.js 15 builda e renderiza a home com o design system de Kimura.
5. CI verde com qualidade **e** segurança (secret/SAST/SCA), e `main` protegida por status checks obrigatórios.
6. Zero secret real no repositório; Redis patcheado contra RediShell; `movivo_app` sem `BYPASSRLS`.
7. Quality gate ativo (cobertura ≥ 80%) e política de gates reservados documentada.

### Handoff para a Sprint 1

Concluída a fundação, a Sprint 1 (Core Usuário / Anamnese — `ARQUITETURA.md` §10) começa **sem bloqueadores de infraestrutura**. Antes de implementar AUTH e ANAMNESIS, Leonardo e Felipe devem ler, conforme instrução de Rafael (§10): o consentimento LGPD de Alexandre, os wireframes de Sofia e o threat model de Sato. Este documento cobre **apenas** a Sprint 0; o planejamento detalhado das Sprints 1-6 será feito por Lucas depois, com base no aprendizado desta sprint.

---

*Documento de planejamento operacional da Sprint 0 — Lucas Monteiro (PM/PO). Fonte de escopo: `ARQUITETURA.md` §10 (Rafael). Requisitos de segurança incorporados de `11-relatorio-sato.md` §9/§12. Consistência de produto com Épicos 1-7 de `08-relatorio-lucas.md`.*
