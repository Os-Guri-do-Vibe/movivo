# MOVIVO — Produto, Empresa e Pipeline de Criação

Este repositório tem dois papéis:

1. **É o repositório da MOVIVO**, a startup que está sendo construída (contexto abaixo).
2. **Contém a "agência de criação de startups"**, o pipeline de agentes especializados que validou e planejou a MOVIVO do zero, documentado a partir da seção "Pipeline de Agentes" mais abaixo. Esse pipeline continua existindo e pode ser reutilizado (ex: para novas linhas de produto, ou para revisões pontuais de qualquer fase).

---

## 🎯 Contexto Ativo — O que é a MOVIVO

**Status:** Ideia validada por Clóvis (`VALIDADO COM RESSALVAS`). Pipeline completo até a Fase 4 — Fase 1 (Clóvis, Gabriel, Caio, Kimura, Helena), Fase 2 (Alexandre, Eduardo), Fase 3 (Lucas, Sofia) e Fase 4 (Rafael, Sato, Victor) concluídas. **Fase atual: início da implementação do MVP (Fase 5 — Desenvolvimento).**

### O produto

A MOVIVO é um **AI Coach de treino individualizado, entregue via WhatsApp**, que combina IA conversacional com metodologia e supervisão de um profissional de Educação Física registrado no CREF. O objetivo é democratizar o acesso a treino de qualidade — hoje restrito a quem paga por personal trainer — usando o canal que as pessoas já usam todos os dias.

- **Categoria criada:** "orientação de treino conversacional" — não é "um app de fitness".
- **Essência de marca:** *"Ciência que treina com você."*
- **Nome:** **MOVIVO** (mo-VÍ-vo — "movimento vivo"). Há risco jurídico de colisão fonética com a marca de alto renome VIVO (Telefônica), ainda não verificado formalmente no INPI — ver `03-relatorio-caio.md`. Nome alternativo de reserva já definido caso necessário: **TRENOVA**.
- **Selo CREF:** assinatura de credibilidade, não é uma submarca.

### Como funciona (visão de produto)

Usuário preenche formulário de anamnese + PAR-Q → protocolo de treino é gerado (Motor Determinístico + LLM, nunca LLM puro) → entregue via WhatsApp em até 2h → usuário conversa com o AI Coach para dúvidas, motivação e substituição de exercícios → check-in semanal automático ajusta o protocolo → profissional CREF assina/supervisiona e entra em qualquer exceção fora do escopo seguro da IA.

### Fundadores e papéis

| Pessoa | Papel |
|---|---|
| Rodrigo | Desenvolvedor (fundador) |
| Pedro | Desenvolvedor (fundador) |
| Joaquim | Desenvolvedor (fundador) |
| Cahuã | Marca, marketing e vendas — rosto público / endossante (arquitetura de marca "Branded House": Cahuã endossa a MOVIVO, **nunca é a marca**) |
| Treinador do Cahuã | Responsável Técnico CREF — validação jurídico-profissional dos protocolos, também rosto da marca |

> **Societário (recomendação de Alexandre em `06-relatorio-alexandre.md`):** constituir LTDA com objeto social compatível com atividade CREF (Educação Física como atividade-fim, não só "software house"), Acordo de Sócios com vesting (cliff 12 meses / vesting total 48 meses) e IP de todo o desenvolvimento consolidado na PJ desde o dia 1. Divisão de quotas ainda **não definida** — Alexandre recomenda evitar split igualitário 20%/20%/20%/20%/20% sem mecanismo de desempate societário.

### Modelo de negócio

