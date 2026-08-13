# Sprint 7 — Plataforma dos Fundadores: Arquitetura de Informação, Métricas de Decisão e Fundação do Painel de IA (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-08-13
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 7)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + QA (Mariana), com revisão de segurança de Sato, especificação de IA de Victor e validação clínico-jurídica de Alexandre / RT CREF
**Documentos-fonte:** **Relatório de Information Architecture do dashboard (Lucas, esta sessão)** · **Especificação do Painel de IA (Victor, esta sessão)** · `sprint/sprint-5-checkin-e-dashboard-cref.md` (base do Dashboard CREF, auth, RLS por `app.current_role`, auditoria) · `sprint/sprint-6-onboarding-em-etapas.md` · `docs/arquitetura/ARQUITETURA.md` (§3.1 LLM, §6 filas, §8 RLS, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (North Star, funil, Épico 7) · `docs/fitness-ia-whatsapp/07-relatorio-eduardo.md` (unit economics, LTV/CAC, pricing) · `docs/fitness-ia-whatsapp/05-relatorio-helena.md` (funil, CAC por canal) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` (RBAC/RLS, anti-poisoning) · `docs/fitness-ia-whatsapp/12-relatorio-victor.md` (guardrails, ValidationService, golden set) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (LGPD, k-anonimato, dado de saúde)

---

## Como ler este documento

Hierarquia: **Épicos → User Stories (US-7.x) → Tasks (TASK-7.x.y)**.

- Cada **User Story** declara: agentes participantes e ordem, dependências (depende de / habilita), jornada (o que se constrói e por quê), objetivo, resultado esperado, tasks e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD.
- Este documento cobre **a Sprint 7 em detalhe de execução** e **as Sprints 8 a 11 em nível de escopo priorizado** (seção final). É deliberado: ver a decisão de escopo abaixo.

---

## Decisão de escopo — leitura honesta do pedido do fundador

O pedido do fundador foi explícito: *"criar uma Sprint 7 completa onde iremos implementar completamente todas essas fases"*. **Minha recomendação como PM é que isso não seja feito, e a razão é factual, não conservadorismo.**

O escopo total pedido (Financeiro completo com previsão de lucro e distribuição por sócio, Marketing com atribuição e decisão de anúncio, Sistema com garantia de disponibilidade, Alunos com evolução e refino de metodologia, e um Painel de IA que parametriza agente + metodologia + upload de documentos + FAQ) contém, pelo levantamento das duas rodadas de discovery desta sessão:

- **8 tabelas novas** (`expenses`, `payments`, `model_pricing`, `partners`, `workout_completions`, `user_status_transitions`, `ad_spend`, `agent_config`, `faq_entries`, `knowledge_documents`) e **3 alterações de schema** (UTM em `anamnesisSessions`, `documentId`/`isActive` em `knowledge_base`);
- **um sistema de curadoria de conhecimento com gate de revisão humana do RT CREF e role de banco separada** — que Victor classificou como *épico próprio, alto risco*, por ser a superfície de RAG-poisoning do produto;
- **um simulador de configuração de IA**, que Victor colocou como **pré-condição técnica** para liberar qualquer edição de camada L1 pelo painel;
- **um motor de projeção financeira com cenários**, que só faz sentido depois que `expenses` e `payments` existirem (não se projeta lucro sem ter despesa registrada).

Duas dessas peças — **RAG com curadoria** e **motor de projeção** — não são "mais telas": são subsistemas com risco de segurança e de decisão financeira errada. Espremê-las numa sprint de 2 semanas junto com o resto significaria entregá-las mal, e mal aqui quer dizer, respectivamente, *IA respondendo com base em documento não revisado por profissional CREF* e *fundador tomando decisão de distribuição de lucro sobre número inventado*. Não vou propor isso.

**O que proponho:** a plataforma dos fundadores é construída em **4 ondas (Sprints 7 a 10, com uma 11 opcional)**, todas documentadas aqui. **Nada foi cortado — tudo o que o fundador pediu está neste documento, com dono e ordem.** A diferença é que a Sprint 7 entrega o que é de fato entregável com qualidade agora:

1. **A arquitetura de informação nova** (os 5 pilares) — é ela que resolve a queixa raiz de "bagunçado", e é barata: é reorganização + RBAC, não dado novo.
2. **Todas as métricas "F1"** — as que já são extraíveis do schema atual **sem uma única migration**. São muitas, e algumas são as de maior valor do documento inteiro (calendário de renovação 90 dias, timeline única do aluno, p95 real de latência de IA).
3. **A fundação do painel de IA** — `agent_config` append-only + cache + persona editável (L2) + a seção de **guardrails invioláveis somente-leitura com cadeado e justificativa** (L0). Isso já entrega o pedido central *"sem ficar refém de alterar código-fonte"* para o que é seguro editar sem simulador.

**Fato vs. opinião, explícito:** é *fato* que as métricas F1 saem do schema atual (as colunas foram nomeadas no discovery); é *fato* que a North Star hoje mostra "indisponível" por falta de `workout_completions`; é *opinião minha como PM*, baseada no histórico de 6 sprints deste time, que o conjunto F1 + IA-fundação cabe em 10 dias úteis com 3 devs, e que o conjunto total **não cabe**.

> **Nota ao fundador — o que a Sprint 7 NÃO vai resolver, e você vai notar no dia 10:** a **North Star continuará mostrando "indisponível"** (falta `workout_completions` — Sprint 8), **"lucro" continuará não existindo** (falta `expenses` — Sprint 8) e **"CAC por canal" continuará impossível** (falta UTM — Sprint 8). Isso é intencional e não é atraso: são as três migrations que abrem a Sprint 8, e cada uma precisa de decisão sua antes (como o aluno reporta treino concluído? quem lança despesa e com que categorias? qual construtor de UTM os anúncios vão usar?). A Sprint 7 monta a casa onde esses números vão morar e liga tudo o que já dá para ligar hoje.

---

### Base já entregue pelas Sprints 0-6 (não reconstruir — consumir)

- **Dashboard autenticado + RBAC + RLS por `app.current_role` (Sprint 5, US-5.4):** o painel já existe, já tem login (Auth.js sobre AuthModule JWT RS256 + Argon2id), já tem guarda de rota por papel e endpoints sob `SET LOCAL`. A Sprint 7 **reorganiza e estende** — não reconstrói auth nem shell.
- **Sistema de capabilities do Control Center (Sprint 6, commit `0c205e5`):** o dashboard multi-setor já nasceu com capabilities e com `ALL_CAPABILITIES` herdado por `ADMIN`. A Sprint 7 adiciona capabilities novas nesse mesmo mecanismo — e cria a **primeira exceção explícita à herança total do ADMIN** (`AI_KNOWLEDGE_APPROVE`, ver US-7.1).
- **`AuditService.append` append-only com hash chain (Sprint 1):** toda publicação de configuração de IA reusa este serviço. Não se cria trilha de auditoria nova.
- **Guardrails já implementados em código:** `BASE_GUARDRAIL` (`ai-coach/intent/prompts.ts` L13-35), `SAFETY_PATTERNS`/`SCOPE_PATTERNS` (`clinical-guardrail.ts`), `LANGUAGE_RULES`/`SYSTEM_PROMPT_SENTINELS`/`INJECTION_PATTERNS` + parâmetros do motor (`protocol/validation/validation-rules.ts`), `METHODOLOGY_GUIDELINES` (`protocol/methodology.ts`). A Sprint 7 **expõe** esses artefatos na UI em leitura; não os torna editáveis.
- **Golden set determinístico em CI:** `conversation-golden-set.spec.ts` e `protocol/validation/golden-set.spec.ts` já protegem mudança feita por PR. **Não protegem mudança publicada pelo painel** — daí a regra 4 abaixo.
- **`aiJobs` com `latencyMs`, `tokensInput`, `tokensOutput`, `modelUsed` já persistidos (Sprint 2/3):** a base de custo de IA e de p95 real já está no banco, sem instrumentação nova.
- **`anamnesisSessions` com `status` + `lastStep` (Sprint 6):** o funil por bloco do onboarding em 3 etapas já é extraível.
- **`subscriptions` com `currentPeriodEnd`, `canceledAt`, `cancelReason`, `plan` (Sprint 4):** receita futura, churn e motivo de churn já estão gravados — e `cancelReason` **nunca foi lido por nenhuma tela**.
- **k-anonimato já implementado (Sprint 5/6, exigência de Alexandre):** o agregado de perfil de cliente reusa o mesmo mecanismo (supressão de célula com n < 10).
- **PII Scrubber (`pii-scrubber.ts`, US-2.2)** e **`health-cipher`/pgcrypto (US-1.1/US-5.1)**: reusados em toda leitura de dado sensível no painel.
- **`knowledge_base` com pgvector/HNSW + `corpus-indexer.ts`:** existe e funciona; a role de runtime `movivo_app` tem **INSERT/UPDATE/DELETE revogados** nessa tabela de propósito. **Nada nesta sprint escreve em `knowledge_base`** (upload é Sprint 10).

---

### Regras inegociáveis que valem nesta sprint

1. **O modelo de 3 camadas de configuração de IA (Victor) é lei estrutural, não sugestão de UI:**
   - **L0 — travado em código, nunca vira campo editável:** guardrails regulatórios (nunca "diagnóstico"/"tratamento"/"cura"/"resultado garantido"; a IA nunca decide sozinha), segurança clínica (`SAFETY_PATTERNS`), anti-injection (`INJECTION_PATTERNS`, `SYSTEM_PROMPT_SENTINELS`) e os 3 blocos de metodologia que garantem catálogo fechado + segurança + linguagem. **Aparecem na UI em somente-leitura, com cadeado e justificativa escrita** — travado não significa escondido; significa visível e não editável.
   - **L1 — editável só com aprovação + simulador obrigatório antes de publicar:** metodologia (fora dos 3 blocos L0), documentos de RAG, guardrails adicionais (só ação `FLAG`, nunca `BLOCK`), regras de handoff, faixas numéricas do motor. **Nada de L1 é liberado para edição nesta sprint** — o simulador é Sprint 9.
   - **L2 — editável direto, publica na hora:** persona/nome/tom de voz **por ENUM, nunca textarea livre**, e FAQ (Sprint 8). **Só L2-persona entra na Sprint 7.**
2. **Configuração de IA é append-only.** `agent_config` nunca sofre `UPDATE`: cada publicação é uma linha nova com `version`, `status` (`DRAFT`/`PUBLISHED`/`ARCHIVED`), `payload jsonb` validado por Zod e `change_note` **obrigatório**. Rollback = publicar a versão anterior, 1 clique, sem re-teste.
3. **Fail-safe nunca pode significar "sem guardrail".** `resolvePrompt()` deixa de ser função pura e vira serviço com cache; se o Redis cair ou a config estiver corrompida, **cai para o default de código** (que já contém `BASE_GUARDRAIL`) — nunca para "prompt vazio".
4. **O painel não pode contornar o aparato de segurança que já existe.** O golden set em CI protege PR, não publicação por painel. Enquanto o simulador (Sprint 9) não existir, **só se libera edição cujo espaço de valores é fechado por ENUM/regex e validado por Zod + `INJECTION_PATTERNS` na gravação** — é por isso que persona é ENUM e não textarea, e é por isso que L1 fica fora.
5. **Toda publicação de configuração é auditada** (`AuditService.append`): quem, quando, versão anterior → nova, `change_note`. Sem exceção, incluindo rollback.
6. **Renomear a agente propaga para todas as superfícies.** Trocar o nome no painel precisa refletir em `coach-messages.ts`, `FORA_DE_ESCOPO_RESPONSE`, templates de WhatsApp e no prompt — nome inconsistente entre canais é bug de produto, não detalhe.
7. **Nenhuma tela nova relaxa RLS.** Toda leitura do painel continua sob `SET LOCAL app.current_role`; nenhum endpoint aceita `user_id` vindo do cliente; agregados de perfil de cliente respeitam **k-anonimato (n ≥ 10)**.
8. **Dado de saúde só aparece sob capability própria.** `STUDENTS_READ` (ver o aluno) é separado de `STUDENTS_HEALTH_READ` (ver anamnese/PAR-Q/dor). Quem faz suporte vê o aluno, **não** vê a saúde dele.
9. **Guardrails de linguagem valem também na UI do painel** (Sofia §13): rótulos, tooltips e textos de ajuda nunca usam "diagnóstico"/"tratamento"/"cura"; a IA é sempre descrita como ferramenta do profissional CREF.
10. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI; cobertura ≥80%; testes de RBAC/capability, de append-only da config, de fail-safe do prompt e de k-anonimato **bloqueantes**. Nenhum push direto.

---

# ÉPICO 8 — Arquitetura de Informação e Governança de Acesso da Plataforma
# ÉPICO 9 — Métricas de Decisão sem Migration (Financeiro · Marketing · Alunos · Sistema)
# ÉPICO 10 — Fundação do Painel de IA (configuração sem tocar em código-fonte)

### Descrição

O Control Center entregue na Sprint 6 organizou o dashboard por **quem faz o trabalho** (Visão Geral / Operação / Negócio / Governança). O fundador descreveu o resultado como "bagunçado", e o diagnóstico do discovery é preciso: **um dashboard de fundador não se organiza por quem executa, se organiza por sobre o que se decide.** A Sprint 7 reorganiza a plataforma em **5 pilares de decisão — Alunos, Financeiro, Marketing, IA e Sistema — mais uma Visão Geral que é resumo, não sexta tela**, com o menu, as capabilities e a rota-padrão-por-papel refeitos em cima disso (Épico 8).

Sobre essa estrutura nova, o Épico 9 liga **todas as métricas que o schema atual já consegue responder hoje, sem uma linha de migration** — e são mais do que parece: o **calendário de renovação de 90 dias** (a "previsão" que o fundador pediu, extraída de `subscriptions.currentPeriodEnd`, o melhor ganho/esforço do documento inteiro), o **churn por motivo** (`cancelReason`, gravado desde a Sprint 4 e nunca lido), o **custo real de IA em reais por modelo e por usuário** (de `aiJobs`), o **funil por bloco da anamnese** (onde exatamente se perde gente no onboarding de 3 etapas), a **timeline única do aluno** (que mescla anamnese → protocolo → versões → check-ins → conversas → assinatura, hoje espalhada por 4 telas) e o **p95 real de latência de IA** — que o painel atual rotula incorretamente como "precisa de OpenTelemetry" quando é um `percentile_cont` sobre uma coluna que já existe.

O Épico 10 constrói a **fundação do painel de IA**: a tabela `agent_config` append-only com cache Redis e invalidação por pub/sub, o `resolvePrompt()` promovido de função pura a serviço com fallback fail-safe, a propagação do nome da agente para todas as superfícies, a **edição de persona por ENUM** (nome, auto-apresentação, descritores de tom, política de emoji, tratamento, limite de resposta) e — igualmente importante — a **seção de regras invioláveis em somente-leitura, com cadeado e justificativa**, para que os fundadores vejam exatamente o que a IA nunca fará e por quê. É a primeira entrega concreta do pedido *"sem ficar refém de alterar código-fonte"*, feita na única faixa em que isso é seguro fazer antes do simulador existir.

### Objetivo

Ao final da Sprint 7: um fundador entra na plataforma e cai direto no pilar que corresponde ao seu papel; navega por 5 áreas que respondem a perguntas de decisão ("quanto entra nos próximos 90 dias?", "onde perco gente no cadastro?", "esse aluno está sumindo?", "a IA está lenta?", "como a agente fala?"); vê, em cada pilar, números reais extraídos do que o sistema já grava; e consegue **mudar o nome, o tom e o jeito de falar da agente pelo painel, publicando na hora, com auditoria e rollback de 1 clique** — enquanto enxerga, com cadeado, as regras que ninguém pode mudar por painel e a justificativa de cada uma.

### Resultado esperado dos épicos

- **Menu de 5 pilares + Visão Geral** implementado, com rota padrão por papel no login e RBAC por capability em cada item (Suporte deixa de ser tela e vira recorte de "Base de alunos").
- **6 capabilities novas** (`FINANCE_WRITE`, `MARKETING_WRITE`, `STUDENTS_HEALTH_READ`, `SYSTEM_OPERATE`, `AI_CONFIG_READ`, `AI_CONFIG_WRITE`) + as 3 reservadas para as sprints seguintes documentadas.
- **Financeiro F1:** calendário de renovação 90d, receita em risco 30d, churn por motivo, MRR/ARR por plano, custo de IA em R$ por modelo e por usuário.
- **Marketing F1:** funil por bloco da anamnese, perfil agregado de clientes com k-anonimato, sazonalidade de cadastro.
- **Alunos F1:** ficha unificada do aluno, **timeline única**, adesão via check-ins, evolução declarada, taxa de validação reprovada por aluno, risco de churn heurístico.
- **Sistema F1:** p95 real de latência de IA, SLO board didático com semáforo e error budget, latência ponta-a-ponta do WhatsApp, uso de RAG.
- **IA fundação:** `agent_config` append-only + cache + `PromptResolverService` fail-safe + propagação de nome + UI de persona (ENUM) + **seção de regras invioláveis somente-leitura com justificativa**.
- **Visão Geral** como 1 linha-resumo clicável por pilar, respeitando RBAC.
- **Quality gate bloqueante:** RBAC por capability, append-only da config, fail-safe do prompt, k-anonimato, ausência de PII/dado de saúde fora da capability própria. CI verde, cobertura ≥80%.

### Não-escopo desta sprint (explícito — nada aqui foi descartado, tudo tem sprint)

| Item pedido pelo fundador | Por que não agora | Onde entra |
|---|---|---|
| **North Star real (treinos concluídos)** | precisa de `workout_completions` (tabela nova) + decisão de produto sobre **como** o aluno reporta o treino (quick reply no WhatsApp? confirmação no check-in?) | **Sprint 8, US-8.1** |
| **Lucro, custos e ganhos por sócio** | hoje o sistema só conhece **receita**; sem tabela `expenses` e sem `partners`/cap table não existe lucro para exibir | **Sprint 8, US-8.4/8.5** |
| **Receita efetivamente recebida (liquidação)** | precisa de tabela `payments` + webhook de liquidação do gateway | **Sprint 8, US-8.4** |
| **CAC por canal / decidir anúncio** | `anamnesisSessions` **não grava UTM hoje** — maior gap do eixo Marketing; sem origem não há atribuição | **Sprint 8, US-8.2/8.3** |
| **Conversão trial→ativo e coortes corretas** | precisa de `user_status_transitions` append-only | **Sprint 8, US-8.1** |
| **FAQ mapeado e respondido sem LLM** | mecanismo determinístico + tabela `faq_entries` + posição correta no worker (depois do guardrail clínico, antes do classificador) | **Sprint 8, US-8.6** |
| **Guardrails adicionais configuráveis (L1)** | é L1: exige simulador antes de publicar | **Sprint 9** |
| **Simulador de configuração** | pré-condição de tudo que é L1; reusa fixtures do golden set | **Sprint 9, épico próprio** |
| **Faixas numéricas do motor de treino editáveis** | L1 dentro de envelope de segurança fixo; só depois do simulador | **Sprint 9** |
| **Upload de documentos para conhecimento da IA (RAG)** | **alto risco** (RAG-poisoning, PII sem RLS, gate de revisão do RT CREF, role de banco separada `movivo_indexer`) — épico próprio | **Sprint 10, épico inteiro** |
| **Metodologia de treino editável em blocos** | artefato jurídico-profissional assinado pelo RT, não é "config"; L1 com aprovação | **Sprint 11** |
| **Regras de handoff configuráveis** | depende da fila operacional de `handoff_alerts` amadurecida | **Sprint 11** |
| **Motor de projeção financeira com cenários** | projetar exige série histórica de despesa e liquidação (Sprint 8) rodando por pelo menos 1 ciclo | **Sprint 11** |
| **Workflow de solicitação LGPD (titular)** | obrigação legal apontada por Alexandre, sem tela ainda; não bloqueia esta sprint, bloqueia go-live | **Sprint 11** |
| **Integração Meta Ads API / construtor de UTM na UI** | só depois que o volume de campanha justificar; lançamento manual de `ad_spend` cobre o começo | **Sprint 11+** |
| **OpenTelemetry / tracing distribuído** | o p95 desta sprint sai de `aiJobs.latencyMs` em SQL; tracing real é outra ordem de esforço | **Fase 6 (Henrique)** |
| Multi-idioma, app mobile, wearables, API B2B | Fase 2 do produto (Lucas §MVP) | fora do horizonte destas sprints |

### Mapa de dependências entre User Stories

```
ÉPICO 8 — ARQUITETURA DE INFORMAÇÃO
US-7.1 (Capabilities novas + menu de 5 pilares + rota por papel · Felipe+Leonardo+Sato)
        └── FUNDAÇÃO. Começa dia 1. Todas as outras US penduram aqui.
              │
   ┌──────────┼───────────────┬────────────────┬───────────────┐
   │          │               │                │               │
ÉPICO 9 — MÉTRICAS F1 (todas dependem de US-7.1, independentes entre si)
US-7.2 (Financeiro F1 · Leonardo+Felipe)          dias 3-8
US-7.3 (Marketing F1 · Leonardo+Felipe)           dias 4-8
US-7.4 (Alunos F1 + timeline única · Felipe+Leonardo)  dias 3-9   ← maior US do épico
US-7.5 (Sistema F1 + SLO board · Henrique+Felipe) dias 4-8
                                                   │
ÉPICO 10 — FUNDAÇÃO DE IA
US-7.6 (agent_config + cache + PromptResolverService + propagação de nome · Leonardo+Victor)
        └── começa dia 1 em paralelo com US-7.1 (backend puro, não depende do menu)
US-7.7 (UI de persona L2 + seção de regras invioláveis L0 · Felipe+Victor+Alexandre)
        └── depende de US-7.6 (backend) + US-7.1 (pilar IA no menu)   dias 5-9

US-7.8 (Visão Geral como resumo por pilar · Felipe) ── depende de 7.2/7.3/7.4/7.5   dias 8-9
US-7.9 (QA + segurança · Mariana+Sato) ── valida US-7.1 a 7.8   dias 3-10
```

**Sequência prática recomendada (10 dias úteis):** **US-7.1 (fundação de navegação/RBAC) e US-7.6 (fundação de config de IA) começam no dia 1 em paralelo** — são as duas fundações independentes, uma de frontend/RBAC (Felipe+Sato), outra de backend/IA (Leonardo+Victor). As quatro US de métricas correm em paralelo dos dias 3 a 9, cada uma num pilar diferente, sem colisão de arquivo. US-7.7 (UI de IA) dias 5-9 sobre o backend da 7.6. US-7.8 fecha a Visão Geral quando os pilares já têm número. US-7.9 corre do dia 3 ao 10.

---

## Novas capabilities RBAC introduzidas nesta sprint

| Capability | O que libera | Quem recebe no MVP |
|---|---|---|
| `FINANCE_READ` *(já existente, reescopada)* | ver o pilar Financeiro (MRR/ARR, renovações, churn, custo de IA) | `ADMIN`, papel `FINANCE` (Eduardo/fundador financeiro) |
| **`FINANCE_WRITE`** | lançar/editar dados financeiros manuais (prepara `expenses`/`ad_spend` da Sprint 8; nesta sprint governa apenas ações de configuração de exibição) | `ADMIN`, `FINANCE` |
| **`MARKETING_WRITE`** | lançar campanha/investimento e editar parâmetros de marketing (idem, prepara Sprint 8) | `ADMIN`, papel `MARKETING` (Cahuã/Helena) |
| `STUDENTS_READ` *(já existente, reescopada)* | ver base de alunos, status, adesão, timeline **sem dado de saúde** | `ADMIN`, `PROFESSIONAL`, `SUPPORT` |
| **`STUDENTS_HEALTH_READ`** | ver anamnese, respostas PAR-Q, relatos de dor, `checkins.responses` decifrado | **somente `ADMIN` e `PROFESSIONAL` (RT CREF)** — **nunca `SUPPORT`** |
| **`SYSTEM_OPERATE`** | ver filas/jobs, reprocessar job, ver SLO board e incidentes | `ADMIN`, papel `ENGINEERING` |
| **`AI_CONFIG_READ`** | ver o pilar IA, incluindo a seção de regras invioláveis (somente leitura) | `ADMIN`, `PROFESSIONAL`, `ENGINEERING` |
| **`AI_CONFIG_WRITE`** | publicar configuração **L2** (persona/tom/nome) e fazer rollback | `ADMIN`, `ENGINEERING` |
| `AI_KNOWLEDGE_WRITE` *(reservada — Sprint 10)* | subir documento para o corpus de RAG | `ADMIN`, `ENGINEERING` |
| **`AI_KNOWLEDGE_APPROVE`** *(reservada — Sprint 10)* | **aprovar** documento de RAG para indexação | **somente `PROFESSIONAL` (RT CREF)** — **exceção explícita: `ADMIN` NÃO herda** |
| `AI_METHODOLOGY_APPROVE` *(reservada — Sprint 11)* | aprovar alteração de metodologia | **somente `PROFESSIONAL` (RT CREF)** — `ADMIN` NÃO herda |

> **Ponto de atenção estrutural (Victor):** hoje `ADMIN` herda tudo via `ALL_CAPABILITIES`. As capabilities de **aprovação** (`AI_KNOWLEDGE_APPROVE`, `AI_METHODOLOGY_APPROVE`) quebram esse modelo de propósito: quem aprova conteúdo clínico-metodológico é o **Responsável Técnico CREF**, não o administrador do sistema — é exatamente a separação que sustenta a defensabilidade jurídica construída por Alexandre. O mecanismo de exceção (uma denylist explícita sobre `ALL_CAPABILITIES`) **é implementado nesta sprint (TASK-7.1.2)** mesmo com as capabilities ainda reservadas, para que a Sprint 10 não precise mexer no núcleo de RBAC sob pressão de escopo.

---

## US-7.1 — Arquitetura de informação: capabilities novas, menu de 5 pilares e rota padrão por papel

**Agentes:** Felipe (lead — menu, guarda de rota, rota padrão) · Leonardo (colabora — capabilities no backend, denylist de herança do ADMIN, endpoints) · Sato (valida — RBAC, escalonamento, separação saúde/suporte) · Sofia (referência — hierarquia visual e nomenclatura dos itens).
**Depende de:** shell autenticado e RBAC do Control Center (Sprints 5 e 6). **É uma das duas US que começam no dia 1.**
**Habilita:** US-7.2, 7.3, 7.4, 7.5, 7.7, 7.8 — todas vivem dentro de um pilar do menu novo.

### Jornada

A queixa do fundador ("bagunçado") tem causa identificável: o menu atual — Visão Geral / Operação / Negócio / Governança — organiza a plataforma por **função de quem executa**, herança natural de quando o painel só servia à supervisão CREF. Mas um fundador não entra na plataforma perguntando "o que é operação?"; entra perguntando "quanto entra mês que vem?", "esse aluno vai cancelar?", "o anúncio está funcionando?", "a IA está falando certo?". **O menu precisa espelhar a pergunta, não o organograma.**

Felipe reconstrói a navegação em **5 pilares + Visão Geral solta na raiz**:

```
◆ Visão Geral                    (item raiz, sem submenu — é resumo, não tela de métricas próprias)
▸ ALUNOS
    · Base de alunos             (lista, filtros, busca — recorte de suporte vive aqui)
    · Ficha do aluno             (histórico + evolução + timeline unificada)
    · Fila do Profissional       (ex-"Educação Física": revisão/assinatura/handoff SAFETY/PAR-Q bloqueado)
    · Coortes & Retenção
▸ FINANCEIRO
    · Receita & Assinaturas      · Custos
    · Resultado & Projeção       · Sócios & Distribuição
▸ MARKETING
    · Aquisição & Canais         · Funil de conversão
    · Perfil de clientes         · Campanhas & Experimentos
▸ IA
    · Persona & Tom de voz       · Regras invioláveis (🔒 somente leitura)
    · Conhecimento (RAG)         · FAQ            [itens presentes, estado "em breve" nesta sprint]
▸ SISTEMA
    · Saúde & Disponibilidade    · Filas & Jobs
    · Compliance & Privacidade   (ex-"Compliance")
    · Auditoria                  · Administração
```

Três mudanças estruturais acompanham o menu. **(1) "Suporte" deixa de ser tela própria** — vira um recorte de "Base de alunos" sob a capability `SUPPORT_READ`, exibindo o aluno **sem nenhuma coluna de saúde**; ter duas listas de alunos (uma "de suporte", outra "de produto") era parte da bagunça. **(2) A separação `STUDENTS_READ` vs `STUDENTS_HEALTH_READ`** é criada agora, e é uma correção de privacidade real, não cosmética: hoje quem vê o aluno vê a anamnese junto, e futuras contratações de suporte não devem ver relato de dor nem resposta de PAR-Q (dado de saúde, Art. 11 — Alexandre). **(3) Rota padrão por papel no login:** `PROFESSIONAL` cai na Fila do Profissional, `FINANCE` no Financeiro, `MARKETING` no Marketing, `ENGINEERING` no Sistema, `ADMIN` na Visão Geral — o fundador não deve navegar três cliques até o que ele abre todo dia.

Leonardo implementa as capabilities novas no mecanismo já existente do Control Center e, crucialmente, o **mecanismo de denylist de herança do `ADMIN`** — porque `ALL_CAPABILITIES` dando tudo ao admin é razoável para leitura, mas errado para **aprovação de conteúdo clínico** (Sprint 10/11). Itens de menu sem capability **não aparecem** (não aparecem desabilitados — não aparecem), e o backend valida capability por endpoint independentemente do que a UI mostra. Sato valida que não há escalonamento e que `SUPPORT` não alcança rota nem endpoint de saúde.

### Objetivo

Ter a plataforma navegável por 5 pilares de decisão + Visão Geral, com 6 capabilities novas aplicadas em UI e backend, separação efetiva entre ver-aluno e ver-saúde-do-aluno, rota padrão por papel no login e o mecanismo de exceção à herança do `ADMIN` implementado.

### Resultado esperado

Um fundador com papel `FINANCE` faz login e cai em Financeiro, e **não enxerga no menu** os itens de IA-write nem de Sistema; um usuário com `SUPPORT_READ` abre a base de alunos, vê nome/status/adesão e **não vê nenhuma coluna de saúde**, e recebe `403` se chamar o endpoint de anamnese direto; o RT CREF cai na Fila do Profissional; nenhum item de menu órfão sobrou do layout antigo; `ADMIN` continua vendo tudo **exceto** as capabilities marcadas na denylist.

### Tasks

**TASK-7.1.1 — Capabilities novas no backend + guarda por endpoint (Leonardo + Sato).**
Adicionar ao mecanismo de capabilities do Control Center: `FINANCE_WRITE`, `MARKETING_WRITE`, `STUDENTS_HEALTH_READ`, `SYSTEM_OPERATE`, `AI_CONFIG_READ`, `AI_CONFIG_WRITE`, e registrar (sem uso ativo) `AI_KNOWLEDGE_WRITE`, `AI_KNOWLEDGE_APPROVE`, `AI_METHODOLOGY_APPROVE`. Aplicar guarda **por endpoint** — a checagem de UI nunca é a checagem de verdade. Separar as leituras de aluno: rotas/campos de anamnese, PAR-Q, dor e `checkins.responses` decifrado passam a exigir `STUDENTS_HEALTH_READ`.
**Conclusão:** endpoint de saúde retorna `403` para quem tem só `STUDENTS_READ`; matriz papel→capability documentada no código; teste de RBAC verde.

**TASK-7.1.2 — Denylist de herança do `ADMIN` (Leonardo + Sato + Alexandre).**
Implementar a exceção explícita a `ALL_CAPABILITIES`: uma lista declarada de capabilities que **não** são herdadas por `ADMIN` e só existem no papel `PROFESSIONAL` (RT CREF) — hoje `AI_KNOWLEDGE_APPROVE` e `AI_METHODOLOGY_APPROVE`. Documentar a justificativa jurídica no próprio código (separação entre administrar o sistema e aprovar conteúdo clínico-metodológico).
**Conclusão:** `ADMIN` não recebe as capabilities da denylist; teste prova que a herança total não as inclui; Alexandre valida a separação por escrito.

**TASK-7.1.3 — Menu de 5 pilares + Visão Geral na raiz (Felipe + Sofia ref.).**
Reconstruir a navegação conforme a árvore acima. Itens filtrados por capability (**ausentes**, não desabilitados). Itens do pilar IA ainda sem tela (Conhecimento, FAQ) aparecem com estado "em breve" explícito e a sprint prevista — o fundador deve enxergar o roadmap dentro do produto, não fora dele. Remover/realocar os itens do layout antigo sem deixar rota órfã (redirects de rota antiga → nova). WCAG 2.2 AA, navegação por teclado.
**Conclusão:** menu novo renderiza com filtro por capability; nenhuma rota antiga quebrada (redirect coberto por teste); a11y ok.

**TASK-7.1.4 — Suporte como recorte de "Base de alunos" (Felipe + Leonardo).**
Eliminar a tela de Suporte independente; a Base de alunos passa a renderizar colunas condicionadas por capability — quem tem só `SUPPORT_READ`/`STUDENTS_READ` vê identificação, status de assinatura, adesão e último contato; quem tem `STUDENTS_HEALTH_READ` vê adicionalmente os campos de saúde. O backend **não envia** o campo que a capability não autoriza (filtro no servidor, não na renderização).
**Conclusão:** payload da API não contém campo de saúde para quem não tem a capability (verificado no teste, não só na UI); tela de Suporte antiga removida sem perda de função.

**TASK-7.1.5 — Rota padrão por papel no login (Felipe).**
Após autenticação, redirecionar por papel: `PROFESSIONAL`→Alunos/Fila do Profissional; `FINANCE`→Financeiro/Receita & Assinaturas; `MARKETING`→Marketing/Aquisição & Canais; `ENGINEERING`→Sistema/Saúde & Disponibilidade; `ADMIN`→Visão Geral. Fallback para Visão Geral se o papel não tiver rota mapeada ou não tiver a capability do destino.
**Conclusão:** cada papel cai na sua rota; fallback coberto; teste por papel verde.

### Definição de Pronto (US-7.1 "validada")

- [ ] Tasks 7.1.1–7.1.5 concluídas.
- [ ] Menu de 5 pilares + Visão Geral no ar; 6 capabilities novas ativas + 3 reservadas registradas; denylist de herança do `ADMIN` funcionando; Suporte virou recorte da Base de alunos; rota padrão por papel.
- [ ] **Mensurável:** payload de API para papel sem `STUDENTS_HEALTH_READ` contém **0** campos de saúde; **0** rotas órfãs do menu antigo; 100% dos itens de menu com capability declarada.
- [ ] **Validada por:** code review + **revisão de RBAC de Sato** (escalonamento, separação saúde/suporte) + validação de Alexandre (separação de aprovação clínica) + teste de capability por papel verde (US-7.9).

---

## US-7.2 — Pilar Financeiro F1: renovações, receita em risco, churn por motivo e custo real de IA

**Agentes:** Leonardo (lead — queries, endpoints) · Felipe (colabora — telas, gráficos) · Eduardo (referência — definição de MRR/ARR, receita em risco, unit economics) · Henrique (colabora — tabela de preço por modelo).
**Depende de:** US-7.1 (pilar no menu + `FINANCE_READ`). Dias 3-8.
**Habilita:** a Sprint 8 (`expenses`/`payments`/`partners`) — que transforma "receita" em "lucro" — e o motor de projeção da Sprint 11.

### Jornada

O fundador pediu "prever lucros, custos, ganhos por sócio, investimentos". **Fato desconfortável que precisa ser dito antes de qualquer tela:** o sistema hoje conhece **receita contratada** e **não conhece nenhuma despesa** — não existe lucro para exibir, e qualquer tela que exibisse um número chamado "lucro" nesta sprint estaria inventando. O que **existe hoje**, e não está sendo usado, é bastante:

**(1) Calendário de renovação de 90 dias.** `subscriptions.currentPeriodEnd` agrupado por mês responde à pergunta "quanto entra nos próximos 3 meses, e quando?" — é a "previsão" que o fundador pediu, na versão honesta (receita contratada a vencer, não projeção especulativa). **É o melhor ganho por esforço deste documento inteiro:** uma query de agrupamento sobre uma coluna já existente. Com os planos Mensal R$39 / Trimestral R$99 / Anual R$349 (Eduardo), o calendário mostra também a concentração de risco: um mês onde vencem muitos trimestrais é um mês de decisão.

**(2) Receita em risco nos próximos 30 dias:** o subconjunto do calendário que vence em 30 dias, segmentado por sinal de risco (aluno sem check-in respondido, sem conversa recente). É a lista onde a ação de retenção tem retorno imediato.

**(3) Churn por motivo.** `subscriptions.canceledAt` + `cancelReason` estão gravados desde a Sprint 4 e **nunca foram lidos por nenhuma tela**. Distribuir cancelamentos por motivo é a diferença entre "perdemos 8 alunos" e "perdemos 8 alunos, 5 por preço" — a primeira frase não gera decisão, a segunda gera.

**(4) MRR/ARR por plano:** já calculado, agora segmentado por plano e por período, com a coorte de origem quando disponível.

**(5) Custo real de IA em reais.** `aiJobs` já persiste `tokensInput`, `tokensOutput`, `modelUsed` e `latencyMs`. Falta **só** uma tabela de preço por modelo para converter token em real. A decisão de escopo aqui é deliberadamente preguiçosa e correta: nesta sprint o preço por modelo entra como **constante versionada em código** (GPT-4.1 principal, Claude Sonnet 4.5 fallback — ADR-005-R), **não** como tabela `model_pricing` editável — a tabela chega na Sprint 8 junto com `expenses`, porque as duas resolvem o mesmo problema (custo) e devem ser desenhadas juntas. Com isso o fundador já enxerga **custo de IA por usuário/mês**, que Eduardo estimou em ~R$0,95–0,97 de delta na troca de LLM e que é o principal custo variável do unit economics.

Toda tela deste pilar exibe **a data do dado e a fonte** — e onde o número não existe (lucro, receita recebida, CAC), a tela diz explicitamente *"indisponível: depende de X, previsto para a Sprint 8"*, com link para o item de roadmap. Um "—" mudo é pior que a ausência: faz o fundador achar que é zero.

### Objetivo

Ter o pilar Financeiro respondendo, com dados reais do schema atual, a quatro perguntas: quanto entra nos próximos 90 dias e quando; quanto está em risco nos próximos 30; por que as pessoas cancelam; e quanto a IA custa por usuário.

### Resultado esperado

O fundador abre Financeiro e vê: um calendário de 90 dias com valor a renovar por mês e por plano; uma lista nominal de assinaturas em risco nos próximos 30 dias com o sinal que motivou o alerta; a distribuição de cancelamentos por motivo no período; MRR/ARR por plano; e o custo de IA em reais por modelo e por usuário/mês. Os números que ainda não existem aparecem rotulados com a dependência e a sprint prevista, nunca como zero ou traço.

### Tasks

**TASK-7.2.1 — Calendário de renovação 90 dias + receita em risco 30 dias (Leonardo + Felipe).**
Query de agrupamento sobre `subscriptions.currentPeriodEnd` (status ativo) por mês e por plano, horizonte de 90 dias, com valor total e contagem. Recorte de 30 dias cruzado com sinais de risco já disponíveis (sem check-in respondido na última semana, sem mensagem recebida em N dias — reusar a heurística da US-7.4 quando ela existir; até lá, sinal simples). Sob RLS e `FINANCE_READ`.
**Conclusão:** calendário renderiza 3 meses com valor/contagem por plano; lista de risco 30d exibe o sinal que motivou cada item; query com índice adequado e tempo de resposta < 500ms na base de dev com volume simulado.

**TASK-7.2.2 — Churn por motivo + MRR/ARR por plano (Leonardo + Felipe + Eduardo ref.).**
Ler `canceledAt` + `cancelReason` (nunca consumidos até hoje) e montar distribuição por motivo e por período, com série temporal. MRR/ARR segmentado por plano (Mensal/Trimestral/Anual), com a fórmula visível na UI (tooltip) — Eduardo valida as definições para que o número do painel seja o mesmo número da planilha do CFO.
**Conclusão:** distribuição de churn por motivo renderiza; MRR/ARR por plano confere com cálculo manual sobre a base de dev (verificado no teste); definição de cada métrica documentada na UI.

**TASK-7.2.3 — Custo real de IA em reais por modelo e por usuário (Leonardo + Henrique).**
Constante versionada em código com preço por 1k tokens de entrada/saída dos modelos em uso (GPT-4.1 principal, Claude Sonnet 4.5 fallback — ADR-005-R). Agregar `aiJobs.tokensInput/tokensOutput` por `modelUsed`, período e usuário → custo em R$. Exibir custo total/mês, custo por usuário ativo/mês e participação de cada modelo. Marcar no código o ponto de substituição pela tabela `model_pricing` da Sprint 8.
**Conclusão:** custo de IA em R$ por modelo e por usuário/mês renderiza e bate com cálculo manual sobre `aiJobs` na base de dev; preço por modelo versionado num único ponto do código.

**TASK-7.2.4 — Rotulagem honesta de métricas indisponíveis (Felipe + Lucas ref.).**
Todo indicador do pilar que depende de dado inexistente (lucro, receita recebida/liquidada, custo de infra, distribuição por sócio, CAC) exibe um estado explícito: *"indisponível — depende de \<dependência\>, previsto para a Sprint \<N\>"*, com a dependência nomeada. **Proibido** exibir `0`, `—` ou `R$ 0,00` para dado ausente.
**Conclusão:** nenhum indicador ausente aparece como zero ou traço; cada um nomeia sua dependência e sprint; revisado por Lucas.

### Definição de Pronto (US-7.2 "validada")

- [ ] Tasks 7.2.1–7.2.4 concluídas.
- [ ] Calendário 90d, receita em risco 30d, churn por motivo, MRR/ARR por plano e custo de IA em R$ no ar, sob `FINANCE_READ` e RLS.
- [ ] **Mensurável:** MRR/ARR e custo de IA conferem com cálculo manual sobre a base de dev (tolerância 0); `cancelReason` deixa de ter 0 leituras no produto; **0** indicadores ausentes exibidos como zero/traço.
- [ ] **Validada por:** code review + **validação de definições por Eduardo** (MRR/ARR/receita em risco) + teste de RBAC/RLS + teste de conferência numérica verde (US-7.9).

---

## US-7.3 — Pilar Marketing F1: funil da anamnese, perfil agregado de clientes e sazonalidade

**Agentes:** Leonardo (lead — queries, k-anonimato) · Felipe (colabora — telas) · Helena (referência — leitura de funil e definição de etapa) · Alexandre (valida — agregação e k-anonimato sobre dado sensível).
**Depende de:** US-7.1 (pilar no menu). Dias 4-8.
**Habilita:** a Sprint 8 (UTM + `ad_spend`), que transforma "quem chega" em "de onde vem e a que custo".

### Jornada

O fundador quer "dados sobre clientes para decidir anúncios, campanhas, contratações, parcerias, eventos". **O gap central precisa ser dito de frente: `anamnesisSessions` não grava UTM hoje.** Sem origem de tráfego, **não existe CAC por canal, não existe ROAS, não existe "qual anúncio funciona"** — e isso não se resolve com tela, se resolve com 5 colunas novas (`utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `referrer`) capturadas no primeiro toque. É a primeira coisa da Sprint 8 e a mais barata de todas as migrations pendentes; quanto mais tarde entrar, mais histórico de aquisição se perde para sempre.

