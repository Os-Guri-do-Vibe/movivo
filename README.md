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
- [Scripts da raiz](#scripts-da-raiz)
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

> **Status atual (US-0.1):** `apps/api` e `apps/web` são **stubs** mínimos que compilam e
> provam o tooling. O NestJS real entra na **US-0.3** e o Next.js 15 real na **US-0.5**.

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