- **B2C por assinatura, plano único por período (validado por Eduardo em `07-relatorio-eduardo.md`):** Mensal R$39 / Trimestral R$99 / Anual R$349. Rejeitado o tiering "Básico/Pro" cogitado inicialmente por Rafael — retenção via compromisso de período, não via gate de features.
- Trial de **7 dias sem cartão** (ajustado de 14 para 7 dias por Eduardo/Sofia).
- Regime tributário recomendado: **Simples Nacional, Anexo III (6%) via Fator R ≥ 28%** — evita o Anexo V, mais caro.
- Bootstrapável: necessidade de capital estimada em R$20–30 mil (setup jurídico + 6 meses de runway), sem necessidade de aporte externo para o MVP.
- Meta LTV/CAC ≥ 3; payback de CAC pago recomendado em **≤3 meses** (Eduardo relaxou a meta original de ≤2 meses de Helena, apertada demais para tráfego pago via Meta).
- ICP: 18–30 anos, digital-native, sensível a preço, treina em casa/academia, vive no WhatsApp.
- **North Star Metric:** Treinos Concluídos por Usuário Pago nos Primeiros 30 Dias (meta ≥ 8/30 dias).

### Guardrails de linguagem — inegociáveis em todo código, copy, prompt de IA e UI

Herdados de Clóvis e Gabriel, valem para **qualquer texto gerado pelo sistema ou pela equipe** (prompts de IA, mensagens de WhatsApp, UI, marketing):

- **Nunca** usar "diagnóstico", "tratamento" ou "cura".
- **Nunca** prometer "resultado garantido".
- A IA **nunca** é apresentada como quem decide ou prescreve sozinha — a formulação correta é sempre "profissional CREF, usando IA como ferramenta".
- A presença/respaldo do profissional CREF deve ser sempre visível ao usuário.

### Escopo do MVP (definido por Lucas em `08-relatorio-lucas.md`)

**Dentro do MVP (P0):** Landing page → formulário de anamnese + PAR-Q conversacional em 3 blocos com salvamento de progresso → confirmação síncrona no WhatsApp → geração e entrega do protocolo inicial → conversa com AI Coach (escopo definido, memória, fallback) → check-in semanal → sequência de conversão do trial (dias 7, 10, 13, 14) → pagamento (Stripe/Asaas) → dashboard mínimo de operações para o profissional CREF → isolamento de contexto por usuário.

**Fora do MVP (Fase 2):** app mobile, dashboard dedicado ao usuário final, planos anuais, wearables, gamificação, referral automatizado, nutrition coaching, PIX recorrente automático, multi-idioma, API para parceiros B2B.

### Arquitetura e stack técnica

A arquitetura de referência completa foi definida por Rafael (Distinguished Software Architect) em `docs/fitness-ia-whatsapp/10-relatorio-rafael.md`. As regras obrigatórias de desenvolvimento, stack e diagramas estão condensadas e operacionalizadas em **[docs/arquitetura/ARQUITETURA.md](docs/arquitetura/ARQUITETURA.md)** — todo agente de engenharia (Sato, Victor, Leonardo, Felipe, Mariana, Henrique) e toda sessão de código neste repositório deve seguir esse documento.

### Correção crítica pós Fase 2–4: troca do LLM principal

O relatório original de Rafael definia **DeepSeek V3.2** como LLM principal (ADR-005). Essa decisão foi **formalmente revertida (ADR-005-R)** após três achados independentes:

- **Alexandre:** DeepSeek opera com servidores na China, sem salvaguarda contratual válida para dados de saúde sob LGPD.
- **Sato:** DeepSeek teve um vazamento de dados público e documentado (pesquisa Wiz, jan/2025).
- **Eduardo:** a troca custa apenas ~R$0,95–0,97/usuário/mês a mais — irrelevante para o unit economics.

**Decisão vigente:** **GPT-4.1 (OpenAI) como LLM principal, Codex Sonnet 4.5 (Anthropic) como fallback**, ambos com Zero Data Retention + DPA/SCC. DeepSeek foi removido do projeto por completo. Detalhes técnicos em `docs/arquitetura/ARQUITETURA.md` §3.1 e `docs/fitness-ia-whatsapp/12-relatorio-victor.md`.

### Pipeline de validação — completo