O que **dá para entregar hoje**, e é decisório mesmo sem atribuição:

**(1) Funil por bloco da anamnese.** A Sprint 6 entregou o onboarding em 3 etapas e gravou `anamnesisSessions.status` + `lastStep`. Cruzar os dois responde **exatamente onde as pessoas desistem** — bloco 1, bloco 2 ou bloco 3, e em que campo pararam. É a métrica de produto com maior alavanca de receita do painel: cada ponto percentual recuperado no bloco onde mais se perde é conversão que não custa mídia nenhuma. Helena valida a definição das etapas para que o funil do painel seja o mesmo funil do plano de GTM.

**(2) Perfil agregado de clientes.** Objetivo de treino, local de treino (casa/academia) e faixa etária, agregados, **com k-anonimato (supressão de qualquer célula com n < 10 — mecanismo já implementado, exigência de Alexandre)**. É o dado que embasa "para quem anunciar", "que parceria faz sentido", "que evento vale" — sem expor indivíduo. Nenhuma célula deste pilar permite drill-down até o aluno: quem quer o indivíduo vai ao pilar Alunos, com a capability correspondente.

**(3) Sazonalidade de cadastro.** Heatmap dia-da-semana × hora dos cadastros iniciados — que hoje está mal alocado na Visão Geral, onde não ajuda ninguém a decidir nada, e no pilar Marketing vira decisão de horário de veiculação e de plantão de atendimento.

