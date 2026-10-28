# MOVIVO — Assessoria de movimento por WhatsApp (v2)

Este repositório é o produto **MOVIVO 2.0**: monorepo `apps/api` (NestJS), `apps/web` (Next.js) e `packages/shared` (contratos Zod). Branch de trabalho da v2: `movivo-app-v2`; o deploy de produção acontece apenas no push para `main`.

Documentos de planejamento e de entrega da v2 (inventário, especificação, plano de entregas M0–M11 e relatórios) ficam **fora do repositório**, em `movivo-docs/v2/`. O pipeline de agentes de criação de startups que originou a MOVIVO continua disponível em `.claude/agents/` (ver seção final).

---

## 🐴 Modo de trabalho — Ponytail (lazy senior dev)

> Ruleset do plugin **Ponytail** (MIT — DietrichGebert/ponytail), embutido aqui para o **Codex**, que lê este `AGENTS.md`. No **Claude Code** o Ponytail está instalado como plugin (`.claude/settings.json`), com os slash commands `/ponytail`, `/ponytail-review`, `/ponytail-audit`, `/ponytail-debt`, `/ponytail-gain`. Para o plugin completo no Codex, quando o `codex` CLI estiver instalado: `codex plugin marketplace add DietrichGebert/ponytail` e `codex plugin add ponytail@ponytail`.

You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written.

Before writing any code, stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that's already here, don't re-write it.
3. Does the standard library already do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

The ladder runs after you understand the problem, not instead of it: read the task and the code it touches, trace the real flow end to end, then climb.

Bug fix = root cause, not symptom: grep every caller of the function you touch and fix the shared function once — one guard there is um diff menor que um por caller, e corrigir só o caminho que o ticket nomeia deixa um caller irmão ainda quebrado.

Rules:

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Mark deliberate simplifications that cut a real corner with a `ponytail:` comment naming the ceiling and upgrade path.

Not lazy about: understanding the problem, input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested. Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind (assert-based self-check ou um arquivo de teste pequeno; sem frameworks/fixtures). Trivial one-liners need no test.

> **Nota MOVIVO:** este modo reforça as regras de segurança deste documento: o "lazy" nunca corta segurança, LGPD, validação de PAR-Q nem os guardrails de linguagem.

---

---


## O produto

Assessoria de movimento, performance e bem-estar entregue pelo **WhatsApp**, com **agentes de IA muito capazes** que operam dentro de **políticas versionadas escritas por profissionais** (CREF para treino, CRN para nutrição, CRM para saúde). O profissional entra **por exceção**: sinal de segurança, situação sem política aplicável ou pedido de revisão do aluno.

- **Modalidades:** musculação, corrida, HYROX e híbrido (o planejador reorganiza a semana), mais **nutrição contínua** e avaliação corporal opcional (medidas e fotos, com consentimento próprio).
- **Plano único com tudo incluso**, em quatro períodos (mensal, trimestral, semestral e anual). Preços e descontos vivem em `packages/shared/src/schemas/subscription.schema.ts`; trial de 7 dias sem cartão.
- **Aluno sem login e sem PWA:** links mágicos de uso único enviados por WhatsApp (sessão do dia, check-in, alimentação, evolução, plano, conta).
- **Corrida/HYROX sem integração obrigatória:** registro por print do relógio/app no WhatsApp (visão + confirmação do aluno), upload `.fit`/`.gpx` ou digitação manual.
- **Alunos da versão anterior:** anamnese complementar (campos novos, dados antigos pré-preenchidos, novo aceite dos textos vigentes) e planos novos; o plano antigo não é migrado. Campanha pelo painel: *Sistema → Scripts → Campanha da anamnese complementar*.
- **Fundadores:** Rodrigo 40% (dev), Pedro 20% (dev), Cahuã 20% (marca/vendas, rosto público; a marca é a MOVIVO, nunca o Cahuã) e Leonardo (Léo) 20% (treinador, Responsável Técnico CREF). Quadro a formalizar em contrato social e Acordo de Sócios.
- **LLM:** gate neutro por fornecedor (ADR-005-R2). Nenhum endpoint recebe dado de saúde sem DPA, transferência internacional, retenção/no-training, suboperadores e segurança aprovados; o gate fecha antes do envio no `ModelGateway`.

### Direcionamento estratégico de marca (vigente — v1.0, out/2026)

Fonte: `Direcionamento_Estrategico_de_Marca_MOVIVO.docx` (raiz do repositório). **Em conflito com os relatórios de Fase 1 (Gabriel, Kimura, Helena) ou com copy antiga, este direcionamento prevalece.** O próprio documento separa *princípios* (vigentes) de *propostas a validar* (não são compromissos operacionais nem devem ser prometidos publicamente).