Todos os relatórios de Fase 1 a 4 existem em `docs/fitness-ia-whatsapp/`: `01-relatorio-clovis.md`, `02-relatorio-gabriel.md`, `03-relatorio-caio.md`, `04-relatorio-kimura.md`, `05-relatorio-helena.md`, `06-relatorio-alexandre.md`, `07-relatorio-eduardo.md`, `08-relatorio-lucas.md`, `09-relatorio-sofia.md`, `10-relatorio-rafael.md`, `11-relatorio-sato.md`, `12-relatorio-victor.md`. Não há mais bloqueador de pipeline para o início da Fase 5 (Desenvolvimento).

---

## Versionamento e Git

**Repositório remoto:** https://github.com/Os-Guri-do-Vibe/movivo

Regras obrigatórias para qualquer commit feito neste repositório, por qualquer sessão (humana ou de IA):

1. **Nunca adicionar coautor de IA.** Commits e pushes nunca devem incluir `Co-Authored-By: Codex`, `Codex`, `Copilot` ou qualquer assinatura de ferramenta de IA. Usar exclusivamente o usuário local já configurado no Git (`git config user.name` / `user.email`).
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

Co-Authored-By: Codex <noreply@anthropic.com>
```

---

# Agência de Criação de Startups — Pipeline de Agentes

Este projeto orquestra um pipeline sequencial e estruturado de agentes especializados para levar uma ideia de negócio da validação estratégica até o lançamento e operação. Cada agente é especialista em uma fase e **depende do trabalho dos agentes anteriores**.

---

## Visão geral do pipeline completo

```
FASE 1 — ESTRATÉGIA DE NEGÓCIO E MARCA
  01 · Clóvis   →  02 · Gabriel  →  03 · Caio  →  04 · Kimura  →  05 · Helena
  [GATE: Clóvis valida antes de qualquer avanço]

FASE 2 — FUNDAÇÃO LEGAL E FINANCEIRA        ← começa após Helena
  06 · Alexandre  ║  07 · Eduardo            (paralelo entre si)

FASE 3 — PRODUTO E DESIGN                   ← começa após Fase 2 completa
  08 · Lucas  →  09 · Sofia

FASE 4 — ARQUITETURA, SEGURANÇA E IA        ← começa após Fase 3 completa
  10 · Rafael  →  11 · Sato  ║  12 · Victor  (Sato e Victor em paralelo após Rafael)

FASE 5 — DESENVOLVIMENTO                    ← começa após Fase 4 completa
  13 · Leonardo  ║  14 · Felipe  →  15 · Mariana

FASE 6 — INFRAESTRUTURA                     ← começa após Fase 5 completa
  16 · Henrique

FASE 7 — CONTEÚDO E COMUNICAÇÃO             ← começa após Fase 6 completa
  17 · Redator  ║  18 · Social Media         (paralelo entre si) [a criar]

FASE 8 — RECEITA E CRESCIMENTO              ← começa após Fase 7 completa
  19 · Comercial  ║  20 · CS  →  21 · Growth                    [a criar]