### Objetivo

Ter o pilar Marketing respondendo, sem migration, onde exatamente se perde gente no cadastro, quem é o cliente em agregado seguro e quando as pessoas chegam — e declarando explicitamente que origem/CAC dependem de UTM (Sprint 8).

### Resultado esperado

O fundador abre Marketing e vê: o funil de anamnese com taxa de queda por bloco e por campo de parada; o perfil agregado dos clientes por objetivo, local e faixa etária, com células pequenas suprimidas; e o heatmap de sazonalidade de cadastro. Onde estaria "CAC por canal" há um cartão explicando que depende da captura de UTM, prevista para a Sprint 8.

### Tasks

**TASK-7.3.1 — Funil por bloco da anamnese (Leonardo + Felipe + Helena ref.).**
Query sobre `anamnesisSessions.status` + `lastStep` produzindo: iniciados, concluídos por bloco, abandono por bloco e **campo de parada mais frequente** dentro do bloco com maior queda. Série temporal e comparação período a período. Helena valida as etapas do funil contra o funil de GTM.
**Conclusão:** funil renderiza os 3 blocos com taxa de queda; o campo de parada mais frequente é identificado; definições alinhadas com Helena.

**TASK-7.3.2 — Perfil agregado de clientes com k-anonimato (Leonardo + Felipe + Alexandre).**
Agregados de objetivo de treino, local de treino e faixa etária, reusando o mecanismo de k-anonimato existente (**suprimir célula com n < 10**, e suprimir também a complementar quando a supressão for reversível por subtração). **Sem drill-down para indivíduo neste pilar.** Alexandre valida o recorte sobre dado derivado de anamnese.
**Conclusão:** nenhuma célula com n < 10 é exibida; supressão complementar coberta por teste; sem link para ficha individual; Alexandre valida.