**Vigente**

- **Marca:** MOVIVO — *move your potential*. Marca de movimento, performance e bem-estar; não se limita a musculação nem a uma modalidade (cabe começar a treinar, correr, performance, recuperação, hábitos).
- **Propósito:** democratizar o acesso a orientação de qualidade para que mais pessoas cuidem de si, desenvolvam seu potencial e construam uma vida em movimento.
- **Visão:** marca brasileira reconhecida por tornar movimento e bem-estar mais acessíveis, relevantes e presentes no cotidiano, conectando serviço, experiência, conteúdo e comunidade.
- **Promessa:** ajudar cada pessoa a avançar a partir do próprio ponto de partida, com orientação adequada, acompanhamento e uma cultura que valoriza a consistência.
- **Posicionamento:** "uma assessoria de movimento, performance e bem-estar de alto nível ao alcance de todos". Premium = qualidade percebida, clareza e cuidado, **não** inacessibilidade. Fala com quem está começando *e* com quem busca performance; não exclusivamente com atletas.
- **Papel da IA:** ferramenta de apoio à operação e à experiência (organizar informações, facilitar interações, apoiar personalização). **Não** é substituta do julgamento profissional nem o principal motivo para escolher a MOVIVO. Comunicar com transparência onde a tecnologia entra, o papel do profissional e os limites do serviço. Reforça os guardrails de linguagem abaixo.
- **Princípio central:** "Somos melhores do que éramos ontem" — evolução medida contra o próprio ponto de partida, sem comparação permanente com os outros.
- **Inimigo conceitual:** potencial desperdiçado (desistir por falta de orientação; sensação de que cuidar de si é inacessível). Tratar sempre com incentivo, **nunca com culpa, vergonha ou humilhação**.
- **Frase de ação:** "Sou. Nós fazemos acontecer!"
- **Valores:** Evolução, Consistência, Acessibilidade, Responsabilidade, Humanidade, Ação, Comunidade.
- **Personalidade e voz:** premium sem arrogância; aspiracional sem promessas irreais; motivadora sem pressionar; tecnológica sem frieza; científica e responsável, com proximidade; inclusiva; confiante sem ostentação. Falar de evolução, jornada, consistência, movimento e potencial; mensagens claras e humanas, sem jargão nem motivação vazia; celebrar ação e progresso real sem reduzir a pessoa ao corpo ou ao desempenho.
- **Identidade visual (referência):** direção premium/activewear, fotografia humana, editorial e diversa, composição limpa; verde como acento, sem excesso de neon, clichê de academia ou estética genérica de IA. Paleta: Petróleo Vivo `#06302A`, Verde Pulso `#25E27E`, Coral Vivo `#FF6A3D`, Névoa `#F4F7F3`, Grafite `#14201C`, Musgo `#5B6B63`, Branco `#FFFFFF`.
- **Reconhecimento:** princípio de reconhecer o cumprimento do **compromisso individual (consistência relativa ao plano)**, não o maior volume de treino.
- **Filtro de decisão** para campanha, feature, parceria ou iniciativa: ajuda as pessoas a evoluir? entrega valor real? preserva responsabilidade profissional e transparência? é acessível a diferentes pontos de partida? fortalece confiança de longo prazo? é coerente com a personalidade premium/humana? conseguimos cumprir o que prometemos?

**A validar (exploratório — não usar como compromisso em produto, copy ou UI)**

- **MOVIVO CLUB** (comunidade; pode começar no WhatsApp, mas o canal não é a comunidade), **MOVERS** (nome dos membros), **THE FIRST 100 / Founding Members** (critérios, benefícios e duração indefinidos), níveis **ACTIVE / CORE / ELITE / ICON**, e o conceito "You don't move alone". Participação acima de status financeiro: reconhecimento não pode depender de pagar mais.
- Próximos passos do documento: formalizar a mensagem principal, validar linguagem com membros beta, definir escopo do CLUB, desenhar um ritual recorrente, decidir Founding Members, criar guia de voz aplicado e medir sinais de pertencimento.

**Implicações para código, copy e prompts:** não apresentar a IA como protagonista; manter o respaldo CREF visível; nenhuma promessa de resultado; nada de tom de culpa ou comparação entre usuários; tratar nomes de comunidade/níveis como inexistentes até validação.

**Implicações para código, copy e prompts:** não apresentar a IA como protagonista; manter o respaldo profissional visível; nenhuma promessa de resultado; nada de tom de culpa ou comparação entre usuários; tratar nomes de comunidade e níveis como inexistentes até validação.