```

---

## Ordem obrigatória do pipeline

O pipeline é dividido em **8 fases**. A ordem entre fases é fixa e não pode ser alterada ou pulada. Dentro de algumas fases, agentes podem atuar em paralelo (indicado abaixo).

### Fase 1 — Estratégia de Negócio e Marca

> **Gate obrigatório:** Clóvis valida a ideia antes de qualquer avanço. Se não validar, o pipeline encerra aqui.

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 1 | **Clóvis** | `01-clovis-estrategista-de-negocio` | `01-relatorio-clovis.md` | Validação de negócio, TAM/SAM/SOM, ICP, JTBD, MVP |
| 2 | **Gabriel** | `02-gabriel-estrategista-de-marca` | `02-relatorio-gabriel.md` | Propósito, missão, visão, posicionamento de marca |
| 3 | **Caio** | `03-caio-especialista-de-naming` | `03-relatorio-caio.md` | Naming, domínio, registro de marca, risco fonético |
| 4 | **Kimura** | `04-kimura-designer-de-marca` | `04-relatorio-kimura.md` | Logotipo, paleta, tipografia, design system, brand book |
| 5 | **Helena** | `05-helena-estrategista-de-marketing` | `05-relatorio-helena.md` | GTM, canais, funil, campanhas, KPIs de marketing |

---

### Fase 2 — Fundação Legal e Financeira
**Inicia após:** Helena (agente 5) concluir.
> Alexandre e Eduardo recebem o mesmo contexto e podem atuar **em paralelo**. Ambos devem concluir antes da Fase 3.

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 6 | **Alexandre** | `06-alexandre-head-juridico` | `06-relatorio-alexandre.md` | CLO — LGPD, contratos, compliance, societário, CREF, AI Act |
| 7 | **Eduardo** | `07-eduardo-head-financeiro` | `07-relatorio-eduardo.md` | CFO — finanças, tributação, unit economics, FinOps, captação |

---

### Fase 3 — Produto e Design
**Inicia após:** Alexandre e Eduardo (agentes 6 e 7) concluírem.
> Lucas define o escopo do produto antes de Sofia. Sofia deve concluir antes da Fase 4.

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 8 | **Lucas** | `08-lucas-gerente-de-produto` | `08-relatorio-lucas.md` | PM/PO — discovery, PRD, roadmap, backlog, métricas, AI spec |
| 9 | **Sofia** | `09-sofia-designer-ux-ui` | `09-relatorio-sofia.md` | UX/UI — wireframes, protótipos, design system, AI UX |

---

### Fase 4 — Arquitetura, Segurança e IA
**Inicia após:** Sofia (agente 9) concluir.
> Rafael define a arquitetura primeiro. Sato e Victor podem atuar **em paralelo** após Rafael. Todos devem concluir antes da Fase 5.

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 10 | **Rafael** | `10-rafael-arquiteto-de-software` | `10-relatorio-rafael.md` | Arquitetura — Clean Arch, DDD, APIs, cloud, ADRs, IA systems |
| 11 | **Sato** | `11-sato-engenheiro-de-seguranca` | `11-relatorio-sato.md` | Segurança — AppSec, Zero Trust, DevSecOps, AI Security, LGPD |
| 12 | **Victor** | `12-victor-engenheiro-de-ia` | `12-relatorio-victor.md` | IA — LLMs, RAG, agentes, MCP, prompt eng, LLMOps, avaliação |

---

### Fase 5 — Desenvolvimento
**Inicia após:** Rafael, Sato e Victor (agentes 10, 11 e 12) concluírem.
> Leonardo e Felipe podem atuar **em paralelo** entre si. Mariana atua somente após ambos concluírem.

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 13 | **Leonardo** | `13-leonardo-engenheiro-backend` | `13-relatorio-leonardo.md` | Backend — NestJS, TypeScript, PostgreSQL, Redis, BullMQ, APIs |
| 14 | **Felipe** | `14-felipe-engenheiro-frontend` | `14-relatorio-felipe.md` | Frontend — Next.js 15, React 19, Tailwind, shadcn/ui, AI UI |
| 15 | **Mariana** | `15-mariana-analista-de-qualidade` | `15-relatorio-mariana.md` | QA — automação, performance, AI evaluation, quality gates |

---

### Fase 6 — Infraestrutura
**Inicia após:** Mariana (agente 15) concluir.

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 16 | **Henrique** | `16-henrique-engenheiro-de-plataforma` | `16-relatorio-henrique.md` | DevOps/SRE — Docker, CI/CD, Kubernetes, cloud, observabilidade |

---

### Fase 7 — Conteúdo e Comunicação
**Inicia após:** Henrique (agente 16) concluir.
> *(Agentes ainda não criados — podem atuar em paralelo entre si)*

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 17 | **Redator** | `17-[nome]-redator-copywriter` *(a criar)* | `17-relatorio-[nome].md` | Copywriting, UX writing, conteúdo editorial |
| 18 | **Social Media** | `18-[nome]-gestor-social-media` *(a criar)* | `18-relatorio-[nome].md` | Gestão de redes, comunidade, engajamento |

---

### Fase 8 — Receita e Crescimento
**Inicia após:** Fase 7 completa.
> *(Agentes ainda não criados — Comercial e CS em paralelo; Growth após ambos)*

| # | Agente | Arquivo | Relatório | Especialidade |
|---|---|---|---|---|
| 19 | **Comercial** | `19-[nome]-executivo-comercial` *(a criar)* | `19-relatorio-[nome].md` | Vendas, B2B, parcerias, propostas comerciais |
| 20 | **CS** | `20-[nome]-customer-success` *(a criar)* | `20-relatorio-[nome].md` | Onboarding, retenção, suporte, NPS |
| 21 | **Growth** | `21-[nome]-analista-de-growth` *(a criar)* | `21-relatorio-[nome].md` | Analytics, growth loops, KPIs, experimentação |

---

## Gate de validação (regra crítica)

**Clóvis é o gatekeeper de todo o pipeline.**

- Se Clóvis **validar** a ideia → o pipeline segue normalmente para Gabriel, e assim por diante na ordem definida.
- Se Clóvis **NÃO validar** a ideia → o pipeline **para imediatamente**. Nenhum outro agente deve ser acionado. A ideia não terá continuidade até que o usuário forneça uma ideia revisada ou uma nova ideia, reiniciando o processo a partir de Clóvis.

O relatório de Clóvis deve declarar explicitamente o veredito (`VALIDADO` ou `NÃO VALIDADO`) logo no início do documento.

---

## Fluxo de input entre agentes

Cada agente recebe como contexto de trabalho a **combinação cumulativa** de:

1. O input original do usuário (a ideia de negócio/startup).
2. Os relatórios de **todos** os agentes anteriores no pipeline (nessa ordem).

Exemplo completo para uma ideia com slug `<slug-da-ideia>`:

**Fase 1:**
- **Clóvis** recebe: input do usuário → define `<slug-da-ideia>` → gera `docs/<slug-da-ideia>/01-relatorio-clovis.md`.
- **Gabriel** recebe: input + `01-relatorio-clovis.md` → gera `02-relatorio-gabriel.md`.
- **Caio** recebe: input + relatórios de Clóvis e Gabriel → gera `03-relatorio-caio.md`.
- **Kimura** recebe: input + relatórios de Clóvis, Gabriel e Caio → gera `04-relatorio-kimura.md`.
- **Helena** recebe: input + relatórios de Clóvis, Gabriel, Caio e Kimura → gera `05-relatorio-helena.md`.

**Fase 2:**
- **Alexandre** recebe: input + todos os relatórios da Fase 1 → gera `06-relatorio-alexandre.md`.
- **Eduardo** recebe: input + todos os relatórios da Fase 1 → gera `07-relatorio-eduardo.md`.
*(Alexandre e Eduardo recebem o mesmo contexto e podem ser acionados em paralelo)*

**Fase 3:**
- **Lucas** recebe: input + relatórios das Fases 1 e 2 → gera `08-relatorio-lucas.md`.
- **Sofia** recebe: input + relatórios das Fases 1, 2 e relatório de Lucas → gera `09-relatorio-sofia.md`.

**Fase 4:**
- **Rafael** recebe: input + relatórios das Fases 1, 2 e 3 → gera `10-relatorio-rafael.md`.
- **Sato** recebe: input + relatórios das Fases 1, 2, 3 e relatório de Rafael → gera `11-relatorio-sato.md`.
- **Victor** recebe: input + relatórios das Fases 1, 2, 3 e relatório de Rafael → gera `12-relatorio-victor.md`.
*(Sato e Victor recebem o mesmo contexto após Rafael e podem ser acionados em paralelo)*

**Fase 5:**
- **Leonardo** recebe: input + relatórios das Fases 1–4 → gera `13-relatorio-leonardo.md`.
- **Felipe** recebe: input + relatórios das Fases 1–4 → gera `14-relatorio-felipe.md`.
*(Leonardo e Felipe podem ser acionados em paralelo)*
- **Mariana** recebe: input + relatórios das Fases 1–4 e relatórios de Leonardo e Felipe → gera `15-relatorio-mariana.md`.

**Fase 6:**
- **Henrique** recebe: input + relatórios de todas as fases anteriores → gera `16-relatorio-henrique.md`.

**Fases 7 e 8** seguem o mesmo padrão cumulativo à medida que os agentes forem criados.

Nenhum agente deve ignorar os relatórios anteriores nem contradizê-los sem justificativa explícita no seu próprio relatório.

---

## Relatórios em `docs/` (uma pasta por ideia)

Este projeto pode ser usado para validar **múltiplas ideias de negócio distintas ao longo do tempo**. Para nunca misturar ou sobrescrever o histórico de uma ideia com o de outra, todo relatório é salvo dentro de uma **subpasta exclusiva daquela ideia**, nunca direto em `docs/`.

### Convenção de nomes

```
docs/<slug-da-ideia>/<NN>-relatorio-<identificador-do-agente>.md
```

Onde `<NN>` é o número de dois dígitos do agente no pipeline (mesmo número usado no arquivo do agente em `.Codex/agents/`, ex: `06-alexandre-head-juridico`), o que faz os relatórios ordenarem no filesystem na mesma ordem em que foram executados. `<identificador-do-agente>` é o primeiro nome em minúsculas, sem acentos:

| Agente | Identificador |
|---|---|
| Clóvis | `clovis` |
| Gabriel (Brand) | `gabriel` |
| Caio | `caio` |
| Kimura | `kimura` |
| Helena | `helena` |
| Alexandre | `alexandre` |
| Eduardo | `eduardo` |
| Lucas | `lucas` |
| Sofia | `sofia` |
| Rafael | `rafael` |
| Sato | `sato` |
| Victor | `victor` |
| Leonardo | `leonardo` |
| Felipe | `felipe` |
| Mariana | `mariana` |
| Henrique | `henrique` |

Exemplo de estrutura completa para a ideia `fitness-ia-whatsapp`:

```
docs/fitness-ia-whatsapp/01-relatorio-clovis.md
docs/fitness-ia-whatsapp/02-relatorio-gabriel.md
docs/fitness-ia-whatsapp/03-relatorio-caio.md
docs/fitness-ia-whatsapp/04-relatorio-kimura.md
docs/fitness-ia-whatsapp/05-relatorio-helena.md
docs/fitness-ia-whatsapp/06-relatorio-alexandre.md
docs/fitness-ia-whatsapp/07-relatorio-eduardo.md
docs/fitness-ia-whatsapp/08-relatorio-lucas.md
docs/fitness-ia-whatsapp/09-relatorio-sofia.md
docs/fitness-ia-whatsapp/10-relatorio-rafael.md
docs/fitness-ia-whatsapp/11-relatorio-sato.md
docs/fitness-ia-whatsapp/12-relatorio-victor.md
docs/fitness-ia-whatsapp/13-relatorio-leonardo.md
docs/fitness-ia-whatsapp/14-relatorio-felipe.md
docs/fitness-ia-whatsapp/15-relatorio-mariana.md
docs/fitness-ia-whatsapp/16-relatorio-henrique.md
```

### Como determinar o slug da ideia

- **Clóvis** é quem **define o slug** ao receber uma nova ideia, a partir do nome/conceito central do negócio. O slug deve ser declarado de forma explícita no início do relatório de Clóvis (ex: `**Pasta do projeto:** docs/fitness-ia-whatsapp/`), para que todos os agentes seguintes o reutilizem sem ambiguidade.
- Os demais agentes **reutilizam o mesmo slug/pasta** — nunca criam uma pasta nova para a mesma ideia.
- Se o usuário voltar a falar sobre uma ideia já existente, reconhecer a pasta `docs/<slug-da-ideia>/` e continuar ali, sem criar pasta duplicada.
- Se houver dúvida real sobre se é uma ideia nova ou revisão de uma existente, perguntar ao usuário antes de criar a pasta.

### Revisão de uma ideia já existente

Se o pipeline for executado mais de uma vez para a **mesma ideia**, sobrescrever o relatório existente dentro da pasta é aceitável — ele deve sempre representar o estado mais atual daquele agente para aquela ideia.

### Propósito duplo do relatório

Cada relatório serve a **dois leitores**:

1. **O próximo agente do pipeline** — precisa entender rapidamente as decisões e justificativas para construir em cima delas.
2. **O usuário** — vai ler os relatórios para acompanhar e entender cada etapa.

Por isso, o relatório deve ser:

- **Completo**: cobrir todo o raciocínio e as entregas do agente.
- **Estruturado**: usar headings claros.
- **Autocontido**: alguém lendo só aquele relatório (mais o input original) deve entender o que foi decidido e por quê.
- **Explícito sobre dependências**: citar quando uma decisão se baseia em algo dito por um agente anterior.

### Estrutura mínima sugerida de cada relatório

```markdown
# Relatório — <Nome do Agente> (<Role>)