**TASK-7.3.3 — Sazonalidade de cadastro + realocação (Felipe).**
Mover o heatmap dia×hora de cadastros da Visão Geral para Marketing, com filtro de período. Remover da Visão Geral (que passa a ser resumo por pilar — US-7.8).
**Conclusão:** heatmap renderiza em Marketing com filtro de período; removido da Visão Geral sem rota órfã.

**TASK-7.3.4 — Cartão de dependência de atribuição (Felipe + Lucas ref.).**
No lugar de "Aquisição & Canais" e "Campanhas & Experimentos", exibir estado explicativo: quais métricas viverão ali (origem, CAC por canal, ROAS, conversão por campanha), qual a dependência (**captura de UTM em `anamnesisSessions` + tabela `ad_spend`**) e a sprint prevista (8). Mesma regra da TASK-7.2.4: nada exibido como zero.
**Conclusão:** os itens do menu existem, abrem e explicam a dependência; nenhum número inventado.

### Definição de Pronto (US-7.3 "validada")

- [ ] Tasks 7.3.1–7.3.4 concluídas.
- [ ] Funil por bloco, perfil agregado com k-anonimato e sazonalidade no ar; dependência de UTM declarada na própria tela.
- [ ] **Mensurável:** **0** células exibidas com n < 10 (teste com base sintética de células pequenas); o bloco de maior abandono da anamnese é identificável numericamente; heatmap não existe mais na Visão Geral.
- [ ] **Validada por:** code review + **validação de Alexandre** (k-anonimato/agregação) + validação de definições por Helena + teste de supressão verde (US-7.9).

---

## US-7.4 — Pilar Alunos F1: ficha unificada, timeline única, adesão, evolução e risco de churn

**Agentes:** Felipe (lead — ficha e timeline) · Leonardo (colabora — agregação da timeline, decifra sob RLS, heurística de risco) · Sofia (referência — hierarquia da ficha e legibilidade da timeline) · Alexandre (valida — exibição de dado de saúde sob capability).
**Depende de:** US-7.1 (capability `STUDENTS_HEALTH_READ`). Dias 3-9. **É a maior US do épico de métricas.**
**Habilita:** a Sprint 8 (`workout_completions` — a North Star real) e o refino de metodologia da Sprint 11.

### Jornada

O fundador pediu "histórico e evolução dos alunos, refinar metodologia, garantir adesão e resultados". Hoje o histórico de um aluno **existe inteiro no banco e não existe em lugar nenhum na tela**: a anamnese está numa tela, o protocolo em outra, as versões em outra, os check-ins em outra, as conversas em outra. Para entender **um** aluno, o RT abre quatro telas e reconstrói a ordem de cabeça. É o maior valor construível hoje sem migration nenhuma, e é essencialmente um trabalho de **junção e ordenação**.

**A entrega central é a timeline única do aluno**: um único fluxo cronológico que mescla anamnese concluída → protocolo gerado → cada versão de protocolo (com quem assinou e por quê) → cada check-in (respondido ou não, com adesão e RPE declarados) → conversas relevantes (marcos, não transcrição completa) → eventos de assinatura (trial, conversão, renovação, cancelamento com motivo) → handoffs abertos e resolvidos. Lida de cima a baixo, ela conta a história do aluno — que é exatamente o insumo para "refinar metodologia".

Em volta dela, a **ficha unificada**: identificação e status, protocolo vigente com versões, assinatura do RT, e — **somente sob `STUDENTS_HEALTH_READ`** — anamnese, PAR-Q e relatos de dor, decifrados sob RLS via `health-cipher`. Para quem tem só `STUDENTS_READ`/`SUPPORT_READ`, a ficha existe mas a seção de saúde **não é enviada pelo backend**.

Sobre isso, três leituras derivadas:

- **Adesão:** `checkins.respondedAt`/`completedAt` dão taxa de resposta ao check-in e regularidade — **o proxy honesto de aderência enquanto `workout_completions` não existe**. A tela deve dizer isso com todas as letras: *"adesão declarada via check-in — treino concluído verificado chega na Sprint 8"*.
- **Evolução declarada:** `checkins.responses` (peso, RPE, pedido de ajuste) em série, dado de saúde, sob capability e decifrado sob RLS.
- **Sinal de qualidade da IA por aluno:** taxa de `conversations.validationPassed = false` — quando concentra num aluno, é sinal de que o AI Coach está falhando com aquele perfil, e é insumo direto do pilar IA.
- **Risco de churn heurístico:** combinação simples e explicável — dias sem mensagem + check-in não respondido + trial terminando. **`ponytail:` heurística de 3 sinais somados, sem modelo; trocar por score treinado só quando houver volume de cancelamento suficiente para validar.** A tela **mostra quais sinais dispararam**, nunca só um número: um score opaco não gera ação, três sinais nomeados geram.

**Guardrail de linguagem (Sofia §13, inegociável):** nada nesta tela usa "diagnóstico", "tratamento", "quadro clínico" ou "resultado garantido". "Risco de churn" é risco **comercial** de cancelamento — nunca risco de saúde.

### Objetivo

Ter a ficha do aluno unificada com timeline cronológica única, adesão e evolução declaradas, sinal de qualidade da IA por aluno e risco de cancelamento explicável por sinais — com dado de saúde estritamente atrás de `STUDENTS_HEALTH_READ`.

### Resultado esperado

O RT abre um aluno e lê, num único fluxo, tudo o que aconteceu com ele desde o cadastro, em ordem, sem trocar de tela; vê adesão declarada e evolução em série; vê quais alunos estão em risco de cancelar **e por quais sinais**; e um usuário de suporte abre o mesmo aluno e não recebe do servidor nenhum campo de saúde.

### Tasks