### Guardrails de linguagem — inegociáveis em todo código, copy, prompt de IA e UI

Herdados de Clóvis e Gabriel, valem para **qualquer texto gerado pelo sistema ou pela equipe** (prompts de IA, mensagens de WhatsApp, UI, marketing):

- **Nunca** usar "diagnóstico", "tratamento" ou "cura".
- **Nunca** prometer "resultado garantido".
- A IA **nunca** é apresentada como quem decide ou prescreve sozinha — a formulação correta é sempre "profissional CREF, usando IA como ferramenta".
- A presença/respaldo do profissional CREF deve ser sempre visível ao usuário.

---

## Arquitetura

### Fluxo central: proposta → política → decisão → execução

1. Um **agente de tarefa** (`core/agents`: `defineAgentTask` + `AgentRunner`) recebe contexto montado **pelo código** e devolve uma **proposta tipada** (Zod). O modelo **nunca escreve nada** nem recebe ferramenta (`llm-no-tool-surface.spec.ts` trava isso).
2. O **motor de políticas** (`modules/coaching/policy`) decide, de forma determinística e versionada, se a proposta é executada, perguntada ao aluno ou vira **caso de exceção**.
3. A **decisão** e a **execução** são gravadas na mesma transação (`DecisionExecutor.decideAndRun`), com a versão da política, os motivos e as evidências.
4. Eventos de domínio saem pelo **outbox** (`domain_events` + relé) e acionam consumidores idempotentes.

A **sentinela de segurança** (`coaching/safety`) lê texto e sinais antes e depois do modelo e abre casos de exceção. Segurança tem 0% de tolerância nos casos de avaliação.

### Módulos da API (`apps/api/src/modules`)

`anamnesis` (8 etapas, PAR-Q determinístico, fluxo complementar) · `student-state` (Estado do Aluno: objetivos, restrições, preferências, observações) · `planning` (estratégia, treino por modalidade, nutrição, planejador híbrido) · `training` (sessões, execução, links) · `nutrition` · `vision` (prints e fotos com confirmação) · `checkin-v2` · `progress` (metas, microtarefas, revisão semanal) · `conversation` (orquestrador do WhatsApp) · `coaching` (políticas, decisões, sentinela) · `exceptions` (fila por conselho) · `agents-panel` · `methodology` (estúdio) · `evaluation` (casos de referência e CLI de avaliação) · `subscription` (Asaas) · `whatsapp` (Evolution) · `admin` · `auth` · `account` · `catalog` · `jobs` · `short-link` · `domain-events` · `execution-tasks`.

Núcleo (`src/core`): `config`, `database` (RLS, cifra de saúde, TLS, migrate), `redis`, `logger`, `ai` (`ModelGateway` por **nível de capacidade** FAST/STANDARD/REASONING/VISION, com failover e custo em `model_runs`), `agents`, `attendance-rules` (FAQ, temas proibidos, guardrail L1), `knowledge`, `audio`, `event-bus`, `validation`, `swagger`, `telemetry`.

### RBAC por conselho

O papel no banco continua `PROFESSIONAL`; `staff.council` ∈ CREF/CRN/CRM define o **domínio** do caso (treino, nutrição, médico, geral). O profissional vê e decide só o domínio do seu conselho; `ADMIN` lê tudo e decide apenas o domínio geral.

### Dados e segurança

- Postgres 17 com **RLS FORCE** em toda tabela de titular (`core/database/security-policies.ts` é a fonte; `RLS_TENANT_TABLES`). Aplicação conecta pelo PgBouncer (5433); só a migração usa a 5432 como `movivo_migrator`. `movivo_app` não é dona de tabela e não tem `BYPASSRLS`.
- Dado de saúde cifrado (`HealthCipherService`); consentimentos versionados em `packages/shared/src/schemas/consent.schema.ts` (texto novo ⇒ versão nova).
- Tabelas `legacy_*_archive` guardam, somente leitura, o que o serviço anterior produziu (retenção de 5 anos); não são lidas por nenhum fluxo.
- **Migrações:** `apps/api/drizzle/` (Drizzle Kit). Squash em base única só **depois** de produção aplicar a cadeia até a última migração (procedimento em `movivo-docs/v2/entregas/M11.md`).

### Painel interno (`apps/web/src/app/dashboard`)

Fila de exceções por conselho, ficha do aluno (Estado do Aluno), conversas (espelho do WhatsApp com "assumir conversa"), agentes (tarefas, níveis, custo, avaliações), estúdio de metodologia, base de conhecimento, finanças, marketing, sócios, compliance, auditoria e sistema.