**Data:** <data>
**Ideia analisada:** <resumo curto da ideia do usuário>
**Pasta do projeto:** docs/<slug-da-ideia>/
**Status do pipeline:** <ex: Validado por Clóvis / Fase X em andamento>

## Resumo executivo
(2-4 frases com a conclusão principal deste agente)

## Contexto recebido
(o que veio do input do usuário e dos relatórios anteriores, resumido)

## Análise e desenvolvimento
(o corpo do trabalho deste agente — específico da sua especialidade)

## Decisões e entregáveis
(o que foi decidido/criado)

## Recomendações para o próximo agente
(o que o próximo agente do pipeline deve levar em conta)

## Fontes Consultadas
(URLs utilizadas na pesquisa web)
```

Agentes podem adaptar a estrutura à sua especialidade, mas devem manter o veredito/status visível no topo (especialmente Clóvis) e a seção de fontes consultadas ao final.

---

## Responsabilidades por agente (resumo)

| F | # | Agente | Arquivo do agente | Foco principal | Não faz |
|---|---|---|---|---|---|
| 1 | 01 | Clóvis | `01-clovis-estrategista-de-negocio` | Validação de negócio, TAM/SAM/SOM, ICP, JTBD, MVP | Branding, naming, design, marketing, tecnologia |
| 1 | 02 | Gabriel | `02-gabriel-estrategista-de-marca` | Propósito, missão, visão, posicionamento, arquitetura de marca | Logotipo, identidade visual, naming, tecnologia |
| 1 | 03 | Caio | `03-caio-especialista-de-naming` | Naming, domínio, registro de marca, risco jurídico/fonético | Identidade visual, estratégia de marca, tecnologia |
| 1 | 04 | Kimura | `04-kimura-designer-de-marca` | Logotipo, paleta, tipografia, ícones, design system, brand book | Posicionamento, naming, tecnologia |
| 1 | 05 | Helena | `05-helena-estrategista-de-marketing` | GTM, canais, funil, campanhas, KPIs de marketing | Identidade visual, naming, tecnologia |
| 2 | 06 | Alexandre | `06-alexandre-head-juridico` | LGPD, contratos, compliance, societário, PI, CREF, AI Act | Branding, tecnologia, finanças operacionais |
| 2 | 07 | Eduardo | `07-eduardo-head-financeiro` | Finanças, contabilidade, tributação, unit economics, FinOps, captação | Jurídico, tecnologia, marketing |
| 3 | 08 | Lucas | `08-lucas-gerente-de-produto` | PRD, roadmap, backlog, discovery, métricas, AI product spec | Código, identidade visual, finanças |
| 3 | 09 | Sofia | `09-sofia-designer-ux-ui` | UX research, wireframes, protótipos, design system de produto, AI UX | Código, brand identity de marketing |
| 4 | 10 | Rafael | `10-rafael-arquiteto-de-software` | Arquitetura, ADRs, stack, APIs, DDD, cloud, IA systems arch | Código de aplicação, UX, marketing |
| 4 | 11 | Sato | `11-sato-engenheiro-de-seguranca` | Threat modeling, AppSec, Cloud Security, DevSecOps, AI Security | Código de aplicação, infraestrutura operacional |
| 4 | 12 | Victor | `12-victor-engenheiro-de-ia` | LLMs, RAG, agentes, MCP, prompt eng, context eng, LLMOps, AI eval | Backend/frontend, infraestrutura, UX |
| 5 | 13 | Leonardo | `13-leonardo-engenheiro-backend` | Backend (NestJS, TypeScript, PostgreSQL, Redis, BullMQ), APIs | Frontend, arquitetura, IA pura, DevOps |
| 5 | 14 | Felipe | `14-felipe-engenheiro-frontend` | Frontend (Next.js 15, React 19, Tailwind, shadcn/ui), AI UI | Backend, arquitetura, IA pura, DevOps |
| 5 | 15 | Mariana | `15-mariana-analista-de-qualidade` | QA, automação, performance testing, AI evaluation, quality gates | Código de aplicação, arquitetura, DevOps |
| 6 | 16 | Henrique | `16-henrique-engenheiro-de-plataforma` | Docker, CI/CD, Kubernetes, cloud, observabilidade, SRE, FinOps | Código de aplicação, UX, estratégia de negócio |
| 7 | 17 | Redator | `17-[nome]-redator-copywriter` *(a criar)* | Copywriting, UX writing, conteúdo editorial | *(a definir)* |
| 7 | 18 | Social Media | `18-[nome]-gestor-social-media` *(a criar)* | Gestão de redes, comunidade, engajamento | *(a definir)* |
| 8 | 19 | Comercial | `19-[nome]-executivo-comercial` *(a criar)* | Vendas, B2B, parcerias, propostas | *(a definir)* |
| 8 | 20 | CS | `20-[nome]-customer-success` *(a criar)* | Onboarding, retenção, suporte, NPS | *(a definir)* |
| 8 | 21 | Growth | `21-[nome]-analista-de-growth` *(a criar)* | Analytics, growth loops, KPIs, experimentação | *(a definir)* |

---

## Pesquisa web obrigatória em todo o pipeline

Todos os 16 agentes ativos têm permissão total de ferramentas, incluindo `WebSearch` e `WebFetch`.

Cada agente foi instruído a **usar ativamente** essas ferramentas antes de finalizar seu relatório. Em especial:

- **Clóvis**: dados reais de mercado, concorrentes e evidências de demanda.
- **Caio**: disponibilidade real de domínio, colisão de marcas e handles de redes sociais.
- **Alexandre**: legislação atualizada, jurisprudência, resoluções ANPD/CREF/INPI.
- **Eduardo**: benchmarks financeiros de SaaS, tributação atualizada, programas de fomento vigentes.
- **Victor**: benchmarks de modelos (LMSYS, pricing de APIs), papers recentes de RAG e agentes.
- **Sato**: CVEs recentes, advisories de segurança, incidentes públicos do setor.
- **Rafael, Leonardo, Felipe, Henrique**: documentação oficial, changelogs e benchmarks das tecnologias recomendadas.
- **Mariana**: metodologias atuais de avaliação de LLMs e frameworks de quality engineering.

Todo relatório em `docs/` deve incluir uma seção **"Fontes Consultadas"** listando as URLs usadas. Quando a busca não retornar dados suficientes, o agente deve declarar essa limitação explicitamente.

---

## Regras gerais de execução

- Nunca pular a ordem das fases do pipeline.
- Nunca acionar um agente sem que os relatórios dos agentes anteriores **obrigatórios** existam em `docs/<slug-da-ideia>/`.
- Agentes que podem atuar em paralelo dentro de uma fase são indicados explicitamente na tabela acima.
- Se Clóvis não validar a ideia, informar claramente ao usuário e não prosseguir — aguardar nova ideia ou revisão.
- Sempre salvar o relatório em `docs/<slug-da-ideia>/` antes de considerar a etapa daquele agente concluída.
- Ao receber uma nova ideia, sempre verificar primeiro se já existe uma pasta equivalente em `docs/` para não duplicar histórico.
- O slug da ideia é sempre definido por Clóvis e reutilizado por todos os demais agentes sem alteração.