**TASK-7.4.1 — Timeline única do aluno (Leonardo + Felipe + Sofia ref.).**
Endpoint que mescla e ordena por timestamp: anamnese (marcos), protocolo e versões (com autor/assinatura), check-ins (enviado/respondido, adesão, RPE), marcos de conversa, eventos de assinatura (trial/conversão/renovação/cancelamento+motivo) e handoffs (aberto/resolvido). Paginação por período. Cada item com tipo, ícone e ação de contexto. Campos de saúde só embarcam com `STUDENTS_HEALTH_READ`.
**Conclusão:** timeline renderiza os 6 tipos de evento em ordem única e correta (teste com fixture de aluno completo); sem campo de saúde no payload para quem não tem a capability.

**TASK-7.4.2 — Ficha unificada + seção de saúde sob capability (Felipe + Leonardo + Alexandre).**
Cabeçalho da ficha (identificação, status de assinatura, protocolo vigente, versão, assinatura do RT) + seção de saúde (anamnese, PAR-Q, relatos de dor) **condicionada a `STUDENTS_HEALTH_READ`**, decifrada sob RLS/`SET LOCAL` via `health-cipher`. Alexandre valida a exibição de dado Art. 11 no painel.
**Conclusão:** ficha renderiza; seção de saúde ausente do payload sem a capability; decifra só sob RLS; Alexandre valida.

**TASK-7.4.3 — Adesão e evolução declaradas (Leonardo + Felipe).**
Taxa de resposta ao check-in e regularidade a partir de `checkins.respondedAt`/`completedAt`; série de evolução declarada (peso, RPE, pedidos de ajuste) a partir de `checkins.responses` decifrado. **Rótulo obrigatório na UI** de que é declarado via check-in e que o treino concluído verificado depende de `workout_completions` (Sprint 8).
**Conclusão:** adesão e evolução renderizam por aluno; rótulo de "declarado" presente; North Star continua marcada como indisponível com dependência nomeada (não como zero).

**TASK-7.4.4 — Sinal de qualidade da IA por aluno (Leonardo + Felipe).**
Taxa de `conversations.validationPassed = false` por aluno e no agregado, com acesso às ocorrências (conversa anonimizada pelo PII Scrubber, como na US-5.6). Expor o agregado também no pilar IA.
**Conclusão:** taxa por aluno e agregada renderiza; ocorrências acessíveis anonimizadas; sem PII em claro.

**TASK-7.4.5 — Risco de cancelamento explicável (Leonardo + Felipe).**
Heurística de 3 sinais (dias sem mensagem, check-in não respondido, trial/renovação próxima) com limiares **em constante única e comentada**. Lista ordenada por risco, **exibindo os sinais que dispararam em cada caso**. Nomenclatura estritamente comercial (cancelamento), nunca clínica. Ligar à lista de "receita em risco 30d" da US-7.2.
**Conclusão:** lista de risco renderiza com os sinais nomeados por aluno; limiares num único ponto; copy revisada nos guardrails; alimenta a US-7.2.

### Definição de Pronto (US-7.4 "validada")

- [ ] Tasks 7.4.1–7.4.5 concluídas.
- [ ] Ficha unificada + timeline única + adesão/evolução declaradas + qualidade da IA por aluno + risco de cancelamento explicável.
- [ ] **Mensurável:** a timeline de um aluno-fixture completo contém **todos** os eventos das 6 origens em ordem cronológica correta; payload sem `STUDENTS_HEALTH_READ` contém **0** campos de saúde; **0** ocorrências de termos clínicos proibidos na copy (teste de guardrail de linguagem); a informação antes distribuída em 4 telas passa a ser acessível em **1**.
- [ ] **Validada por:** code review + **validação de Alexandre** (dado de saúde sob capability) + revisão de Sofia (legibilidade/guardrails) + revisão de Sato (RLS/anonimização) + testes verdes (US-7.9).

---

## US-7.5 — Pilar Sistema F1: p95 real de latência, SLO board didático, latência de WhatsApp e uso de RAG

**Agentes:** Henrique (lead — SLO, error budget, observabilidade) · Leonardo (colabora — queries de percentil) · Felipe (colabora — telas/semáforo) · Sofia (referência — didática do semáforo).
**Depende de:** US-7.1 (`SYSTEM_OPERATE`). Dias 4-8.
**Habilita:** o endurecimento de infra da Fase 6 e o registro de incidentes/uptime da Sprint 8.

### Jornada

O fundador pediu "informações técnicas fácil e didática, garantir qualidade e disponibilidade" — e a palavra que carrega o requisito é **didática**: quem lê esta tela nem sempre é engenheiro, e um painel de números crus não informa se está tudo bem.

**Correção de premissa importante:** o painel atual rotula o p95 de latência de IA como "precisa de OpenTelemetry". **Não precisa** — para este recorte específico. `aiJobs.latencyMs` já é persistido em toda geração; p50/p95/p99 é um `percentile_cont` em SQL, agrupável por modelo, por tipo de job e por período. OpenTelemetry continua valendo para **tracing distribuído ponta a ponta** (Fase 6, Henrique), que é outro problema — mas a métrica que o fundador quer ver hoje sai de uma query.

Sobre isso, Henrique constrói o **SLO board didático**: **3 a 5 semáforos** (verde/amarelo/vermelho), cada um com o objetivo em linguagem de negócio, o valor atual e o **error budget consumido no período** — "entrega de protocolo em até 2h: 97% (meta 95%) 🟢, orçamento de erro consumido 41%". Semáforo com error budget é o formato que transforma número técnico em decisão: verde significa "pode continuar entregando feature", vermelho significa "pare e conserte".

Compõem ainda o pilar: **latência ponta-a-ponta do WhatsApp** (`conversations.latencyMs` — o tempo que o aluno de fato sente, distinto do tempo do modelo), e **uso de RAG** (volume de consultas e taxa de recuperação com resultado útil) — que é, além de sinal técnico, o insumo que vai justificar ou não o investimento no upload de conhecimento da Sprint 10.

Nesta sprint **não** entram: custo de infra/WhatsApp (depende de `expenses`, Sprint 8), histórico de incidentes/uptime real (registro manual, Sprint 8) e tracing distribuído (Fase 6). Cada um aparece com dependência nomeada, mesma regra da TASK-7.2.4.

### Objetivo

Ter o pilar Sistema com p95 real de latência de IA, SLO board didático de 3 a 5 semáforos com error budget, latência ponta-a-ponta do WhatsApp e uso de RAG — legível por não-engenheiro.

### Resultado esperado

Um fundador não-engenheiro abre Sistema e entende em 10 segundos se está tudo bem, o que está fora do objetivo e quanto de margem de erro resta no período; um engenheiro consegue descer ao p50/p95/p99 por modelo e por tipo de job.

### Tasks

**TASK-7.5.1 — p95/p99 real de latência de IA (Leonardo + Henrique).**
`percentile_cont` sobre `aiJobs.latencyMs`, agrupado por `modelUsed`, tipo de job e período, com série temporal. Remover da UI o rótulo incorreto de "requer OpenTelemetry" para este indicador. Índice adequado para a janela consultada.
**Conclusão:** p50/p95/p99 renderiza por modelo e período; confere com cálculo manual sobre a base de dev; rótulo incorreto removido.

**TASK-7.5.2 — SLO board didático com error budget (Henrique + Felipe + Sofia ref.).**
Definir **3 a 5 SLOs** com meta explícita (sugestão inicial, a confirmar com Henrique: entrega de protocolo ≤2h em ≥95%; resposta do AI Coach ≤30s no p95; taxa de sucesso de job de IA ≥99%; entrega de mensagem WhatsApp ≥99%). Cada um exibido como semáforo + objetivo em linguagem de negócio + valor atual + **error budget consumido no período**. Sem jargão sem tooltip.
**Conclusão:** 3-5 semáforos renderizam com meta, valor e error budget; texto compreensível por não-engenheiro (validado por leitura de um fundador não-dev).

**TASK-7.5.3 — Latência ponta-a-ponta do WhatsApp + uso de RAG (Leonardo + Henrique + Felipe).**
Percentis de `conversations.latencyMs` (tempo sentido pelo aluno, separado do tempo de modelo) e métricas de uso do RAG (volume de consultas, taxa de recuperação com resultado útil), com série temporal. Expor o agregado de uso de RAG também no pilar IA.
**Conclusão:** latência ponta-a-ponta e uso de RAG renderizam com série temporal; distinção entre latência de modelo e latência sentida explícita na UI.

**TASK-7.5.4 — Dependências nomeadas do pilar (Felipe).**
Custo de infra/WhatsApp, histórico de incidentes/uptime e tracing distribuído aparecem com dependência e sprint prevista (8, 8 e Fase 6), nunca como zero.
**Conclusão:** 3 dependências nomeadas na UI; nenhum indicador ausente exibido como zero.

### Definição de Pronto (US-7.5 "validada")

- [ ] Tasks 7.5.1–7.5.4 concluídas.
- [ ] p95 real de IA, SLO board de 3-5 semáforos com error budget, latência ponta-a-ponta e uso de RAG no ar, sob `SYSTEM_OPERATE`.
- [ ] **Mensurável:** p95 confere com cálculo manual sobre `aiJobs` na base de dev; **entre 3 e 5** SLOs com meta e error budget declarados; **0** indicadores rotulados como "requer OpenTelemetry" que na verdade saem do schema atual.
- [ ] **Validada por:** code review + validação de Henrique (definição de SLO/error budget) + leitura de compreensão por um fundador não-engenheiro + testes verdes (US-7.9).

---

## US-7.6 — Fundação do painel de IA: `agent_config` append-only, cache com invalidação e `PromptResolverService` fail-safe

**Agentes:** Leonardo (lead — tabela, serviço, cache, propagação) · Victor (especificação e revisão — camadas, schema Zod, fail-safe, superfície de injeção) · Sato (valida — injeção via painel, auditoria) · Henrique (colabora — pub/sub Redis).
**Depende de:** `AuditService.append` (Sprint 1), Redis (Sprint 0), prompts atuais (`ai-coach/intent/prompts.ts`). **É uma das duas US que começam no dia 1** (backend puro, não depende do menu).
**Habilita:** US-7.7 (a UI de persona) e **todo o roadmap de IA das Sprints 8 a 11** — FAQ, guardrails L1, simulador, parâmetros do motor, RAG e metodologia publicam sobre esta mesma fundação.

### Jornada

Hoje a identidade da agente é uma **string em código**: `BASE_GUARDRAIL` (`ai-coach/intent/prompts.ts`, L13-35) mistura, no mesmo template, três coisas de naturezas completamente diferentes — **quem a agente é** (identidade/persona), **até onde ela pode ir** (perímetro de escopo) e **o que ela nunca faz** (regras invioláveis regulatórias e clínicas). Enquanto estiverem no mesmo bloco, ou tudo é editável (inaceitável — abriria a porta para alguém com login remover um guardrail regulatório) ou nada é (o que é o estado atual, e é a queixa do fundador: refém do código-fonte).

A primeira entrega desta US é, portanto, **decomposição**: separar o template em três blocos de origem distinta — L0 (constante em código, imutável), perímetro de escopo (L0 nesta fase) e L2 (persona, vinda da configuração). Só depois disso a configuração faz sentido.

A segunda é a **tabela `agent_config`, append-only**: nunca um `UPDATE`. Cada publicação é uma linha nova com `version` incremental, `status` (`DRAFT`/`PUBLISHED`/`ARCHIVED`), `payload jsonb` validado por Zod, `change_note` **obrigatório** e autoria. A propriedade que isso compra é a que importa mais num sistema onde uma configuração errada muda o que a IA diz para todos os alunos ao mesmo tempo: **rollback é publicar a versão anterior — um clique, sem re-teste, sem deploy.**

A terceira é a promoção de `resolvePrompt()` de função pura a **serviço com cache**: cache em memória com TTL de 60s, invalidado por `SET` + `PUBLISH` no Redis na publicação, com a API assinando o canal. E a regra que Victor cravou e que é a mais importante do desenho: **se o Redis cair, ou o payload não validar, ou a config estiver ausente, o serviço cai para o default de código — que já contém `BASE_GUARDRAIL` completo.** Fail-safe aqui nunca pode significar "responder sem guardrail"; significa "responder com o guardrail que está compilado".

A quarta é a **propagação do nome**. Renomear a agente pelo painel precisa refletir em todas as superfícies onde o nome hoje está escrito à mão: `coach-messages.ts`, `FORA_DE_ESCOPO_RESPONSE`, templates de WhatsApp e o prompt. Uma agente que se apresenta com um nome no prompt e outro na mensagem de fora-de-escopo é um bug de produto visível para o aluno.

**Campos da fase 1 (todos L2, todos com espaço de valores fechado — é a defesa contra prompt injection por quem tem login no painel):** `agentName` (regex simples), `agentSelfIntro` (≤200 chars, **passa por `INJECTION_PATTERNS` na gravação**), `toneDescriptors` (array de ENUM de lista fixa, **máximo 4**), `emojiPolicy` (ENUM), `maxResponseChars` (faixa numérica), `treatment` (ENUM). **Nenhum textarea livre entra no prompt** — essa é a linha que não se cruza antes do simulador existir.

### Objetivo