---

## Comandos

```bash
pnpm install && pnpm run build                 # shared é consumido pelo dist: rode antes de --filter
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run format:check
pnpm run knip                                  # arquivo, export ou dependência sem uso falha o CI
pnpm run infra:up                              # sobe dados + API + web em Docker e migra o banco
pnpm --filter @movivo/api exec vitest run      # testes unitários da API
HOST_POSTGRES_PORT=5432 DEV_PROFESSIONAL_PASSWORD_FILE= \
  pnpm --filter @movivo/api exec vitest run --config vitest.integration.config.ts   # integração (pare movivo-api antes)
pnpm --filter @movivo/api db:generate          # gera migração a partir do schema (prompt interativo para renomes)
pnpm --filter @movivo/api db:migrate           # aplica migrações + reconcilia grants e RLS
pnpm --filter @movivo/api run eval --task <id> # avaliação de uma tarefa de agente com o modelo real
pnpm --filter @movivo/web exec playwright test # e2e do painel (pare o container movivo-web: porta 3000)
```

README.md tem o passo a passo de ambiente, segredos (`*_FILE`) e Docker.

## Regras de código

- TypeScript `strict`; `any` é erro de lint; Prettier formata; `console.log` proibido (use o logger, nunca PII).
- Config só pelo `AppConfigService`; chave de Redis só pelo `RedisKeyBuilder`; `SET LOCAL`, nunca `SET`.
- Módulo de domínio não importa módulo de domínio: evento ou fila. Zero `forwardRef()`.
- Todo DTO de entrada é validado por schema Zod de `@movivo/shared`.
- Sem resíduo: ao substituir algo, apague código, testes, schemas, enums, prompts, filas, rotas, permissões, variáveis e documentação na mesma mudança. `knip` precisa sair limpo.
- Texto legal e de consentimento é artefato versionado e sujeito a revisão jurídica antes de ir ao ar.
- `apps/web/AGENTS.md` avisa que o Next.js usado aqui tem mudanças incompatíveis: consulte `node_modules/next/dist/docs/` antes de escrever código novo.

## Versionamento e Git

**Repositório remoto:** https://github.com/Os-Guri-do-Vibe/movivo

Regras obrigatórias para qualquer commit feito neste repositório, por qualquer sessão (humana ou de IA):

1. **Nunca adicionar coautor de IA.** Commits e pushes nunca devem incluir `Co-Authored-By: Claude`, `Codex`, `Copilot` ou qualquer assinatura de ferramenta de IA. Usar exclusivamente o usuário local já configurado no Git (`git config user.name` / `user.email`).
2. **Seguir Conventional Commits** no formato `tipo(escopo): descrição`, com o **tipo em inglês** (padrão da indústria) e a **descrição em português (PT-BR)**. Tipos aceitos: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`, `perf`, `build`, `ci`. Escopo opcional, referenciando o módulo (ex: `anamnesis`, `ai-coach`, `whatsapp`, `billing`).
3. **Mensagens de commit sempre em PT-BR.**
4. **Commits de responsabilidade única.** Cada commit deve representar uma única execução/mudança completa e coerente — nunca misturar features/fixes não relacionados no mesmo commit. A mensagem deve ser uma frase única, clara e objetiva, sem listas ou parágrafos extensos.

Exemplo de commit correto:
```
feat(anamnesis): adiciona salvamento de progresso por bloco no formulário
```

Exemplo de commit incorreto (múltiplas responsabilidades, sem padrão, em inglês, com coautor de IA):
```
Updates and fixes

- added anamnesis form
- fixed auth bug
- updated deps

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

---

## Pipeline de agentes de criação (reutilizável)

`.claude/agents/` contém o pipeline de 21 agentes especializados que validou e planejou a MOVIVO (Clóvis, Gabriel, Caio, Kimura, Helena, Alexandre, Eduardo, Lucas, Sofia, Rafael, Sato, Victor, Leonardo, Felipe, Mariana, Henrique e os de conteúdo e receita). As fases 1 a 4 foram concluídas e geraram os relatórios que embasam a v2. Para novas linhas de produto, a ordem é fixa (estratégia e marca → jurídico e financeiro → produto e design → arquitetura, segurança e IA → desenvolvimento → infraestrutura → conteúdo → receita), cada agente recebe o input do usuário mais os relatórios anteriores, e Clóvis é o gate: sem `VALIDADO`, nada avança. Relatórios são salvos fora do repositório, por ideia, e terminam com a seção "Fontes Consultadas".