Ter a configuração de persona da IA persistida em `agent_config` append-only, resolvida em runtime por um serviço com cache invalidável e fallback fail-safe para o default de código, com o nome propagado a todas as superfícies e toda publicação auditada.

### Resultado esperado

Publicar uma configuração de persona cria uma linha nova (nunca altera a anterior), invalida o cache e passa a valer em ≤60s sem deploy; derrubar o Redis mantém a IA respondendo com o guardrail compilado; um payload com padrão de injeção é rejeitado na gravação; renomear a agente muda o nome em todas as mensagens; toda publicação está em `audit_logs` com `change_note`.

### Tasks

**TASK-7.6.1 — Decompor `BASE_GUARDRAIL` em blocos por camada (Leonardo + Victor).**
Separar o template de `ai-coach/intent/prompts.ts` (L13-35) em blocos declarados: **identidade/persona (L2, vem da config)**, **perímetro de escopo (L0 nesta fase)** e **regras invioláveis (L0, constante em código)**. Cada bloco com marcação de camada e **justificativa textual** — a mesma justificativa será exibida na UI da US-7.7. **Comportamento do prompt final não muda nesta task** (refatoração pura).
**Conclusão:** blocos separados e marcados por camada; **golden set de conversa continua verde sem alteração de fixture** (prova de que a refatoração não mudou comportamento).

**TASK-7.6.2 — Tabela `agent_config` append-only + schema Zod (Leonardo + Victor).**
Migration de `agent_config`: `id`, `version` (incremental), `status` (`DRAFT`/`PUBLISHED`/`ARCHIVED`), `payload jsonb`, `change_note` (**NOT NULL**), `created_by`, `created_at`. **Sem `UPDATE`** — garantir por permissão de role de banco e/ou trigger, não só por convenção de código. Schema Zod dos campos da fase 1 (`agentName`, `agentSelfIntro`, `toneDescriptors` enum[] máx 4, `emojiPolicy`, `maxResponseChars`, `treatment`), com `agentSelfIntro` passando por `INJECTION_PATTERNS` **na gravação**.
**Conclusão:** `UPDATE` em `agent_config` falha no banco (teste); payload inválido ou com padrão de injeção é rejeitado na gravação; `change_note` obrigatório.

**TASK-7.6.3 — `PromptResolverService` com cache, pub/sub e fail-safe (Leonardo + Henrique + Victor).**
Promover `resolvePrompt()` a serviço: cache em memória TTL 60s; na publicação, `SET` + `PUBLISH` no Redis para invalidação; API assina o canal e recarrega. **Fallback obrigatório para o default de código** quando: Redis indisponível, config ausente, ou payload que não valida. Logar a queda em fallback como evento observável (não silencioso).
**Conclusão:** publicação passa a valer em ≤60s sem deploy; **teste com Redis derrubado prova que a IA responde com o guardrail compilado, nunca sem guardrail**; fallback emite evento observável.

**TASK-7.6.4 — Propagação do nome da agente para todas as superfícies (Leonardo).**
Substituir as ocorrências fixas do nome em `coach-messages.ts`, `FORA_DE_ESCOPO_RESPONSE`, templates de WhatsApp e prompt por leitura do `PromptResolverService`. Varredura de código para garantir que nenhuma ocorrência literal permaneceu.
**Conclusão:** renomear a agente na config muda o nome em **todas** as superfícies (teste de integração cobrindo prompt + mensagem estática + fora-de-escopo); **0** ocorrências literais do nome restantes na varredura.

**TASK-7.6.5 — Publicação auditada + rollback de 1 clique (Leonardo + Sato).**
Endpoint de publicação sob `AI_CONFIG_WRITE`: insere versão nova, arquiva a anterior, invalida cache e chama `AuditService.append` (quem, quando, versão anterior→nova, `change_note`). Rollback = publicar payload de versão anterior como versão nova (**também auditado, também com `change_note`**) — nunca reabrir/alterar linha antiga.
**Conclusão:** toda publicação e todo rollback aparecem em `audit_logs` com autoria e `change_note`; rollback é 1 chamada; nenhuma linha antiga é alterada.

### Definição de Pronto (US-7.6 "validada")

- [ ] Tasks 7.6.1–7.6.5 concluídas.
- [ ] `agent_config` append-only + Zod + `PromptResolverService` com cache/pub-sub/fail-safe + propagação de nome + publicação e rollback auditados.
- [ ] **Mensurável:** `UPDATE` em `agent_config` falha no nível do banco; com Redis derrubado a resposta da IA **ainda contém** as regras invioláveis (teste de fail-safe); publicação vale em ≤60s; **0** ocorrências literais do nome da agente no código; golden set de conversa **verde** após a refatoração do prompt.
- [ ] **Validada por:** code review + **revisão de Victor** (camadas, schema, fail-safe) + **revisão de Sato** (injeção via painel, auditoria) + testes verdes (US-7.9).

---

## US-7.7 — Painel de IA: edição de persona (L2) e seção de regras invioláveis (L0) em somente-leitura

**Agentes:** Felipe (lead — UI) · Victor (referência/revisão — o que é editável, o que é exibido travado) · Alexandre (valida — texto das justificativas das regras invioláveis) · Sofia (referência — clareza do cadeado e da hierarquia) · Sato (valida — que nenhum campo livre alcança o prompt).
**Depende de:** US-7.6 (backend) + US-7.1 (pilar IA no menu, `AI_CONFIG_READ`/`AI_CONFIG_WRITE`). Dias 5-9.
**Habilita:** todo o roadmap de IA das Sprints 8-11, que reusa esta mesma UI de publicação/histórico/rollback.

### Jornada

Esta é a US onde o pedido *"parametrizar e personalizar o agente sem ficar refém de alterar código-fonte"* vira tela — na faixa em que isso é seguro hoje.

**"Persona & Tom de voz"** é um formulário **sem um único textarea livre que alcance o prompt**: nome (campo curto validado), auto-apresentação (≤200 chars, checada contra `INJECTION_PATTERNS` na gravação), descritores de tom (**seleção múltipla de lista fixa, máximo 4**), política de emoji (ENUM), tratamento (ENUM), limite de caracteres da resposta (faixa). Ao lado do formulário, um **preview do prompt resultante** — o fundador vê exatamente o que a mudança produz antes de publicar. Publicar exige `change_note` e mostra o **diff contra a versão vigente**. Um painel lateral lista o **histórico de versões com rollback de 1 clique**.

**"Regras invioláveis"** é a outra metade, e não é menos importante que a primeira: uma seção **somente-leitura, com cadeado**, listando exatamente o que a IA nunca fará e **por quê** — os guardrails regulatórios (nunca "diagnóstico"/"tratamento"/"cura", nunca "resultado garantido", a IA nunca é apresentada como quem decide sozinha), a segurança clínica (`SAFETY_PATTERNS` — o que dispara handoff SAFETY), a proteção anti-injeção, e os blocos de metodologia que garantem catálogo fechado, segurança e linguagem. Cada item traz **a justificativa em linguagem de negócio** — "isto está travado porque é o que sustenta a supervisão CREF e a defensabilidade jurídica do produto (Alexandre, `06-relatorio-alexandre.md`)" — validada por Alexandre.

Isso responde a uma preocupação legítima do fundador melhor do que um campo editável responderia: ele queria **não ser refém do código**; o que ele precisa é **enxergar e controlar o que é seguro controlar, e enxergar com clareza o que não é e por quê**. Esconder as regras produziria a mesma sensação de opacidade que o motivou a pedir o painel.

Os itens **Conhecimento (RAG)** e **FAQ** aparecem no menu com estado "em breve" e a sprint prevista (10 e 8) — mesmo princípio de honestidade das outras US.

### Objetivo

Ter o pilar IA com edição de persona L2 publicável na hora (com preview, diff, `change_note`, histórico e rollback) e a seção de regras invioláveis L0 em somente-leitura com justificativa.

### Resultado esperado

Um fundador com `AI_CONFIG_WRITE` muda o nome e o tom da agente, vê o preview do prompt e o diff, publica com nota, e a próxima conversa no WhatsApp já responde com a persona nova — sem deploy; ele vê o histórico e volta à versão anterior em 1 clique; e vê, com cadeado, as regras que ninguém muda por painel, cada uma com o motivo escrito. Quem tem só `AI_CONFIG_READ` vê tudo e não consegue publicar (nem pela UI, nem chamando o endpoint).

### Tasks

**TASK-7.7.1 — Formulário de persona por ENUM + preview do prompt (Felipe + Victor).**
Campos da fase 1 exclusivamente por campo curto validado / ENUM / faixa numérica — **nenhum textarea livre que alcance o prompt**. Preview do prompt resultante ao lado, atualizado ao editar. Validação client-side espelhando o Zod do servidor (**o servidor é a autoridade**).
**Conclusão:** formulário renderiza com os 6 campos; preview reflete a edição; valor fora do ENUM/faixa é rejeitado pelo servidor mesmo se forçado.

**TASK-7.7.2 — Publicação com `change_note`, diff e histórico com rollback (Felipe + Leonardo).**
Fluxo de publicar: exige `change_note`, mostra **diff campo a campo** contra a versão vigente, confirma e publica. Painel de histórico listando versões (autor, data, nota, status) com **rollback de 1 clique** (que publica a versão anterior como nova). Estado de "publicado, valendo em até 60s" visível.
**Conclusão:** publicação sem `change_note` é bloqueada; diff exibido antes de confirmar; rollback funciona em 1 clique e gera versão nova auditada.

**TASK-7.7.3 — Seção "Regras invioláveis" somente-leitura com justificativa (Felipe + Victor + Alexandre).**
Renderizar, a partir das constantes de código marcadas na TASK-7.6.1, os blocos L0: guardrails regulatórios, segurança clínica (`SAFETY_PATTERNS`), anti-injeção e blocos de metodologia travados. Cada item com **cadeado, o conteúdo da regra e a justificativa em linguagem de negócio** (texto validado por Alexandre). **Sem nenhum controle de edição na tela** — nem desabilitado: ausente.
**Conclusão:** todos os blocos L0 aparecem com cadeado e justificativa; **0** controles de edição na seção; texto das justificativas validado por Alexandre.

**TASK-7.7.4 — Estados "em breve" de Conhecimento (RAG) e FAQ (Felipe).**
Itens presentes no pilar IA, abrindo tela explicativa: o que vai existir ali, qual a dependência e a sprint prevista (RAG → Sprint 10, com o motivo do gate de revisão do RT CREF; FAQ → Sprint 8).
**Conclusão:** ambos os itens abrem e explicam escopo, dependência e sprint; nenhum controle não-funcional exposto.

**TASK-7.7.5 — Guarda de escrita na UI e no servidor (Felipe + Leonardo + Sato).**
`AI_CONFIG_READ` vê tudo em leitura; publicar/rollback exigem `AI_CONFIG_WRITE` **no endpoint**, não só na UI. Sato valida que nenhum caminho de escrita alcança o prompt sem passar pelo Zod + `INJECTION_PATTERNS`.
**Conclusão:** leitor não publica nem chamando o endpoint direto (`403`); Sato registra a revisão da superfície de injeção.

### Definição de Pronto (US-7.7 "validada")

- [ ] Tasks 7.7.1–7.7.5 concluídas.
- [ ] Persona L2 editável e publicável com preview/diff/`change_note`/histórico/rollback; regras invioláveis L0 visíveis, travadas e justificadas; RAG e FAQ com estado "em breve".
- [ ] **Mensurável:** mudança de persona publicada reflete na conversa em ≤60s **sem deploy**; **0** campos de texto livre alcançando o prompt; **0** controles de edição na seção L0; rollback em 1 clique restaura a versão anterior; leitor recebe `403` no endpoint de publicação.
- [ ] **Validada por:** code review + **revisão de Victor** (o que é editável vs. travado) + **validação de Alexandre** (texto das justificativas L0) + **revisão de Sato** (superfície de injeção) + revisão de Sofia (clareza) + testes verdes (US-7.9).

---

## US-7.8 — Visão Geral: uma linha de resumo por pilar, clicável e sob RBAC

**Agentes:** Felipe (lead) · Sofia (referência — hierarquia e semáforo) · Lucas (referência — o que é a linha-resumo de cada pilar).
**Depende de:** US-7.2, 7.3, 7.4, 7.5 (os pilares precisam ter número). Dias 8-9.
**Habilita:** o hábito diário de uso da plataforma — é a tela que o fundador abre de manhã.

### Jornada

A Visão Geral atual acumulou métricas próprias e virou uma sexta tela concorrendo com os pilares (é onde o heatmap de sazonalidade estava mal alocado). O desenho correto é o oposto: **a Visão Geral não tem métrica própria; ela resume os pilares.** Uma linha por pilar, com **estado (ok / atenção / crítico)**, o número que melhor representa o pilar naquele momento e **um clique que leva direto ao lugar onde se age**. Respeitando RBAC: quem não tem a capability do pilar **não vê a linha** — não vê bloqueada, não vê.

Linhas propostas (a confirmar com o fundador no dia 1):

| Pilar | Linha-resumo | Vira "atenção"/"crítico" quando |
|---|---|---|
| Alunos | alunos ativos · adesão declarada média · **N em risco de cancelamento** | N em risco cresce vs. período anterior |
| Financeiro | MRR atual · **a renovar nos próximos 30 dias** · churn do período | receita em risco 30d acima do limiar |
| Marketing | cadastros iniciados · taxa de conclusão da anamnese | conclusão cai vs. período anterior |
| IA | conversas no período · taxa de validação reprovada · versão de persona vigente | reprovação de validação acima do limiar |
| Sistema | **pior SLO do momento** + error budget consumido | qualquer SLO amarelo/vermelho |

### Objetivo

Ter a Visão Geral como resumo de 5 linhas (uma por pilar), com estado, número-âncora e navegação direta, respeitando RBAC — sem métricas próprias.

### Resultado esperado

O fundador abre a plataforma e sabe em 5 segundos onde precisa olhar hoje; clica na linha e cai exatamente no lugar onde age; um papel restrito vê apenas as linhas dos pilares que acessa.

### Tasks

**TASK-7.8.1 — Linhas-resumo por pilar com semáforo e navegação (Felipe + Lucas ref.).**
Implementar as 5 linhas com estado ok/atenção/crítico, número-âncora e link para o item de menu correspondente. Limiares em constante única e comentada. Migrar/remover as métricas próprias que a Visão Geral acumulou.
**Conclusão:** 5 linhas renderizam com estado e link; nenhuma métrica própria restou na Visão Geral; limiares num único ponto.

**TASK-7.8.2 — RBAC na Visão Geral (Felipe + Leonardo).**
Linha de pilar sem capability **não é renderizada e não é computada no servidor** (não basta esconder na UI — o backend não deve calcular nem enviar).
**Conclusão:** payload da Visão Geral para papel restrito contém apenas as linhas autorizadas (verificado no teste).

### Definição de Pronto (US-7.8 "validada")

- [ ] Tasks 7.8.1–7.8.2 concluídas.
- [ ] Visão Geral com 5 linhas-resumo clicáveis, sem métricas próprias, sob RBAC.
- [ ] **Mensurável:** **0** métricas exclusivas da Visão Geral (todas têm origem num pilar); payload para papel restrito contém **apenas** as linhas autorizadas; cada linha leva a uma rota existente.
- [ ] **Validada por:** code review + revisão de Sofia + teste de RBAC do payload verde (US-7.9).

---

## US-7.9 — QA e segurança da plataforma dos fundadores

**Agentes:** Mariana (lead — testes, cobertura, quality gates) · Sato (revisão de segurança: RBAC/capabilities, dado de saúde, injeção via painel, k-anonimato, auditoria) · Victor (revisão: fail-safe do prompt e não-regressão do golden set).
**Depende de:** US-7.1 a US-7.8. **Alimenta** o CI. Dias 3-10.
**Habilita:** a entrada segura da Sprint 7 em `main` e a base sobre a qual as Sprints 8-11 publicam.

### Jornada

Esta sprint introduz **duas superfícies de risco novas** que não existiam antes. **A primeira é RBAC de dado sensível:** ao separar `STUDENTS_READ` de `STUDENTS_HEALTH_READ` e ao preparar futuras contratações de suporte, criamos a possibilidade concreta de vazamento de dado de saúde para quem não deveria vê-lo — e o teste não pode ser "a UI não mostra", tem que ser **"o servidor não envia"**. **A segunda é configuração de IA publicável por painel:** o golden set em CI protege mudança por PR e **não protege mudança publicada pelo painel** — por isso os testes de fail-safe e de rejeição de injeção na gravação são bloqueantes, e por isso a superfície editável desta sprint foi deliberadamente limitada a ENUM/regex/faixa.

Mariana monta a suíte como **quality gate bloqueante**, cobrindo: capability por papel em UI **e** endpoint; ausência de campo de saúde no payload sem `STUDENTS_HEALTH_READ`; denylist de herança do `ADMIN`; k-anonimato (incluindo supressão complementar); append-only de `agent_config` (falha de `UPDATE` no banco); rejeição de injeção na gravação; **fail-safe do prompt com Redis derrubado**; propagação do nome; auditoria de publicação e rollback; conferência numérica das métricas financeiras contra cálculo manual; e não-regressão do golden set após a refatoração do prompt.

### Objetivo

Cobertura ≥80% do código novo e suíte bloqueante no CI cobrindo RBAC/capabilities, dado de saúde, k-anonimato, append-only e fail-safe da config de IA, injeção via painel, auditoria e conferência numérica — com revisões de Sato e Victor registradas.

### Resultado esperado

O CI reprova qualquer PR que: envie campo de saúde a papel sem `STUDENTS_HEALTH_READ`; deixe `ADMIN` herdar capability da denylist; exiba célula agregada com n < 10; permita `UPDATE` em `agent_config`; deixe a IA responder sem guardrail quando o Redis cai; aceite padrão de injeção na gravação da persona; publique config sem auditoria ou sem `change_note`; quebre o golden set de conversa; ou derrube a cobertura abaixo de 80%.

### Tasks

**TASK-7.9.1 — RBAC, capabilities e dado de saúde (bloqueante) (Mariana + Sato).**
Testes por papel: cada capability nova libera exatamente o previsto e nada além; **payload de API sem `STUDENTS_HEALTH_READ` contém 0 campos de saúde** (asserção sobre o payload, não sobre a renderização); denylist de herança do `ADMIN`; rota padrão por papel; ausência (não desabilitação) de item de menu sem capability.
**Conclusão:** vazamento de campo de saúde plantado falha o pipeline; herança indevida de capability falha o pipeline.

**TASK-7.9.2 — k-anonimato e agregação (bloqueante) (Mariana + Alexandre ref.).**
Base sintética com células pequenas: nenhuma célula com n < 10 é exibida; supressão complementar (não reconstruível por subtração) coberta; sem drill-down para indivíduo a partir do pilar Marketing.
**Conclusão:** célula com n < 10 plantada falha o teste; reconstrução por subtração falha o teste.

**TASK-7.9.3 — Config de IA: append-only, fail-safe, injeção e auditoria (bloqueante) (Mariana + Victor + Sato).**
`UPDATE` em `agent_config` falha no banco; payload inválido/com `INJECTION_PATTERNS` é rejeitado na gravação; **com Redis derrubado, a resposta da IA ainda contém as regras invioláveis** (fail-safe); publicação e rollback aparecem em `audit_logs` com `change_note`; renomear propaga para prompt + mensagens estáticas + fora-de-escopo; **golden set de conversa verde** após a refatoração do prompt (não-regressão).
**Conclusão:** cada um dos 6 cenários falha o pipeline quando violado; Victor registra a revisão de não-regressão.

**TASK-7.9.4 — Conferência numérica das métricas e integração ponta a ponta (Mariana + Leonardo).**
MRR/ARR, custo de IA em R$ e p95 de latência conferidos contra cálculo manual sobre a base de dev (tolerância 0). Integração: login→rota padrão por papel→pilar→drill-down; timeline única de aluno-fixture completo com os 6 tipos de evento em ordem; publicação de persona→efeito na resposta em ≤60s.
**Conclusão:** divergência numérica falha o teste; fluxos de integração verdes local e no CI.

**TASK-7.9.5 — Revisão de segurança de Sato + fecho da sprint (Mariana + Sato).**
Sato registra a revisão consolidada: RBAC e capabilities novas, separação de dado de saúde, superfície de injeção do painel de IA, auditoria de configuração, k-anonimato. Confirmar que **nenhuma escrita em `knowledge_base` foi introduzida** nesta sprint (a role `movivo_app` continua sem INSERT/UPDATE/DELETE ali).
**Conclusão:** revisão de Sato registrada; ausência de escrita em `knowledge_base` verificada por teste.

### Definição de Pronto (US-7.9 "validada")

- [ ] Tasks 7.9.1–7.9.5 concluídas.
- [ ] Gates bloqueantes no CI: RBAC/capabilities, dado de saúde no payload, k-anonimato, append-only, fail-safe do prompt, injeção na gravação, auditoria, conferência numérica, golden set.
- [ ] Cobertura ≥80% do código novo.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de Sato registrada** + **revisão de Victor** (fail-safe e não-regressão) + CI verde.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-7.1 | Capabilities + menu de 5 pilares + rota por papel | **Felipe** | Leonardo (backend/denylist), Sofia (IA visual) | **Sato (RBAC)** + Alexandre (separação de aprovação) + Mariana |
| US-7.2 | Financeiro F1 (renovações, risco, churn, custo de IA) | **Leonardo** | Felipe (telas), Henrique (preço/modelo) | **Eduardo (definições)** + Mariana |
| US-7.3 | Marketing F1 (funil, perfil, sazonalidade) | **Leonardo** | Felipe (telas), Helena (funil) | **Alexandre (k-anonimato)** + Mariana |
| US-7.4 | Alunos F1 (ficha, timeline, adesão, risco) | **Felipe** | Leonardo (agregação/RLS), Sofia (legibilidade) | **Alexandre (dado de saúde)** + Sato + Mariana |
| US-7.5 | Sistema F1 (p95, SLO board, latência, RAG) | **Henrique** | Leonardo (percentis), Felipe (telas), Sofia (didática) | Henrique (SLO) + leitura por não-dev + Mariana |
| US-7.6 | Fundação de IA (`agent_config`, cache, fail-safe) | **Leonardo** | Henrique (pub/sub) | **Victor (camadas/fail-safe)** + **Sato (injeção/auditoria)** + Mariana |
| US-7.7 | Painel de IA (persona L2 + regras L0 travadas) | **Felipe** | Leonardo (endpoints), Sofia (clareza) | **Victor** + **Alexandre (justificativas L0)** + **Sato** + Mariana |
| US-7.8 | Visão Geral como resumo por pilar | **Felipe** | Lucas (linhas-resumo) | Sofia + Mariana |
| US-7.9 | QA + segurança da plataforma | **Mariana** | Leonardo, Victor | Mariana + **Sato** + gate no CI |

> **Distribuição de carga:** **Felipe lidera 4 US** (7.1, 7.4, 7.7, 7.8) — é a sprint mais pesada de frontend do projeto até aqui, o que é coerente: o produto que se está construindo *é* uma interface de decisão. **Leonardo lidera 3** (7.2, 7.3, 7.6), sendo a 7.6 a de maior risco técnico. **Henrique lidera 1** (7.5) e apoia a 7.6. **Victor não escreve código nesta sprint** — ele especifica e revisa (camadas L0/L1/L2, fail-safe, superfície de injeção, não-regressão do golden set); a fatia de IA da Sprint 7 é deliberadamente a fatia sem risco de comportamento de modelo. **Sato tem duas superfícies novas para revisar** (RBAC de dado de saúde e injeção via painel) e é o revisor mais crítico da sprint.

## Critério de conclusão da Sprint 7

A Sprint 7 é **entregue** quando as 9 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. A plataforma navega por **5 pilares de decisão + Visão Geral**, com rota padrão por papel no login e **6 capabilities novas** aplicadas em UI **e** backend; Suporte virou recorte da Base de alunos; **ver aluno e ver saúde do aluno são permissões distintas**; a exceção à herança total do `ADMIN` existe.
2. O **Financeiro** responde quanto entra nos próximos 90 dias, quanto está em risco em 30, por que as pessoas cancelam (`cancelReason`, finalmente lido) e quanto a IA custa por usuário — com o que ainda não existe (lucro, receita recebida) rotulado com dependência e sprint, **nunca como zero**.
3. O **Marketing** mostra onde exatamente se perde gente na anamnese, o perfil agregado do cliente sob k-anonimato e a sazonalidade de cadastro — e declara que origem/CAC dependem de UTM (Sprint 8).
4. **Alunos** entrega a **ficha unificada com timeline cronológica única** (o que antes exigia 4 telas), adesão e evolução declaradas, sinal de qualidade da IA por aluno e risco de cancelamento **explicável pelos sinais que dispararam**.
5. **Sistema** entrega o **p95 real de latência de IA** (sem OpenTelemetry, direto de `aiJobs`), um **SLO board de 3-5 semáforos com error budget** legível por não-engenheiro, latência ponta-a-ponta e uso de RAG.
6. O **painel de IA** permite mudar nome, tom e jeito de falar da agente e **publicar na hora, sem deploy**, com preview, diff, `change_note`, histórico e **rollback de 1 clique** — e mostra, com cadeado e justificativa, as regras que ninguém muda por painel.
7. A **Visão Geral** virou resumo de 5 linhas clicáveis, sem métricas próprias, sob RBAC.
8. **Quality gate** bloqueante: RBAC/capabilities, dado de saúde no payload, k-anonimato, append-only da config, fail-safe do prompt, injeção na gravação, auditoria, conferência numérica, golden set verde. CI verde; cobertura ≥80%; entrega via PR + 6 checks.

### Pré-requisitos / decisões a resolver no início da sprint

- **[Decisão do fundador — dia 1] Confirmar as 5 linhas-resumo da Visão Geral** (US-7.8) e os limiares de "atenção"/"crítico". É a tela que ele abre todo dia; a escolha é dele, não minha.
- **[Decisão do fundador — dia 1] Papéis reais das futuras contratações**: hoje existem `ADMIN`/`PROFESSIONAL`; a matriz propõe `FINANCE`, `MARKETING`, `ENGINEERING`, `SUPPORT`. Confirmar quais criar agora e quais deixar declarados mas inativos.
- **[Decisão de produto — Eduardo] Definições de MRR/ARR e "receita em risco"** (US-7.2): o número do painel precisa ser **o mesmo** número da planilha do CFO, senão a plataforma perde confiança na primeira divergência.
- **[Decisão de produto — Henrique] Os 3 a 5 SLOs e suas metas** (US-7.5): sugestão inicial no texto; a definição final e o cálculo de error budget são dele.
- **[Decisão jurídica — Alexandre] Texto das justificativas das regras invioláveis** (US-7.7): é texto que o fundador vai ler para entender por que a IA é travada — precisa ser correto e defensável, não marketing.
- **[Decisão de IA — Victor] Lista fechada de `toneDescriptors` e `emojiPolicy`** (US-7.6/7.7): o espaço de valores da persona é a superfície de segurança desta sprint; a lista sai dele.
- **[Antecipação para a Sprint 8 — decisão do fundador, começar a pensar agora]** três perguntas que bloqueiam a Sprint 8 e que não têm resposta técnica: **(a)** como o aluno reporta um treino concluído (quick reply no WhatsApp? confirmação dentro do check-in? mensagem livre interpretada?) — define `workout_completions` e destrava a North Star; **(b)** quem lança despesa, com que categorias e com que periodicidade — define `expenses` e destrava "lucro"; **(c)** que estrutura de UTM os anúncios vão usar — define a captura e destrava CAC por canal. **Cada dia sem (c) é histórico de aquisição perdido para sempre.**
- **[Realidade de dev]** chaves reais/ZDR, conta AraraHQ e ratificação clínica do RT CREF continuam sendo bloqueadores de **lançamento**, não de dev; a sprint roda com mocks e seeds.
- **[Marca]** go-live com usuário real permanece condicionado à liberação INPI (MOVIVO × VIVO) — trava herdada.

---

# Backlog priorizado subsequente — Sprints 8 a 11

O que segue **não é descarte**: é o restante integral do pedido do fundador, ordenado por dependência técnica e por risco. Cada sprint abaixo é de 2 semanas, no mesmo formato da Sprint 7, e será detalhada em documento próprio quando for a vez — aqui está o escopo, a justificativa da ordem e o critério de sucesso.

## Sprint 8 — As migrations que destravam o que hoje é "indisponível"

**Tese:** a Sprint 7 organizou e ligou tudo o que já existia. A Sprint 8 grava o que **nunca foi gravado** — e por isso é a sprint que faz a plataforma sair de "descreve o passado" para "responde as perguntas do fundador". **É a sprint de maior valor de negócio das quatro.**

| US | Escopo | Destrava |
|---|---|---|
| **US-8.1** | **`workout_completions`** (userId, protocolId, semana, sessão, data, exercícios feitos, carga, RPE) + **`user_status_transitions`** append-only | **A North Star do produto** ("Treinos Concluídos por Usuário Pago nos primeiros 30 dias") deixa de mostrar "indisponível"; conversão trial→ativo e coortes corretas passam a existir |
| **US-8.2** | Captura de **UTM/atribuição** (`utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `referrer`) em `anamnesisSessions` | Origem de cada aluno. **Prioridade máxima por urgência, não por valor:** cada dia sem isso é histórico de aquisição perdido de forma irrecuperável |
| **US-8.3** | Tabela **`ad_spend`** (canal, campanha, data, valor — lançamento manual) + coorte de aquisição | **CAC por canal, ROAS, LTV/CAC por origem** — a decisão de anúncio que o fundador pediu |
| **US-8.4** | Tabelas **`expenses`** (data, valor, categoria, fornecedor, recorrente, anexo) e **`payments`** + webhook de liquidação do gateway + **`model_pricing`** | **"Lucro" passa a existir** (hoje o sistema só conhece receita); receita **recebida** vs. contratada; custo de IA por tabela editável em vez de constante |
| **US-8.5** | **`partners`** / cap table (sócio, %, vigência — split 20% cada já definido) + distribuição por sócio | **"Ganhos por sócio"**, sobre lucro real da US-8.4 |
| **US-8.6** | **FAQ determinístico**: `faq_entries` (question canônica, variants, answer estático, status, `match_mode` EXACT/SEMANTIC, embedding opcional, `hit_count`), rodando **depois do guardrail clínico e antes do classificador de intenção**; texto validado por `LANGUAGE_RULES` **na gravação** | Perguntas frequentes respondidas **sem chamar LLM** (mais rápido, mais barato, 100% previsível) e o mapa de FAQ que o fundador pediu |
| **US-8.7** | **Guardrails L1 aditivos** (só ação `FLAG`, **nunca `BLOCK`**) + custo de infra/WhatsApp via `expenses` + histórico de incidentes manual (gera uptime real) | Primeira configuração L1 segura sem simulador, porque `FLAG` não altera o que a IA responde — só marca |

**Critério de sucesso:** North Star exibindo número real quando existe ao menos 1 `workout_completion`; "lucro" e "ganhos por sócio" com número real; CAC por canal calculável para todo aluno cadastrado após a US-8.2; FAQ respondendo sem consumir token de LLM.

## Sprint 9 — Simulador de configuração de IA (pré-condição de tudo que é L1)

**Tese:** a partir daqui, toda configuração de IA **altera o que a IA responde para todos os alunos ao mesmo tempo**. Sem simulador, publicar pelo painel contorna todo o aparato de segurança já construído (golden set, ValidationService, guardrails) — **o simulador é a peça que estende esse aparato ao painel**, e por isso vem antes de qualquer L1 substantivo.

Escopo, em 4 etapas (reusando as fixtures do golden set que **já existem** — é o que torna esta sprint barata):
1. **Golden set determinístico como gate rígido**, parametrizado pela config candidata: falhou, **não publica**. Sem override.
2. **Lote de conversas reais anonimizadas** rodando config atual vs. candidata, em **diff lado a lado**.
3. **Chat ao vivo isolado** com a config candidata (não afeta nenhum aluno).
4. **Para metodologia/motor:** gerar protocolos-fixture com a config candidata e rodar o `ValidationService`.

Segue no mesmo pacote: **parâmetros numéricos do motor editáveis** (`SETS_RANGE`, `REST_SECONDS_RANGE`, `REPS_RANGE_BY_GOAL`, `SPLITS_BY_LEVEL`, `MAX_TECHNIQUES_PER_SESSION`) **dentro de envelope de segurança fixo em código** — o painel move o valor dentro da faixa, nunca a faixa.

**Critério de sucesso:** nenhuma publicação L1 é possível sem passar pelo simulador; config candidata que quebra o golden set é bloqueada; rollback continua sendo 1 clique sem re-teste (a config é append-only).

## Sprint 10 — Conhecimento da IA (RAG com curadoria) — épico próprio, alto risco

**Tese:** é o item de **maior risco do roadmap inteiro**. `knowledge_base` hoje é uma sacola plana de chunks, sem documento-pai nem status de aprovação, e **documento de RAG não tem RLS por titular** — PII vazada ali é grave e alcança qualquer aluno. A role `movivo_app` teve INSERT/UPDATE/DELETE **revogados** nessa tabela de propósito (anti RAG-poisoning); o upload **não pode** escrever pelo caminho HTTP.

Fluxo: **upload → extração de texto → preview de chunks (sem gerar embedding ainda — é onde 80% dos problemas aparecem a olho nu) → metadados → varredura de PII obrigatória (reusa `pii-scrubber.ts`) → gate de revisão humana do RT CREF com revisor ≠ uploader → indexação assíncrona por worker com role de banco separada (`movivo_indexer`, a única com INSERT em `knowledge_base`) → ativação**.

Schema: tabela nova `knowledge_documents` (documento-pai com status/versão/aprovação) + colunas `documentId`/`isActive` em `knowledge_base` + filtro `WHERE is_active` no `RagService`. Capabilities `AI_KNOWLEDGE_WRITE` e `AI_KNOWLEDGE_APPROVE` (esta **fora da herança do `ADMIN`** — mecanismo já construído na TASK-7.1.2).

**Critério de sucesso:** nenhum chunk chega ao `RagService` sem aprovação de um `PROFESSIONAL` diferente do uploader; o caminho HTTP continua sem permissão de escrita em `knowledge_base`; documento com PII detectada é bloqueado antes da indexação; desativar um documento remove seu efeito da recuperação imediatamente.

## Sprint 11 — Metodologia editável, handoff configurável, projeção financeira e LGPD

**Tese:** o que depende de tudo o anterior estar de pé e rodando por pelo menos um ciclo.

- **Metodologia editável em blocos** (L1, aprovação do RT via `AI_METHODOLOGY_APPROVE`, simulador obrigatório) — **exceto os 3 blocos L0** que garantem catálogo fechado, segurança e linguagem, que permanecem travados. É artefato jurídico-profissional assinado pelo RT, não "config".
- **Regras de handoff configuráveis** — hoje são 4 ifs em `ai-response.worker.ts`; depende da fila operacional de `handoff_alerts` estar amadurecida.
- **Motor de projeção financeira com cenários (pessimista / base / otimista)** — a "previsão de lucro" completa que o fundador pediu, agora sobre série histórica real de despesa e liquidação (Sprint 8), não sobre chute.
- **Workflow de solicitação LGPD do titular** (acesso, correção, exclusão, portabilidade) — obrigação legal apontada por Alexandre, sem tela até hoje. **Bloqueador de go-live.**
- **Comparativo agregado de metodologia** (aderência e evolução por tipo de protocolo) — o "refinar metodologia" do pedido, que só é honesto depois que `workout_completions` tiver histórico.
- **Construtor de UTM na UI** e, se o volume justificar, **integração com a Meta Ads API**.

---

## Fontes Consultadas

**Declaração de limitação metodológica, explícita conforme meus princípios:** **nenhuma pesquisa web (`WebSearch`/`WebFetch`) foi executada para produzir este documento.** Isto é planejamento de execução derivado de discovery já realizado nesta sessão sobre o código e o schema reais do repositório — não é pesquisa de mercado, benchmark de concorrente nem validação de hipótese de negócio. Onde haveria valor em benchmark externo (por exemplo: formatos de SLO board didático em painéis de produto, padrões de UI para configuração de agentes de IA em SaaS, benchmarks de taxa de conclusão de onboarding em 3 etapas), **isso não foi feito e deve ser considerado uma lacuna deste documento**, a ser suprida antes de decisões de design fino nas US-7.5, 7.7 e 7.3.

**Fontes primárias (internas, desta sessão):**

1. **Relatório de Information Architecture do dashboard** — Lucas Monteiro (PM/PO), primeira rodada de discovery desta sessão: diagnóstico do menu atual, proposta dos 5 pilares, faseamento F1/F2/F3 por eixo (Financeiro, Marketing, Alunos, Sistema), capabilities novas, papel da Visão Geral.
2. **Especificação do Painel de IA** — Victor (Distinguished AI Engineer), segunda rodada de discovery desta sessão: modelo de 3 camadas (L0/L1/L2), estado real do código de prompts/guardrails/metodologia/RAG, mecanismo de `agent_config` append-only, FAQ determinístico, simulador como pré-condição de L1, fluxo de curadoria de RAG, capabilities de IA.

**Fontes secundárias (documentos do repositório, consultados como restrição):** `sprint/sprint-5-checkin-e-dashboard-cref.md` (padrão estrutural deste documento; base de auth/RLS/auditoria) · `docs/arquitetura/ARQUITETURA.md` · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (LGPD, dado de saúde Art. 11, k-anonimato, separação de aprovação clínica) · `07-relatorio-eduardo.md` (pricing R$39/R$99/R$349, unit economics, custo de IA) · `05-relatorio-helena.md` (funil, CAC) · `08-relatorio-lucas.md` (North Star, escopo de MVP) · `09-relatorio-sofia.md` (§13 guardrails de linguagem) · `11-relatorio-sato.md` (RBAC/RLS, anti-poisoning) · `12-relatorio-victor.md` (ValidationService, golden set, ADR-005-R) · `CLAUDE.md` (guardrails de linguagem inegociáveis, split societário, North Star).

---

*Documento de planejamento operacional da Sprint 7 — Lucas Monteiro (PM/PO). **Divergência declarada do pedido literal do fundador:** ele pediu "uma Sprint 7 completa onde iremos implementar completamente todas essas fases"; minha recomendação como PM é dividir em 4 ondas (Sprints 7-10, com uma 11), pelas razões factuais expostas na seção "Decisão de escopo" — 8 tabelas novas, um subsistema de curadoria de RAG com gate de revisão humana e um simulador que é pré-condição de segurança não cabem em 10 dias úteis com 3 devs sem serem entregues mal, e "mal" aqui significa IA respondendo com base em documento não revisado por profissional CREF e decisão de distribuição de lucro sobre número inventado. **Nada foi cortado: todo o pedido está neste documento, com dono, ordem e critério de sucesso.** A Sprint 7 entrega a arquitetura de informação nova (5 pilares), todas as métricas extraíveis sem migration (incluindo o calendário de renovação de 90 dias, a timeline única do aluno e o p95 real de latência de IA) e a fundação do painel de IA (persona editável por ENUM + regras invioláveis visíveis e travadas). A decisão final sobre a divisão é do fundador — se ele determinar a sprint única, eu executo; mas o registro da minha recomendação fica aqui.*
