# Sprint 2 — Pipeline de Geração e Entrega do Protocolo (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-07-27
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 2)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + Engenheiro de IA (Victor) + QA (Mariana), com revisão de segurança de IA de Sato e validação clínico-jurídica de Alexandre
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§3.1 ADR-005-R, §5 arquitetura híbrida, §6 filas, §8 segurança/RLS, §10 roadmap Sprint 2, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/12-relatorio-victor.md` (LLMRouter §1, ContextService §2, ValidationService/PII Scrubber §5, guardrails §7, custo §8, avaliação §6, ondas §11) · `docs/fitness-ia-whatsapp/10-relatorio-rafael.md` (Motor Determinístico §5.2, fluxo ProtocolGeneration §3.4, DDL `protocols`/`protocol_versions`, contratos REST §§1173-1176) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` (§5 boundary LLM/PII scrubber, §9.4 anti-abuso LLM10, §10 guardrails/prompt injection, red-team no CI) · `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (§10-11 UX de entrega, persona MOVI, quebra de mensagens, §13 termos proibidos) · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (Épico 3 entrega do protocolo, escopo AI Coach, North Star, teto de custo) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (supervisão CREF, gate PAR-Q) · `docs/fitness-ia-whatsapp/07-relatorio-eduardo.md` (teto de custo de IA por usuário/mês)

---

## Como ler este documento

Hierarquia: **Épico → User Stories (US-2.x) → Tasks (TASK-2.x.y)**.

- Cada **User Story** declara: jornada (o que se constrói e por quê), objetivo, resultado esperado, agentes participantes e ordem, dependências e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD (code review, teste automatizado verde, quality gate de IA de Mariana/Victor, revisão de segurança de IA de Sato, validação clínico-jurídica de Alexandre etc.).
- Esta é a **única** sprint planejada agora. As Sprints 3-6 serão planejadas depois, com o aprendizado desta. A Sprint 1 entregou a **porta de entrada** (anamnese → `SUBMITTED`); **a Sprint 2 entrega o núcleo de valor do produto**: transformar a anamnese em **protocolo de treino gerado e entregue no WhatsApp em ≤2h**. É a primeira sprint com **IA em produção** (Victor entra agora) e a primeira que faz **inferência sobre dado de saúde** — o que torna o boundary de LLM (PII Scrubber + provedor ZDR), a validação de compliance CREF e o princípio **"a IA planeja o treino sob a metodologia do RT CREF; um validador determinístico veta o inseguro; o RT assina a metodologia e o painel aprova"** **requisitos bloqueantes**, não recomendações.

> **Decisão de produto do fundador (coração desta sprint):** o **Motor Determinístico puro foi rejeitado**. A premissa da MOVIVO é personalização/individualização/acompanhamento próximo — dois usuários com a mesma anamnese podem legitimamente receber treinos diferentes, então "mesma entrada → mesma saída" contradiz o produto. O modelo adotado é **"gera-e-valida" (modelo B)**: **(1) a IA monta o protocolo completo** (exercícios, carga, volume, periodização), com autonomia e conhecimento para planejar, otimizar e "enxergar" o melhor para o usuário — indo além de aplicar regras fixas — **(2) sempre dentro de trilhos**: a **metodologia do educador CREF** (o treinador do Cahuã, RT) e **referências científicas** (papers — slot preparado no MVP, ainda inexistentes, não bloqueiam); **(3)** a **base de referência continua existindo** (padrão de movimento, grupos musculares, equipamentos, local, nível, contraindicações), mas muda de papel: vira **contexto que a IA consulta** e **gabarito que o validador determinístico usa** para vetar saída insegura; **(4)** o **`ValidationService`** ganha poder de veto sobre o **treino inteiro** (não só o texto) — carga fora de faixa, exercício contraindicado por lesão/PAR-Q, exercício inexistente na base, termo proibido → fallback de modelo → template; **a segurança do produto agora mora aqui**; **(5)** todos os protocolos são roteados ao **painel/dashboard profissional** do RT CREF: **sem risco mapeado → aprovado automaticamente** e entregue (edição manual do profissional é Sprint 5); PAR-Q de risco continua `BLOQUEADO_AGUARDANDO_CLEARANCE` para liberação humana (Sprint 5). Modelo jurídico: o RT **assina a metodologia**, não cada treino — pendente validação formal de Alexandre para o lançamento (não bloqueia dev local).

### Base já entregue pela Sprint 1 (não reconstruir — consumir)

- **Fundação de segurança de dado sensível:** RLS `FORCE ROW LEVEL SECURITY` com `SET LOCAL app.current_user_id` por transação (`runAsUser`/token-scoped no `DatabaseModule`), cifra `pgcrypto` de `anamnesis_sessions.data_block_2` (chave via `PGCRYPTO_KEY_FILE`), isolamento multi-tenant **bloqueante** no CI. A Sprint 2 **estende** esses controles às novas tabelas (`protocols`, `protocol_versions`, `ai_jobs`), sem reconstruí-los.
- **ANAMNESIS + CONSENT + gate PAR-Q:** anamnese conversacional em 3 blocos com salvamento/retomada por token; consentimento LGPD granular versionado; **gate PAR-Q bloqueante** que marca `users.requires_professional_review=true` e coloca a sessão em `BLOQUEADO_AGUARDANDO_CLEARANCE`. No submit, o `users` nasce `ONBOARDING` e a `anamnesis_session` fica `SUBMITTED` com `data_block_2` cifrado. **Este é o gatilho de entrada da Sprint 2.**
- **AUTH JWT RS256 + refresh rotation + RBAC** (`USER`/`PROFESSIONAL`/`ADMIN`): a Sprint 2 consome o RBAC para o carimbo/assinatura do protocolo pelo `PROFESSIONAL` (o RT CREF).
- **Fundação BullMQ (US-1.7):** as 5 filas de §6 já **registradas** (`protocol-generation`, `ai-response`, `whatsapp-outbound`, `checkin-weekly`, `conversion-sequence`) com seus parâmetros, `WorkerFactory`, DLQ handler genérico e drenagem graciosa. A Sprint 2 **preenche os processadores** de `protocol-generation` e `whatsapp-outbound` — não reconstrói a infraestrutura de filas.
- **PGVector disponível** (extensão criada na Sprint 0). A **indexação do corpus RAG de papers é Sprint 3** — nesta sprint a base de referência (catálogo/metodologia) é injetada na IA como **contexto estruturado no prompt**, não via retrieval vetorial, então o PGVector segue ocioso para o núcleo de geração.
- **Módulos de domínio já registrados (esqueleto):** `ProtocolModule`, `WhatsappModule`, `AiCoachModule`, `JobsModule`. Esta sprint preenche `ProtocolModule` (geração por IA + validador + Worker + persistência), a camada de IA dentro de `AiCoachModule`/serviço compartilhado (`LLMRouter`, `ValidationService`, `PIIScrubber`) e o **outbound** de `WhatsappModule`.
- **CI/CD:** 6 jobs obrigatórios, **branch protection ativa** — nada entra em `main` sem PR + 6 checks verdes. Quality gate ≥80% de cobertura. O gate reservado desde a Sprint 0 como **"100% no Motor Determinístico"** **é migrado** (o motor deixou de existir como decisor): passa a ser **"100% de cobertura do `ValidationService`"** (a nova peça crítica de segurança) + o **AI eval bloqueante** (faithfulness à base/metodologia, safety adversarial, ausência de termo/exercício proibido) — ver US-2.3 e US-2.7.

### Regras inegociáveis que valem nesta sprint (de `ARQUITETURA.md` §12, `12-victor`, `11-sato`)

1. **A IA planeja o treino sob trilhos; o inseguro é vetado por código determinístico** — a IA monta o protocolo completo (exercícios, carga, volume, periodização) **respeitando a metodologia do RT CREF e a base de referência**, e o **`ValidationService` determinístico tem poder de veto sobre o treino inteiro** (não só o texto): rejeita carga fora de faixa, exercício contraindicado por lesão/PAR-Q, exercício inexistente na base ou termo proibido → fallback de modelo → template pré-aprovado. Nenhuma saída não-validada é persistida ou enviada. A supervisão CREF é preservada: **o RT assina a metodologia, o painel aprova o protocolo** (§12.4/§12.5, Sato §10.1, Victor).
2. **O `ValidationService` exige 100% de cobertura de teste** antes de merge (migrado do antigo gate do Motor, §12.8) — vira **gate bloqueante** nesta sprint, pois é onde a segurança do produto passa a morar. TypeScript puro/determinístico, sem chamada externa, versionado semver. A qualidade da geração por IA é coberta pelo **AI eval** (US-2.7), não por cobertura de linha.
3. **GPT-4.1 (OpenAI) principal → Claude Sonnet 4.5 (Anthropic) fallback**, ambos com **Zero Data Retention + DPA/SCC + no-training** (ADR-005-R). **DeepSeek é proibido** em qualquer caminho. SDK de OpenAI/Anthropic **só** dentro do `LLMRouter` — nenhum outro módulo importa SDK de provedor.
4. **PII Scrubber inescapável antes de toda chamada LLM** (Sato §5.2, Victor §5.1): nenhum identificador direto (nome, telefone, e-mail, CPF, nascimento, terceiros) vai ao LLM; o snapshot logado (`ai_jobs.input_snapshot`) é sempre pseudonimizado. Roteamento por **classe de dado** com fail-safe `default = HEALTH`.
5. **ValidationService pós-geração bloqueante sobre o treino inteiro** (Victor §5.2, Rafael §3.4): valida o protocolo gerado pela IA em duas camadas — **estrutura** (carga/volume em faixa plausível, exercício existente na base, sem exercício contraindicado por lesão/PAR-Q) e **linguagem** (sem diagnóstico/prescrição/promessa, consistência com PAR-Q, anti-leak de system prompt/dado de outro usuário). Falha → fallback de modelo → template pré-aprovado + `human_review_required=true`; nunca persiste/envia saída não-validada.
6. **Guardrails de linguagem** em toda copy, prompt e texto gerado: nunca "diagnóstico", "tratamento", "cura", "resultado garantido"; a IA/o produto nunca decide sozinho — sempre "profissional CREF, usando IA como ferramenta"; presença do CREF sempre visível (Sofia §13, Gabriel/Clóvis).
7. **Sessão com PAR-Q de risco NÃO gera protocolo automático** (Alexandre BLOQUEADOR / §5): `BLOQUEADO_AGUARDANDO_CLEARANCE` é uma trava — o Worker **pula** essas sessões e as deixa aguardando o fluxo de liberação (Dashboard CREF, Sprint 5).
8. **Anti-abuso de LLM (LLM10 — Unbounded Consumption, Sato §9.4):** `max_tokens` teto por chamada, `budget alert` por usuário/dia, circuit breaker <2s. Chaves de API de LLM via Docker Secrets (local) / GitHub Secrets (CI), **nunca** em `environment:`.
9. **Entrega WhatsApp é OUTBOUND-only nesta sprint** — via fila `whatsapp-outbound` (rate limit 80 msg/s, idempotência por chave de negócio). O **webhook de entrada e a conversa contínua do AI Coach são Sprint 3**.
10. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI; cobertura ≥80% (100% no `ValidationService`); AI eval (faithfulness/safety), isolamento multi-tenant e safety suite adversarial **bloqueantes**. Nenhum push direto.

---

# ÉPICO 2 — Pipeline de Geração e Entrega do Protocolo

### Descrição

Entregar o **núcleo de valor da MOVIVO**: pegar uma `anamnesis_session` em `SUBMITTED` (com PAR-Q liberado) e produzir, de forma assíncrona e em ≤2h, um **protocolo de treino individualizado, seguro e supervisionado por CREF**, entregue no WhatsApp. O pipeline segue o modelo **"gera-e-valida"** com quatro camadas construídas nesta sprint: (1) a **geração por IA guiada** (`LLMRouter` + prompt de metodologia CREF + base de referência como contexto) — a IA monta o protocolo completo (exercícios, carga, volume, periodização) com autonomia para planejar e otimizar **dentro dos trilhos** da metodologia do RT e da base; (2) o **LLMRouter** (GPT-4.1→Claude, ZDR, circuit breaker, teto de tokens, prompt caching, logging) com o **PII Scrubber** no boundary; (3) o **ValidationService** — a **pedra angular de segurança** do novo desenho — que veta o **treino inteiro** fora do escopo seguro (carga fora de faixa, exercício contraindicado por lesão/PAR-Q, exercício inexistente na base, termo proibido) com fallback de modelo → template, e onde vive também o scrubber de prompt injection agora implementado de verdade; e (4) o **ProtocolGenerationWorker** sobre a fila `protocol-generation`, que orquestra geração-IA→Validação→roteamento/auto-aprovação→persistência→entrega, respeitando o gate PAR-Q. Todos os protocolos são **roteados ao painel do RT CREF**: sem risco mapeado → **auto-aprovados** e entregues; PAR-Q de risco → `BLOQUEADO_AGUARDANDO_CLEARANCE`. A entrega usa o **outbound AraraHQ** (confirmação imediata que a Sprint 1 deixou pendente + o protocolo). Fecha com um **quality gate de IA no CI** (faithfulness à base/metodologia, safety adversarial, ausência de termo/exercício proibido) e a revisão de segurança de IA de Sato.

### Objetivo

Ao final da Sprint 2, um usuário do perfil do Cahuã que concluiu a anamnese **sem flags de PAR-Q** recebe, em ≤2h, uma **confirmação imediata** e depois o **protocolo de treino** no WhatsApp — **planejado por IA sob a metodologia do RT CREF e a base de referência**, gerado por um LLM LGPD-safe, **validado pelo `ValidationService` que veta o treino inteiro inseguro**, roteado ao painel do RT e **auto-aprovado** por não ter risco mapeado, persistido com o selo/assinatura do RT CREF em nível de metodologia, e legível também numa página web read-only. Usuários **com** flag de PAR-Q **não** têm protocolo gerado automaticamente: ficam `BLOQUEADO_AGUARDANDO_CLEARANCE`, aguardando o fluxo de liberação profissional (Sprint 5). A **conversa contínua** com o AI Coach (responder dúvidas, substituir exercício por mensagem, memória de 3 camadas, RAG) é a Sprint 3 — esta sprint entrega o **primeiro contato** (protocolo entregue), não o diálogo recorrente.

### Resultado esperado do épico

- **Geração de protocolo por IA guiada** (`ProtocolModule`): a IA monta o `ProtocolStructure` (JSON tipado) completo — exercícios, carga, volume, periodização — a partir das constraints da anamnese, sob a metodologia do RT CREF e a base de referência injetada como contexto; a **base de referência** (catálogo com padrão de movimento, grupos musculares, equipamentos, local, nível, contraindicações, substitutos) existe e é (i) contexto da IA e (ii) gabarito do validador.
- **LLMRouter** com cascata GPT-4.1→Claude Sonnet 4.5 (ZDR), circuit breaker <2s, `max_tokens` teto, prompt caching, roteamento por `dataClass` (default `HEALTH`), e logging completo em `ai_jobs` (provider, model, tokens in/out/cached, latência, custo BRL, `data_class`, `validation_action`).
- **PII Scrubber** inescapável no boundary de entrada; snapshot logado sempre pseudonimizado; SDK de provedor confinado ao `LLMRouter`.
- **ValidationService** (pedra angular de segurança, **100% de cobertura** bloqueante no CI) vetando o **treino inteiro**: carga fora de faixa, exercício contraindicado por lesão/PAR-Q, exercício inexistente na base, diagnóstico/prescrição/promessa/violação-PAR-Q/leak; fallback de modelo → template pré-aprovado; scrubber de prompt injection (baseline da US-1.8) implementado e testado.
- **ProtocolGenerationWorker** sobre a fila `protocol-generation`: producer no submit (US-1.3) + processor real (gerar→validar→rotear/auto-aprovar); persiste `protocols` (v1, com `content` JSONB, `constraints` imutável, `par_q_flags`, `approval_status`, `generated_by='GPT_4_1'` + versão de modelo/prompt) e `protocol_versions`; respeita o gate PAR-Q; DLQ com fallback.
- **Entrega outbound AraraHQ:** confirmação imediata no submit + entrega do protocolo formatado (mensagens curtas com persona MOVI, quebra em bolhas), via fila `whatsapp-outbound`, idempotente, dentro do SLA ≤2h para 95%.
- **Página web read-only do protocolo** (deep-link do WhatsApp), acessível por token, mobile-first, dentro dos guardrails e com o selo CREF visível.
- **Quality gate de IA no CI:** golden set de faithfulness/accuracy (fidelidade à base/metodologia) + suite adversarial (prompt injection/jailbreak/extração de PII/leak/exercício proibido) **bloqueante**; 100% do `ValidationService`; isolamento multi-tenant do contexto de IA.
- CI verde; cobertura ≥80% (100% no `ValidationService`); revisão de segurança de IA de Sato registrada; custo de IA medido dentro do teto (~R$1,08/usuário/mês, ≤15% do ARPU).

### Não-escopo desta sprint (para não haver ambiguidade)

A fronteira da Sprint 2 é **"protocolo gerado e entregue com segurança"** — o **primeiro contato**, não o diálogo recorrente. Ficam **explicitamente fora**:

- **AI Coach conversacional contínuo (Sprint 3):** `WebhookController` de entrada (HMAC + debounce + lock + replay protection), `AIResponseWorker`, `ContextService` de 3 camadas (working/episodic/semantic), `IntentClassifier`, **indexação do corpus RAG em PGVector** e `RAGService`. Nesta sprint o LLM só é chamado no momento da **geração** do protocolo (batch), não em resposta a mensagem do usuário. O outbound entrega; **não há inbound**.
- **Dashboard CREF (Sprint 5):** a **UI** de fila de protocolos, a **edição manual do protocolo pelo profissional**, a assinatura per-usuário, e o **fluxo de liberação das sessões `BLOQUEADO_AGUARDANDO_CLEARANCE`** (PAR-Q de risco). Nesta sprint, todos os protocolos **nascem já roteados ao painel com um `approval_status`** — sem risco mapeado → `AUTO_APPROVED` e entregue; com flag PAR-Q → `BLOCKED_PENDING_CLEARANCE` — e o protocolo sem flag carrega o **selo/assinatura do RT CREF em nível de metodologia** (o RT aprovou a metodologia/base/templates — ver decisão em US-2.4). O *status* de aprovação nasce aqui; a **tela do painel, a edição manual e o tratamento das exceções** ficam para a Sprint 5.
- **Pagamento e conversão (Sprint 4):** `SUBSCRIPTION` (Stripe/Asaas), `ConversionSequenceWorker` (d7/10/13/14), webhooks de pagamento.
- **Check-in semanal (Sprint 5):** `CheckinWeeklyWorker` + cron + ajuste de protocolo pós-check-in.
- **Dashboard dedicado ao usuário final, app mobile, wearables, gamificação (Fase 2 do produto).** A página web read-only de US-2.6 é uma **visualização única do protocolo**, não um dashboard.
- **RAG/hybrid search/re-ranker self-hosted, fine-tuning, sumarização de sessão longa (Sprint 3/Fase 2).** O reranker `bge-reranker` de Victor só é necessário quando o RAG entrar (Sprint 3).

### Mapa de dependências entre User Stories

```
US-2.1 (Geração por IA guiada: metodologia CREF + base de referência · Victor+Leonardo) ─┐
US-2.2 (LLMRouter + PII Scrubber · Victor, valida Sato) ──────────┐                       │
US-2.3 (ValidationService: veta o treino inteiro + scrubber prompt-injection · Victor+Sato)│
        └── depende de US-2.2 (roda na saída do LLMRouter) · 100% coverage (gate migrado)  │
US-2.4 (ProtocolGenerationWorker + roteamento/auto-aprovação · Leonardo, C Victor) ────────┤
        └── depende de US-2.1 (geração-IA) + US-2.2 (LLM) + US-2.3 (validação)             │
            + US-1.7 (fila protocol-generation) + US-1.3 (submit gatilho)                  │
US-2.5 (Entrega outbound AraraHQ · Leonardo+Henrique) ── depende de US-2.4                 │
US-2.6 (Frontend: página read-only do protocolo · Felipe) ── consome persistência de US-2.4
US-2.7 (QA + AI eval + segurança de IA · Mariana+Victor+Sato) ── valida US-2.1 a US-2.6
```

**Sequência prática recomendada (10 dias úteis):** **US-2.1 (geração por IA guiada) e US-2.2 (LLMRouter) começam no dia 1 em paralelo** — são as duas fundações independentes (Victor lidera ambas; Leonardo pareia na base de referência, na persistência e no prompt de metodologia). US-2.3 (ValidationService — a pedra angular) dias 3-6, sobre o LLMRouter, já com a meta de 100% de cobertura. US-2.4 (Worker + roteamento/auto-aprovação) dias 4-8, consumindo geração-IA+LLM+Validação à medida que estabilizam. US-2.5 (entrega AraraHQ) dias 6-9. US-2.6 (frontend) dias 5-9, com mocks e integrando na persistência real. US-2.7 (QA + AI eval + segurança) corre do dia 3 ao 10, fechando a sprint — a suite adversarial e o gate de 100% do `ValidationService` são construídos em paralelo ao código que protegem.

---

## US-2.1 — Geração de protocolo por IA guiada por metodologia CREF + base de referência (gera-e-valida)

**Agentes:** Victor (lead — desenha o prompt de geração, a metodologia como trilho, a base de referência como contexto e o formato do `ProtocolStructure`) · Leonardo (co-implementa a base de referência, a persistência do `ProtocolStructure` e integra ao `ProtocolModule`) · Alexandre/RT CREF (validam que a metodologia, a base de exercícios e as contraindicações respeitam o escopo CREF-safe — o RT é quem **assina a metodologia**).
**Depende de:** Sprint 1 (`anamnesis_sessions.data_block_2` cifrado com constraints/PAR-Q; `users.requires_professional_review`) e US-2.2 (a geração usa o `LLMRouter`). É uma das **duas US que começam no dia 1** (a base de referência e o desenho do prompt não dependem do router pronto).
**Habilita:** US-2.4 (o Worker chama a geração-IA como primeiro passo) e US-2.3 (o validador usa a base de referência como gabarito).

### Jornada

Aqui vive a **decisão do fundador**: o protocolo é **planejado pela IA**, não montado por um motor determinístico. A premissa da MOVIVO é individualização — a IA precisa ter **autonomia e conhecimento para planejar, otimizar e "enxergar" o que é melhor para o usuário**, indo além de aplicar regras fixas; dois usuários com a mesma anamnese podem legitimamente receber treinos diferentes. Mas autonomia **dentro de trilhos**: (a) a **metodologia do educador CREF** (o treinador do Cahuã, RT) entra no prompt como diretriz obrigatória de como a MOVIVO treina; (b) **referências científicas** (papers) — slot de contexto preparado no MVP, ainda inexistentes, não bloqueiam a geração; (c) a **base de referência** — catálogo de exercícios por padrão de movimento, grupo muscular, equipamento, local (casa/academia), nível, contraindicações e substitutos — deixa de "escolher o treino" e passa a ser **contexto que a IA consulta** para não inventar exercício/carga fora do vocabulário aprovado, e **gabarito que o validador (US-2.3) usa** para vetar o inseguro. A segurança não mora mais em "o motor decide"; mora no **`ValidationService` (US-2.3)** que veta o treino inteiro. Victor desenha o prompt de metodologia + o schema tipado de saída (`ProtocolStructure`), Leonardo cataloga a base de referência com o RT. Como a geração é um componente de IA, o antigo gate de "100% de cobertura" **não se aplica a ela** — migra para o validador (US-2.3) e para o AI eval (US-2.7).

### Objetivo

Ter uma geração de protocolo por IA que, dado o perfil da anamnese (objetivo, nível, equipamento, local, disponibilidade, lesões, PAR-Q), produz um `ProtocolStructure` (JSON tipado) individualizado, **sob a metodologia do RT CREF e restrito ao vocabulário da base de referência** — pronto para ser vetado pelo validador antes de qualquer persistência/envio.

### Resultado esperado

`generateProtocol(constraints)` retorna um `ProtocolStructure` tipado, coerente com objetivo/nível/equipamento/local e alinhado à metodologia; a **base de referência** existe versionada e é consumida pela IA como contexto e pelo validador como gabarito; a fidelidade da geração à base/metodologia é medida pelo AI eval (US-2.7), não por cobertura de linha; um exercício fora da base ou uma carga fora de faixa é responsabilidade do validador (US-2.3) rejeitar.

### Tasks

**TASK-2.1.1 — Base de referência de exercícios catalogada (Leonardo + Alexandre/RT CREF).**
Modelar o catálogo de exercícios (seed versionado, TypeScript/JSON) com, por exercício: padrão de movimento, grupo(s) muscular(es), **equipamento necessário**, **local compatível** (casa/academia/ambos), nível mínimo, contraindicações (mapeamento para flags de lesão/PAR-Q) e **lista de substitutos** dentro do mesmo padrão. Este catálogo tem duplo papel: **contexto injetado no prompt** (a IA só deve usar exercícios existentes nele) e **gabarito do validador** (US-2.3). O RT CREF valida que o catálogo e as contraindicações são clinicamente corretos e ficam dentro do escopo CREF-safe (o RT é quem **assina a metodologia** — insumo da supervisão exigida por Alexandre). Escopo do MVP: cobertura suficiente para os objetivos do ICP (perder peso / ganhar massa / condicionamento) em casa e academia — não o catálogo universal.
**Conclusão:** catálogo versionado no repo; cada exercício tem equipamento/local/contraindicações/substitutos; RT CREF aprova por escrito (comentário no PR); nenhum dado clínico inventado.

**TASK-2.1.2 — Prompt de geração: metodologia CREF como trilho + schema tipado de saída (Victor).**
Desenhar o prompt de geração que instrui a IA a **planejar o protocolo completo** (seleção de exercícios, volume semanal por frequência/disponibilidade, periodização `ADAPTACAO`→`HIPERTROFIA`→`FORCA`→`DELOAD`, dupla progressão rep→carga) com autonomia para individualizar, **respeitando a metodologia do RT CREF** (diretrizes no prefixo estável do prompt) e **restrito ao vocabulário da base de referência** (TASK-2.1.1). Saída em **JSON estruturado tipado** (`ProtocolStructure` — reaproveita os tipos de domínio de Rafael §5.2: `LoadMatrix`, `RepsRange`, `WeightStrategy`, `TrainingPhase`) via structured output / function calling, para ser validável mecanicamente. Deixar o **slot de referências científicas** preparado no contexto (vazio no MVP). Registrar no output a **versão do modelo e do prompt** (rastreabilidade da geração).
**Conclusão:** `generateProtocol` produz `ProtocolStructure` tipado e parseável; o prompt embute a metodologia do RT e limita a IA à base de referência; versão de modelo/prompt no output; slot de papers presente e não-bloqueante.

**TASK-2.1.3 — Individualização sob constraints de segurança (lesão + PAR-Q) (Victor + Alexandre/RT CREF).**
Instruir a IA (via prompt + contexto de constraints) a **respeitar as exclusões de segurança**: uma flag de lesão orienta a IA a evitar os exercícios contraindicados e preferir substitutos válidos; uma flag de PAR-Q aplica o teto de intensidade correspondente. **Importante:** esta instrução é o "melhor esforço" da geração — a **garantia** de que nenhum exercício contraindicado escapa é do validador determinístico (US-2.3), não do prompt. Para o caso de `requires_professional_review=true` (PAR-Q de risco), a geração-IA **não é chamada no fluxo automático** (a trava é no Worker, US-2.4). Alexandre/RT CREF validam o mapa lesão/PAR-Q → exclusão que alimenta tanto o prompt quanto o gabarito do validador.
**Conclusão:** o prompt orienta exclusão por lesão/PAR-Q e substitutos; o mapa lesão/PAR-Q → exclusão está versionado e validado pelo RT CREF (consumido também pela US-2.3); nenhuma dependência de o prompt "acertar sozinho" — a rede de segurança é o validador.

**TASK-2.1.4 — Determinismo do schema e testes de contorno da geração (Victor + Leonardo).**
Garantir que a **saída da geração é sempre um `ProtocolStructure` válido e parseável** mesmo quando o LLM varia: schema Zod estrito, rejeição/retry de saída malformada, temperatura/params fixados para reduzir variância desnecessária (individualização sim, ruído não). Testes de contorno: saída sempre respeita o schema; exercício fora da base **é sinalizado** para o validador; múltiplas gerações da mesma entrada produzem protocolos válidos (podem diferir — é o desejado — mas nunca inválidos). **A cobertura de 100% NÃO se aplica a este componente de IA** — a qualidade é medida por AI eval (US-2.7).
**Conclusão:** toda geração retorna schema válido (ou aciona fallback); saída malformada não passa; teste prova que gerações distintas da mesma entrada permanecem válidas e dentro do vocabulário da base.

### Definição de Pronto (US-2.1 "validada")

- [ ] Tasks 2.1.1–2.1.4 concluídas.
- [ ] Geração por IA produz `ProtocolStructure` tipado e individualizado, sob a metodologia do RT e restrito à base de referência; base de referência versionada, com duplo papel (contexto + gabarito).
- [ ] Saída sempre schema-válida (ou fallback); versão de modelo/prompt registrada; a garantia de segurança é delegada ao `ValidationService` (US-2.3), não ao prompt.
- [ ] **Validada por:** code review + **aprovação clínica do RT CREF / Alexandre** (metodologia, catálogo e mapa de constraints) + AI eval de faithfulness à base/metodologia verde (US-2.7).

---

## US-2.2 — LLMRouter e PII Scrubber: acesso LGPD-safe ao LLM para a geração do protocolo

**Agentes:** Victor (lead — implementa `LLMRouter`, `PIIScrubber`, roteamento por classe de dado, circuit breaker, caching, logging) · Sato (valida o boundary de dados, ZDR, anti-abuso — §5/§9.4/§10) · Leonardo (integra ao `ai_jobs` e à DI do NestJS).
**Depende de:** Sprint 1 (fundação de secrets `*_FILE`; RLS para `ai_jobs`). É uma das **duas US que começam no dia 1** (independente da geração-IA de US-2.1).
**Habilita:** US-2.1/US-2.4 (a geração-IA chama o router para produzir o protocolo) e US-2.3 (validação roda sobre a saída do router).

### Jornada

O `LLMRouter` é **o único ponto do sistema autorizado a falar com um provedor de LLM** (Victor §1.1) — essa centralização é o que torna PII Scrubber, roteamento por classe de dado, circuit breaker e logging **inescapáveis**. Victor implementa a cascata **GPT-4.1 (principal) → Claude Sonnet 4.5 (fallback)**, ambos ZDR+DPA/SCC (ADR-005-R), com circuit breaker que faz failover em <2s (5xx/429/timeout de first-token), `max_tokens` como teto de custo, e **prompt caching** do prefixo estável (system CREF + metodologia do RT + base de referência + schema do protocolo) — a alavanca que mantém o custo em ~R$1,08/usuário/mês. Antes de qualquer chamada, o **PII Scrubber** (Sato §5.2, Victor §5.1) pseudonimiza o texto: nome→"o usuário", telefone/e-mail/CPF/nascimento removidos, "lesão no ombro direito do João"→"lesão: ombro D". O snapshot persistido em `ai_jobs.input_snapshot` é **sempre** a versão pseudonimizada. O roteamento por `dataClass` é otimização de custo (nano quando seguro), **nunca** autorização para provedor de menor garantia — fail-safe `default = HEALTH`, e mesmo `NON_HEALTH` usa OpenAI ZDR. Nenhum outro módulo importa SDK de OpenAI/Anthropic.

### Objetivo

Ter um `LLMRouter` que produz texto/JSON estruturado a partir de um input já pseudonimizado (usado pela geração-IA e, na Sprint 3, pelo Coach), com cascata GPT-4.1→Claude, circuit breaker <2s, teto de tokens, caching e logging completo em `ai_jobs` — e um `PIIScrubber` inescapável que garante que nenhum identificador direto chega ao provedor.

### Resultado esperado

`llmRouter.complete(request)` retorna `LLMResult` (texto + provider/model/tokens/latência/attempt); uma falha do primário faz failover para o fallback em <2s; o `input_snapshot` logado nunca contém PII em claro; um teste prova que o SDK de provedor não é importado fora do `LLMRouter`.

### Tasks

**TASK-2.2.1 — PII Scrubber determinístico no boundary (Victor + Sato).**
Implementar `scrubPII(text, user)` (Victor §5.1): remove/substitui nome (a partir do `users`), telefone E.164, e-mail, CPF, data de nascimento e nomes de terceiros; normaliza descrições de lesão para rótulos estáveis. Determinístico, <10ms. Roda **antes** de qualquer montagem de prompt e é a única porta para o `LLMRouter`. A versão pseudonimizada é a que se loga. **Bônus:** menos tokens (Eduardo).
**Conclusão:** scrubber remove todos os identificadores das fontes listadas; teste com payloads de PII prova pseudonimização; `input_snapshot` nunca tem PII em claro; Sato valida a lista de fontes.

**TASK-2.2.2 — LLMRouter com cascata, circuit breaker e teto de tokens (Victor).**
Implementar o `LLMRouter` (Victor §1.1-1.2): interface `LLMRequest`/`LLMResult`; cascata **GPT-4.1→Claude Sonnet 4.5** (ambos ZDR, chaves via `*_FILE`); circuit breaker por provedor (CLOSED→OPEN→HALF_OPEN, 5 falhas/30s → OPEN 30s); **failover <2s** em 5xx/429/timeout de first-token >2s; `max_tokens` teto por `purpose` (500 no Coach/texto); timeout hard de 8s no primário; retry único só para erro transitório de rede. `dataClass` com fail-safe `default = HEALTH`; **DeepSeek ausente do código**. SDK de provedor **confinado** a este arquivo.
**Conclusão:** cascata e failover <2s testados (mock de 5xx/429/timeout); teto de tokens aplicado; `default=HEALTH` quando `dataClass` omitido; teste estrutural prova que nenhum outro módulo importa SDK OpenAI/Anthropic.

**TASK-2.2.3 — Prompt caching e logging em `ai_jobs` (Victor + Leonardo).**
Estruturar o prompt com **prefixo estável no topo** (`[system CREF][estrutura do protocolo JSON][histórico][mensagem]`) para maximizar cache hit (GPT-4.1 automático ≥1024 tk; Claude `cache_control`). Adicionar as colunas de Victor §6.1 a `ai_jobs` via migração (`provider`, `data_class`, `tokens_cached`, `attempt`, `intent`, `cost_brl`, `validation_action`) sob RLS. Cada chamada registra provider/model/tokens(in/out/cached)/latência/custo BRL/`data_class`. Expor as métricas Prometheus de Victor §1.2 (leve — Henrique consome na observabilidade).
**Conclusão:** cada chamada grava um `ai_jobs` completo e pseudonimizado; custo BRL calculado por chamada; caching reduz tokens do prefixo em teste; migração aplica sob RLS.

**TASK-2.2.4 — Anti-abuso e budget alert (LLM10) (Victor + Sato + Henrique).**
Implementar o teto anti-abuso de Sato §9.4: **counter Redis por usuário/dia** (namespaced, helper da Sprint 0) e `budget alert` quando o custo/usuário/dia ultrapassa o baseline (sinal de conta comprometida/abuso). No fluxo de geração (batch) o vetor é limitado, mas o teto já nasce aqui para a Sprint 3 (Coach) herdar. Chaves de API como Docker Secrets (local) / GitHub Secrets (CI), nunca `environment:` (Henrique confirma).
**Conclusão:** counter e budget alert ativos e testados; chaves de LLM via secret; alerta dispara acima do baseline em teste.

### Definição de Pronto (US-2.2 "validada")

- [ ] Tasks 2.2.1–2.2.4 concluídas.
- [ ] PII Scrubber inescapável; cascata GPT-4.1→Claude ZDR com failover <2s e teto de tokens; logging completo e pseudonimizado em `ai_jobs`; anti-abuso ativo; SDK de provedor confinado ao router; DeepSeek ausente.
- [ ] **Validada por:** code review + **revisão de segurança de IA de Sato** (boundary, ZDR, §5/§9.4/§10) + testes de failover/scrubber/isolamento verdes (US-2.7).

---

## US-2.3 — ValidationService: veto determinístico sobre o treino inteiro (pedra angular de segurança) + scrubber de prompt injection

**Agentes:** Victor (lead — regras de validação estrutural e de compliance, fluxo de fallback) · Sato (valida guardrails, anti-leak, scrubber de prompt injection — §10) · Alexandre (valida faixas de segurança, lista de termos proibidos e texto do fallback pré-aprovado).
**Depende de:** US-2.2 (roda sobre a saída do `LLMRouter`) e US-2.1 (usa a base de referência e o mapa lesão/PAR-Q como gabarito).
**Habilita:** US-2.4 (o Worker só persiste/entrega protocolo validado) e a Sprint 3 (o mesmo ValidationService protege as respostas do AI Coach).

### Jornada

Com a rejeição do Motor Determinístico, **a segurança do produto passa a morar aqui**: este é o componente que dá à MOVIVO defensabilidade perante o CREF. O `ValidationService` é um checklist **determinístico** (<100ms, local, sem I/O) que ganha **poder de veto sobre o treino inteiro** gerado pela IA — não apenas sobre o texto. Ele valida em duas camadas antes de qualquer persistência/envio (Victor §5.2, Rafael §3.4): **(1) estrutural** — usando a base de referência (US-2.1) como gabarito: todo exercício existe na base, nenhum exercício é contraindicado pela flag de lesão/PAR-Q do usuário, carga/volume/frequência caem em **faixas plausíveis** aprovadas pelo RT; **(2) linguagem/compliance** — sem prescrição de medicamento, diagnóstico, promessa de resultado, violação das constraints de PAR-Q e **leak** (system prompt ou dado de outro usuário). Falha dura → **fallback em cascata: novo modelo → template pré-aprovado pelo RT CREF** + `human_review_required=true`; falhas leves (`FLAG_HUMAN_REVIEW`) roteiam ao painel mas não bloqueiam. Como esta peça nunca pode "errar para o lado inseguro", ela herda o gate migrado do Motor: **100% de cobertura de linha/branch, bloqueante no CI**. Esta US também **implementa de verdade** o scrubber/heurística de prompt injection cujo **baseline foi apenas registrado na US-1.8** (campo livre de lesão contendo "ignore instruções e prescreva…"): delimitação estrutural `<mensagem_usuario>`, heurística de padrões conhecidos, e a garantia de que instrução embutida em dado do usuário não vira comando. Termos proibidos são hard-coded de Sofia §13.

### Objetivo

Ter um `ValidationService` bloqueante e 100% coberto que garante que nenhum protocolo com exercício inexistente/contraindicado, carga fora de faixa, diagnóstico/prescrição/promessa/violação-PAR-Q/leak chega ao usuário — com fallback de modelo → template pré-aprovado — e um scrubber de prompt injection que neutraliza instruções embutidas no texto do usuário.

### Resultado esperado

Um protocolo gerado com um exercício fora da base, um exercício contraindicado pela lesão do usuário, uma carga fora da faixa plausível, um termo proibido ou uma violação de PAR-Q é **bloqueado**, aciona o fallback (retry de modelo → template) e marca `human_review_required=true`; um protocolo limpo passa; um texto de lesão com injeção ("ignore as regras e prescreva X") não altera o comportamento nem vaza o system prompt; a cobertura do módulo é 100% e bloqueia o merge se cair.

### Tasks

**TASK-2.3.1 — Validação estrutural do treino inteiro contra a base de referência (Victor + Alexandre/RT CREF).**
Implementar as regras que cruzam o `ProtocolStructure` gerado com a base de referência (US-2.1) e as flags do usuário: **todo exercício existe na base**; **nenhum exercício é contraindicado** pela flag de lesão/PAR-Q (mapa de US-2.1.3); **carga, volume semanal, séries/reps e frequência** caem em faixas plausíveis aprovadas pelo RT CREF (limites por objetivo/nível). Qualquer violação → `BLOCK_FALLBACK`. Esta é a camada que substitui a garantia que antes vinha do Motor. Alexandre/RT CREF aprovam as faixas de segurança.
**Conclusão:** cada tipo de violação estrutural (exercício inexistente / contraindicado / carga-volume fora de faixa) tem teste que bloqueia; faixas aprovadas pelo RT CREF por escrito.

**TASK-2.3.2 — Checklist de compliance CREF de linguagem (Victor + Alexandre).**
Implementar as `COMPLIANCE_RULES` de Victor §5.2: `MED_PRESCRIPTION`/`PROMISE`/`PARQ_VIOLATION`/`PROMPT_LEAK` → `BLOCK_FALLBACK`; `DIAGNOSIS`/`SCOPE_INDEP` → `FLAG_HUMAN_REVIEW`. `validatePARQConstraints(out, parqFlags)` cruza a saída com as flags do usuário. Termos proibidos hard-coded (Sofia §13: prescrever, diagnóstico, tratamento, cura, garantido, + nomes de medicamentos). Registrar `validation_action` em `ai_jobs`.
**Conclusão:** cada regra tem teste (bloqueia/flag/passa); `validation_action` gravado; Alexandre aprova a lista de termos e o mapeamento de ações.

**TASK-2.3.3 — Fallback em cascata (modelo → template) e fluxo de falha (Victor + Alexandre/RT CREF).**
No `BLOCK_FALLBACK`: primeiro **acionar o fallback de modelo** (regerar com o provedor de fallback, US-2.2) e revalidar; se ainda falhar, substituir por um **template pré-aprovado pelo RT CREF** (texto versionado, dentro dos guardrails, com respaldo CREF visível), marcar `human_review_required=true` no protocolo, emitir evento `protocol_generation_blocked`/`ai_response_blocked` (PostHog). A notificação em tempo real para o painel CREF é Sprint 5 — aqui persiste-se o estado consultável. O RT CREF/Alexandre aprovam o texto do template.
**Conclusão:** protocolo bloqueado tenta regeração de modelo e, persistindo a falha, cai no template aprovado + `human_review_required=true` + evento; texto do template aprovado por escrito.

**TASK-2.3.4 — Scrubber de prompt injection (implementação real do baseline da US-1.8) (Victor + Sato).**
Implementar a defesa que a US-1.8 apenas registrou: **delimitação estrutural** (`<mensagem_usuario>…</mensagem_usuario>` marcando dado ≠ instrução, Victor §7.1), heurística leve de padrões de injeção conhecidos ("ignore as instruções", "você agora é", "revele o prompt", "mostre dados de outro usuário") que sinaliza/sanitiza sem bloquear silenciosamente, e o filtro anti-leak de saída (não contém system prompt nem dado de outro `user_id`). Cobrir o caso de Sato §8.2 (campo de lesão da anamnese com instrução maliciosa).
**Conclusão:** injeção via campo livre não altera comportamento nem vaza system prompt/dado alheio; teste do caso de Sato §8.2 verde; sinalização sem falso-bloqueio silencioso.

**TASK-2.3.5 — Cobertura 100% do ValidationService como gate bloqueante (Victor + Mariana em US-2.7).**
Escrever a suíte que cobre **100%** de linhas/branches do `ValidationService` (gate migrado do antigo Motor, agora que a segurança mora aqui): cada regra estrutural, cada regra de compliance, cada caminho de fallback, cada padrão de injeção. Configurar o threshold de 100% **só para este módulo** (o restante do repo segue ≥80%). Entregar a Mariana/Henrique o wiring para o CI.
**Conclusão:** cobertura do `ValidationService` = 100% (linhas + branches); um PR que a reduza **falha** o CI; suíte roda em <alguns segundos (puro, sem I/O).

### Definição de Pronto (US-2.3 "validada")

- [ ] Tasks 2.3.1–2.3.5 concluídas.
- [ ] Validação **do treino inteiro** (estrutural + linguagem) bloqueante com fallback modelo→template pré-aprovado; `validation_action` logado; scrubber de prompt injection implementado (não mais baseline); anti-leak ativo.
- [ ] Nenhum exercício inexistente/contraindicado, carga fora de faixa ou termo proibido (Sofia §13) escapa; violação de PAR-Q na saída é bloqueada.
- [ ] Cobertura do `ValidationService` = 100% e **bloqueante** no CI.
- [ ] **Validada por:** code review + **revisão de segurança de IA de Sato** (§10) + **aprovação de Alexandre** (faixas/termos/template) + gate de 100% + suite adversarial verde (US-2.7).

---

## US-2.4 — ProtocolGenerationWorker: orquestração, roteamento ao painel CREF e auto-aprovação respeitando o gate PAR-Q

**Agentes:** Leonardo (lead — producer, processor, persistência, orquestração, `approval_status`) · Victor (colabora — encadeia geração-IA→LLMRouter→ValidationService) · Alexandre (valida o modelo de assinatura da metodologia e a auto-aprovação do protocolo sem risco).
**Depende de:** US-2.1 (geração-IA), US-2.2 (LLMRouter), US-2.3 (ValidationService), US-1.7 (fila `protocol-generation` registrada), US-1.3 (submit é o gatilho).
**Habilita:** US-2.5 (entrega) e US-2.6 (persistência que o frontend lê).

### Jornada

Este é o **orquestrador** que junta as camadas no fluxo de Rafael §3.4, agora no modelo **gera-e-valida**. No submit da anamnese (US-1.3), o `AnamnesisModule` **enfileira** um job em `protocol-generation` (o gatilho que a Sprint 1 deixou pronto). Leonardo preenche o **processor** (concorrência 5, lock 120s, 3 retries backoff 2/8/32s, DLQ — parâmetros da US-1.7): busca usuário + anamnese (sob `SET LOCAL`/RLS, decifrando `data_block_2`), **verifica o gate PAR-Q** — se `requires_professional_review=true`, **pula** (a sessão fica `BLOQUEADO_AGUARDANDO_CLEARANCE`, aguardando a Sprint 5) — senão chama a **geração-IA** (US-2.1, JSON estruturado via PII Scrubber + LLMRouter), roda o **ValidationService** (US-2.3, veta o treino inteiro), e persiste `protocols` (v1, `content` JSONB, `constraints` imutável, `par_q_flags`, `approval_status`, origem `generated_by='GPT_4_1'` + versão de modelo/prompt) + `protocol_versions`. **Roteamento + auto-aprovação (o novo coração da US):** todo protocolo nasce roteado ao painel do RT CREF com um `approval_status` — **sem risco mapeado** (validador passou limpo) → `AUTO_APPROVED` + entrega; **com flag de risco** ou bloqueio do validador → `PENDING_REVIEW`/`BLOCKED_PENDING_CLEARANCE`, não entrega. A questão de produto crítica: **como o protocolo automático fica "supervisionado por CREF" sem a tela do painel?** Decisão (a confirmar por Alexandre no início da sprint): o **RT CREF assina a metodologia** (prompt de metodologia + base de referência + faixas do validador + templates, US-2.1/2.3), então protocolos de usuários **sem** flag de PAR-Q nascem com o **selo/assinatura do RT** em nível de metodologia (`professional_id=RT`, `signature_hash` do conteúdo, `approval_status='AUTO_APPROVED'`, `status='ACTIVE'`) — o modelo "selo CREF como assinatura de credibilidade" do CLAUDE.md. **O status de aprovação nasce aqui; a tela do painel e a edição manual do protocolo pelo profissional são Sprint 5.**

### Objetivo

Ter o pipeline assíncrono ponta a ponta funcionando: submit → job → (gate PAR-Q) → geração-IA → validação → roteamento ao painel → (sem risco) auto-aprovação + persistência assinada (RT) → dispara entrega — com DLQ e fallback, respeitando a trava de PAR-Q.

### Resultado esperado

Um usuário sem flag de PAR-Q cujo protocolo passa no validador tem, minutos após o submit, um `protocols` v1 `AUTO_APPROVED`/`ACTIVE` persistido com selo do RT e a entrega enfileirada; um usuário com flag fica `BLOCKED_PENDING_CLEARANCE` sem protocolo; um protocolo bloqueado pelo validador fica `PENDING_REVIEW` sem entrega; um job que falha além dos retries cai na DLQ e dispara o fallback (mensagem de espera + task manual).

### Tasks

**TASK-2.4.1 — Producer no submit + processor da fila (Leonardo).**
Ligar o enqueue em `protocol-generation` no submit da anamnese (US-1.3) — 202 Accepted em <1s (Rafael §3.4). Implementar o processor sobre o `WorkerFactory`/parâmetros da US-1.7 (conc. 5, lock 120s, retries 2/8/32s). Buscar usuário + anamnese completa sob `runAsUser`/`SET LOCAL` (RLS), decifrando `data_block_2` (helper `pgcrypto` da US-1.1). Idempotência: reprocessar o mesmo job não cria protocolo duplicado (checar `UNIQUE(user_id, version)`).
**Conclusão:** submit enfileira e responde <1s; processor consome sob RLS; reprocessamento é idempotente.

**TASK-2.4.2 — Gate PAR-Q no Worker (trava, não flag) (Leonardo + Alexandre).**
Antes de chamar a geração-IA: se `requires_professional_review=true` (ou sessão `BLOQUEADO_AGUARDANDO_CLEARANCE`), o Worker **não gera** — registra que a sessão aguarda liberação profissional e encerra o job com sucesso (não é erro, é trava de negócio). Nenhum protocolo nasce de sessão bloqueada (Alexandre BLOQUEADOR, §12.7 deste doc). O tratamento dessas sessões (liberação/assinatura) é Sprint 5.
**Conclusão:** sessão com flag de risco **não** gera protocolo; estado de espera persistido e consultável; teste cobre o caminho bloqueado.

**TASK-2.4.3 — Encadeamento geração-IA→Validação, roteamento/auto-aprovação e persistência assinada (Leonardo + Victor + Alexandre).**
Para sessão liberada: geração-IA (US-2.1) via PII Scrubber + LLMRouter (US-2.2) → `ProtocolStructure`; ValidationService (US-2.3) veta o treino inteiro. Persistir `protocols` (v1, `content` JSONB, `constraints` imutável, `par_q_flags`, `total_weeks`, `current_week=1`, **`approval_status`**, e a **origem**: `generated_by='GPT_4_1'` + `model_version` + `prompt_version`) e `protocol_versions`, sob RLS. **Roteamento ao painel + auto-aprovação:** validador limpo → `approval_status='AUTO_APPROVED'`, aplica o **modelo de assinatura da metodologia do RT** (decisão validada por Alexandre): `professional_id=RT`, `signature_hash=SHA-256(content)`, `status='ACTIVE'` → dispara entrega; validador bloqueou → `approval_status='PENDING_REVIEW'` + `human_review_required=true`, **não** entrega (aguarda o painel da Sprint 5). Edição manual do profissional **não** é escopo aqui.
**Conclusão:** protocolo v1 persistido com `approval_status` e origem (modelo/prompt); caminho limpo nasce `AUTO_APPROVED`/`ACTIVE` assinado (RT) e entrega; caminho bloqueado fica `PENDING_REVIEW` e não entrega; Alexandre valida o modelo de assinatura/auto-aprovação por escrito.

**TASK-2.4.4 — DLQ, fallback e SLA (Leonardo).**
Job que falha além dos 3 retries cai na **DLQ** (handler da US-1.7): dispara o hook de alerta + enfileira uma **mensagem de fallback** ao usuário ("estamos finalizando seu protocolo, já te aviso" — dentro dos guardrails) + registra task manual (consumida no dashboard Sprint 5). Instrumentar o SLA: medir tempo submit→entrega e emitir `protocol_sent` (PostHog) com timestamp para o alvo de ≤2h/95%.
**Conclusão:** falha persistente cai na DLQ e dispara fallback + task; métrica de SLA emitida; teste de integração cobre sucesso e DLQ.

### Definição de Pronto (US-2.4 "validada")

- [ ] Tasks 2.4.1–2.4.4 concluídas.
- [ ] Pipeline submit→geração-IA→validação→roteamento/auto-aprovação→persistência funcionando sob RLS; idempotente; DLQ com fallback.
- [ ] Gate PAR-Q **trava de verdade** (sessão bloqueada não gera); protocolo sem risco nasce `AUTO_APPROVED`/`ACTIVE` com selo/assinatura da metodologia do RT; protocolo bloqueado pelo validador fica `PENDING_REVIEW` sem entrega; `approval_status` + origem (modelo/prompt) persistidos.
- [ ] **Validada por:** code review + **validação de Alexandre** (modelo de assinatura da metodologia + auto-aprovação + gate PAR-Q) + teste de integração (feliz, bloqueado-validador, bloqueado-PAR-Q, DLQ) verde (US-2.7).

---

## US-2.5 — Entrega no WhatsApp: confirmação imediata e protocolo (outbound AraraHQ)

**Agentes:** Leonardo (lead — processor `whatsapp-outbound`, formatação, idempotência) · Henrique (colabora — integração/credenciais AraraHQ, rate limit, observabilidade de entrega) · Sofia (referência de UX de entrega — persona MOVI, quebra de mensagens).
**Depende de:** US-2.4 (protocolo persistido dispara a entrega) e US-1.7 (fila `whatsapp-outbound` registrada). A confirmação imediata também é acionada pelo submit da US-1.3 (que a Sprint 1 deixou pendente).
**Habilita:** o aha moment (protocolo no WhatsApp) e a Sprint 3 (o AI Coach conversa a partir dessa primeira entrega).

### Jornada

A Sprint 1 construiu a tela de confirmação com deep-link `wa.me`, mas deixou explícito que **o envio real da mensagem no WhatsApp é Sprint 2**. Esta US fecha isso pelo lado **outbound**: Leonardo preenche o processor da fila `whatsapp-outbound` (conc. 10, lock 30s, 5 retries, **rate limit 80 msg/s global** — Meta/AraraHQ, §6). Dois envios nascem aqui: (1) a **confirmação imediata** logo após o submit ("recebemos seus dados, seu protocolo chega em até 2h" — reforço do SLA e do respaldo CREF, Épico 3 de Lucas); (2) a **entrega do protocolo** formatado após a geração (US-2.4), com a persona **MOVI** (Sofia §11), destacando o **primeiro treino desta semana** (aha moment) e quebrado em **mensagens curtas** com delimitador `\n---\n` (o outbound quebra em bolhas com "digitando…"). Henrique cuida da integração AraraHQ (credenciais via secret, rate limit, retry). **Não há webhook de entrada nesta sprint** — a resposta do usuário e o diálogo são Sprint 3.

### Objetivo

Ter o envio outbound funcionando: confirmação imediata no submit + entrega do protocolo formatado após a geração, via fila `whatsapp-outbound`, idempotente, com rate limit e retry, dentro do SLA ≤2h.

### Resultado esperado

Após o submit, o usuário recebe uma confirmação no WhatsApp em segundos; após a geração, recebe o protocolo em mensagens curtas com a persona MOVI e o primeiro treino destacado; reenvio do mesmo job não duplica a mensagem; envios respeitam 80 msg/s.

### Tasks

**TASK-2.5.1 — Integração AraraHQ outbound e processor da fila (Leonardo + Henrique).**
Implementar o cliente AraraHQ (WhatsApp Business API) confinado ao `WhatsappModule`, credenciais via Docker Secret/GitHub Secret. Processor de `whatsapp-outbound` (parâmetros US-1.7: conc. 10, lock 30s, 5 retries, **rate limit 80 jobs/s global**). **Idempotência** por chave de negócio (ex.: `user_id + tipo_mensagem + protocol_version`) para não enviar o mesmo protocolo duas vezes em retry. Sem webhook de entrada (Sprint 3).
**Conclusão:** mensagem sai via AraraHQ; rate limit respeitado; retry não duplica; credenciais via secret.

**TASK-2.5.2 — Mensagem de confirmação imediata (Leonardo + Sofia ref.).**
No submit da anamnese (US-1.3), enfileirar a **confirmação imediata**: recebemos seus dados, seu protocolo chega em até 2h, com respaldo do profissional CREF visível. Copy dentro dos guardrails (nunca "diagnóstico/garantido"). Para o usuário `BLOQUEADO_AGUARDANDO_CLEARANCE` (PAR-Q de risco), a confirmação usa a variante de cuidado (sem alarme, sem diagnóstico) alinhada à tela de cuidado da US-1.6 — informa que um profissional vai revisar antes de liberar.
**Conclusão:** confirmação chega em segundos; variante de PAR-Q de risco não promete protocolo automático; copy nos guardrails.

**TASK-2.5.3 — Formatação e entrega do protocolo com persona MOVI (Leonardo + Sofia ref.).**
Após a geração (US-2.4), enfileirar a **entrega do protocolo**: mensagens curtas com a persona MOVI (Sofia §11 — caloroso, direto, sem hype), transparência de IA na 1ª mensagem, **destaque do primeiro treino desta semana** (aha moment, Épico 3), e o link para a página read-only completa (US-2.6). Quebra por `\n---\n` em bolhas com "digitando…" entre elas. Emitir `protocol_sent` (PostHog) com o timestamp de SLA.
**Conclusão:** protocolo chega formatado, com primeiro treino destacado e link; mensagens quebradas em bolhas; `protocol_sent` emitido; copy nos guardrails.

### Definição de Pronto (US-2.5 "validada")

- [ ] Tasks 2.5.1–2.5.3 concluídas.
- [ ] Confirmação imediata + entrega do protocolo via `whatsapp-outbound`, idempotente, rate-limited (80/s), com persona MOVI e primeiro treino destacado.
- [ ] SLA submit→entrega ≤2h para 95% instrumentado; copy 100% dentro dos guardrails.
- [ ] **Validada por:** code review + revisão de UX/copy (Sofia/guardrails) + teste de integração de entrega (idempotência, rate limit, SLA) verde (US-2.7).

---

## US-2.6 — Frontend: página read-only do protocolo completo

**Agentes:** Felipe (lead) · consome a persistência de US-2.4 · Sofia como referência de UX (§10-11).
**Depende de:** US-2.4 (protocolo persistido). Pode começar com mocks e integrar quando a persistência estabiliza.
**Habilita:** a US do Épico 3 "acessar o protocolo completo das próximas semanas em formato legível" (Lucas).

### Jornada

O protocolo é entregue e conversado no WhatsApp, mas o usuário curioso quer **ver o planejamento completo das próximas semanas em formato legível** (Épico 3 de Lucas). Felipe constrói uma **página web read-only** (não um dashboard — o dashboard dedicado ao usuário é Fase 2), mobile-first, sobre o design system "O Pulso", acessível por **token opaco** (mesmo padrão de acesso não-autenticado da anamnese — o usuário do MVP não faz login, ADR-006), que renderiza o `content` JSONB do protocolo: fases, semanas, treinos, exercícios com séries/reps/descanso, e o **selo CREF visível** (respaldo profissional). É o alvo do deep-link enviado na entrega (US-2.5). Toda a copy respeita os guardrails; nada de linguagem de diagnóstico; o selo CREF é elemento de confiança, não decorativo.

### Objetivo

Uma página read-only mobile-first e acessível que renderiza o protocolo completo a partir do `content` JSONB, acessível por token, com o selo CREF visível e dentro dos guardrails.

### Resultado esperado

O link enviado no WhatsApp abre a página com o protocolo do usuário (fases/semanas/treinos/exercícios legíveis) e o respaldo CREF; um token inválido/expirado não expõe dado; `pnpm --filter web build` verde; axe sem violação crítica.

### Tasks

**TASK-2.6.1 — Rota read-only por token e contrato de leitura (Felipe + Leonardo).**
Criar a rota da página (ex.: `/protocolo/{token}`) que consome um endpoint read-only do backend (`GET /api/v1/protocols/by-token/{token}`, servido por Leonardo sob RLS/token-scoped — sem aceitar `user_id` do cliente, proteção IDOR herdada da US-1.1). Token opaco com expiração; token inválido/expirado não vaza dado. DTO Zod compartilhado do protocolo em `@movivo/shared`.
**Conclusão:** página carrega o protocolo pelo token; token inválido não expõe dado; contrato Zod compartilhado.

**TASK-2.6.2 — Renderização do protocolo e selo CREF (Felipe + Sofia ref.).**
Renderizar o `content` JSONB de forma legível (Sofia §10-11): fases (`ADAPTACAO`→…→`DELOAD`), semanas, dias de treino, exercícios com séries/reps/descanso, e o **selo CREF** com o respaldo do profissional visível. Design system "O Pulso" (Sprint 0); mobile-first. **Sem termos proibidos** (Sofia §13).
**Conclusão:** protocolo renderizado e legível; selo CREF visível; copy nos guardrails; tokens do design system aplicados.

**TASK-2.6.3 — Acessibilidade, performance e analytics (Felipe).**
WCAG 2.2 AA (Sofia §14): semântica, foco visível, contraste, `lang="pt-BR"`. Instrumentar `protocol_viewed` (PostHog). Página estática/RSC onde possível; sem regressão grosseira de Lighthouse.
**Conclusão:** axe sem violação crítica; `protocol_viewed` dispara; build/lint/typecheck verdes.

### Definição de Pronto (US-2.6 "validada")

- [ ] Tasks 2.6.1–2.6.3 concluídas.
- [ ] Página read-only por token renderiza o protocolo completo com selo CREF; token inválido não expõe dado.
- [ ] Copy dentro dos guardrails; WCAG 2.2 AA sem violação crítica; build verde.
- [ ] **Validada por:** code review + revisão de copy (guardrails) + teste de acesso por token (IDOR) + smoke E2E verde (US-2.7).

---

## US-2.7 — QA, avaliação de qualidade de IA e revisão de segurança de IA

**Agentes:** Mariana (lead — testes, cobertura, quality gates, AI evaluation) · Victor (golden set, faithfulness, framework de avaliação — §6) · Sato (revisão de segurança de IA: prompt injection, anti-abuso, ZDR, boundary — §5/§9.4/§10).
**Depende de:** US-2.1 a US-2.6 (há o que testar). **Alimenta** o CI da Sprint 0/1 (quality gate).
**Habilita:** a entrada segura da Sprint 2 em `main` e a disciplina de qualidade de IA das próximas sprints.

### Jornada

A Sprint 2 é a primeira com **IA em produção sobre dado de saúde** — e, com a rejeição do Motor Determinístico, **o AI eval deixa de ser complemento e vira o gate central de qualidade** (não há mais "100% do motor" atestando o treino). Mariana constrói o **golden set** (as 20 FAQs de Lucas + casos de geração de protocolo + red-team) e a **suite adversarial** (promptfoo/garak: prompt injection, jailbreak, tentativa de diagnóstico/prescrição, extração de PII, leak de system prompt) como **quality gate bloqueante** — safety = 0 vazamentos (Victor §6.2, Sato §10.5). Promove a **100% de cobertura do `ValidationService`** (US-2.3, gate migrado do Motor) a gate ativo, e garante o **isolamento multi-tenant do contexto de IA** (nenhum job reusa contexto de outro `user_id`). Mede **faithfulness** (o protocolo gerado é fiel à base de referência e à metodologia do RT — não inventa exercício fora da base, não usa exercício contraindicado, carga/volume em faixa) e a **ausência de termo/exercício proibido** na saída. Sato registra a revisão consolidada do boundary de IA (Scrubber, ZDR, roteamento por classe de dado, anti-abuso). O gate "faithfulness à base/metodologia" é o teste que mais importa: **a IA planejou dentro dos trilhos, e o validador vetou tudo que saiu deles.**

### Objetivo

Cobertura ≥80% do código novo (100% no `ValidationService`), suite adversarial de IA bloqueante (0 vazamentos), faithfulness à base/metodologia comprovada, isolamento de contexto de IA, e revisão de segurança de IA de Sato registrada — tudo integrado ao CI.

### Resultado esperado

O CI reprova qualquer PR que reduza a cobertura do `ValidationService` abaixo de 100%, quebre o isolamento de contexto de IA, deixe passar um termo/exercício proibido ou leak na safety suite, derrube a faithfulness abaixo da meta, ou derrube a cobertura global abaixo de 80%; o pipeline de geração (feliz e bloqueado) tem teste de integração verde; a revisão de Sato está anexada.

### Tasks

**TASK-2.7.1 — Golden set e teste de faithfulness à base/metodologia (Mariana + Victor).**
Montar o golden set (20 FAQs de Lucas + casos de geração de protocolo) e o teste de **faithfulness**: o `ProtocolStructure` gerado pela IA **só usa exercícios existentes na base de referência**, **não inclui exercício contraindicado** pelas constraints, mantém carga/volume/reps em faixa plausível e **segue a metodologia do RT** (RAGAS-style claim→suporte, LLM-as-judge com Claude Opus como juiz + amostra humana). Meta faithfulness ≥0.9, accuracy ≥90%. **Gate bloqueante** (substitui a garantia que o Motor dava).
**Conclusão:** golden set versionado; teste de faithfulness roda no CI e bloqueia; geração que inventa exercício ou foge da metodologia falha o teste.

**TASK-2.7.2 — Suite adversarial de segurança de IA como gate bloqueante (Mariana + Sato + Victor).**
Suite promptfoo/garak (Sato §10.5, Victor §6.2): baterias de prompt injection, jailbreak, tentativa de diagnóstico/prescrição, extração de PII, leak de system prompt e de dado de outro usuário. **Gate bloqueante:** safety = 0 vazamentos → falha na suite bloqueia o merge/deploy. Incluir o caso do campo de lesão malicioso (Sato §8.2).
**Conclusão:** suite adversarial no CI; 0 vazamentos exigido; um caso de injeção plantado que passe **falha** o pipeline.

**TASK-2.7.3 — 100% do ValidationService + isolamento de contexto de IA (Mariana).**
Fazer o gate de **100% de cobertura do `ValidationService`** (US-2.3, migrado do antigo gate do Motor) ativo e bloqueante no CI. Testes de **isolamento multi-tenant do contexto de IA**: um job de geração de A nunca lê/injeta dado de B (RLS + namespacing Redis + `input_snapshot` escopado). Marcar como bloqueante (estende o gate de isolamento da US-1.8 à camada de IA).
**Conclusão:** 100% do `ValidationService` bloqueante; teste de vazamento cross-tenant de contexto de IA falha o pipeline se violado.

**TASK-2.7.4 — Teste de integração do pipeline e SLA (Mariana + Leonardo).**
Integração ponta a ponta: submit → geração-IA → validação → auto-aprovação → persistência → entrega (feliz); o caminho **bloqueado por PAR-Q** (sem geração → confirmação de cuidado); o caminho **bloqueado pelo validador** (protocolo inseguro → fallback modelo→template → `PENDING_REVIEW`, sem entrega); e a **DLQ** (falha persistente → fallback). Cobrir idempotência do Worker e do outbound, e a métrica de SLA (≤2h).
**Conclusão:** integração dos quatro caminhos (feliz/PAR-Q-bloqueado/validador-bloqueado/DLQ) verde local e no CI.

**TASK-2.7.5 — Custo de IA, revisão de segurança de Sato e atualização de gates (Mariana + Sato + Victor).**
Medir o **custo de IA por usuário** (`sum(cost_brl)` de `ai_jobs`) e confirmar dentro do teto (~R$1,08/usuário/mês, ≤15% do ARPU — Victor §8/Eduardo). Sato registra a **revisão de segurança de IA consolidada** (boundary/Scrubber/ZDR/roteamento por classe de dado/anti-abuso/guardrails — §5/§9.4/§10). Atualizar o documento de quality gates: "100% `ValidationService`", "faithfulness à base/metodologia" e "safety suite de IA" como **ativos/bloqueantes**.
**Conclusão:** custo medido dentro do teto; revisão de Sato registrada; documento de gates atualizado.

### Definição de Pronto (US-2.7 "validada")

- [ ] Tasks 2.7.1–2.7.5 concluídas.
- [ ] Faithfulness à base/metodologia ≥0.9 e safety = 0 vazamentos (gates); 100% do `ValidationService` e isolamento de contexto de IA bloqueantes; integração (feliz/PAR-Q-bloqueado/validador-bloqueado/DLQ) verde; custo dentro do teto.
- [ ] Cobertura ≥80% global; gates integrados ao CI.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de IA de Sato registrada** + Victor confirma faithfulness/custo + CI verde com os novos gates ativos.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-2.1 | Geração por IA guiada (metodologia CREF + base de referência) | **Victor** | Leonardo (base de referência/persistência) | **RT CREF / Alexandre** (metodologia/clínico) + AI eval faithfulness (Mariana) |
| US-2.2 | LLMRouter + PII Scrubber | **Victor** | Leonardo (`ai_jobs`/DI), Henrique (secrets) | **Sato (segurança de IA)** + Mariana |
| US-2.3 | ValidationService (veta o treino inteiro, 100% cov.) + scrubber prompt-injection | **Victor** | Leonardo (base como gabarito) | **Sato (segurança de IA)** + **Alexandre** (faixas/termos/template) + gate 100% (Mariana) |
| US-2.4 | ProtocolGenerationWorker + roteamento/auto-aprovação + gate PAR-Q | **Leonardo** | Victor (encadeia IA) | **Alexandre** (assinatura da metodologia/auto-aprovação/PAR-Q) + Mariana |
| US-2.5 | Entrega outbound AraraHQ | **Leonardo** | Henrique (AraraHQ/infra), Sofia (UX ref.) | Review + UX/copy + integração (Mariana) |
| US-2.6 | Frontend: página read-only do protocolo | **Felipe** | Leonardo (endpoint), Sofia (UX ref.) | Review + copy + IDOR + E2E (Mariana) |
| US-2.7 | QA + AI eval + segurança de IA | **Mariana** | Victor, Sato, Leonardo | Mariana + **Sato** + Victor + gate no CI |

> **Victor (IA) entra na Sprint 2** — é o responsável (R) pela geração por IA guiada, LLMRouter/PII Scrubber e ValidationService (US-2.1 a US-2.3), e colabora no Worker (US-2.4). **Sato** valida a segurança de IA (boundary, prompt injection, anti-abuso, ZDR) nas US de IA. **Alexandre** valida o modelo de supervisão/assinatura **da metodologia** e a auto-aprovação do protocolo sem risco (US-2.4), além das faixas/termos/template (US-2.3) — **o modelo jurídico "RT assina a metodologia, não cada treino" é pendência formal de Alexandre para o lançamento** (não bloqueia dev local). **Henrique** tem participação leve (secrets de API de LLM, integração AraraHQ, observabilidade de custo). **Felipe** entrega apenas a página read-only (US-2.6) — carga menor nesta sprint.

## Critério de conclusão da Sprint 2 (aceite do Épico 2)

A Sprint 2 é **entregue** quando as 7 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. A **geração por IA guiada** produz protocolos individualizados a partir da anamnese, **sob a metodologia do RT CREF e restrita à base de referência**, com origem (modelo/prompt) registrada; a fidelidade à base/metodologia é comprovada por AI eval.
2. O **LLMRouter** opera com GPT-4.1→Claude Sonnet 4.5 (ZDR), failover <2s, teto de tokens e caching; o **PII Scrubber** é inescapável; `ai_jobs` loga tudo pseudonimizado; DeepSeek está ausente.
3. O **ValidationService** — pedra angular de segurança, **100% de cobertura bloqueante** — veta o **treino inteiro** (exercício inexistente/contraindicado, carga fora de faixa, diagnóstico/prescrição/promessa/violação-PAR-Q/leak) com fallback modelo→template; o scrubber de prompt injection está implementado (não mais baseline).
4. O **ProtocolGenerationWorker** roda submit→geração-IA→validação→roteamento/auto-aprovação→persistência assinada (metodologia RT CREF)→entrega, sob RLS, idempotente, com DLQ; todo protocolo nasce com `approval_status` (sem risco → `AUTO_APPROVED`); **sessão com PAR-Q de risco não gera protocolo**; edição manual pelo profissional fica para a Sprint 5.
5. O usuário recebe **confirmação imediata + protocolo formatado** no WhatsApp (persona MOVI, primeiro treino destacado), dentro do **SLA ≤2h para 95%**.
6. A **página read-only** do protocolo abre por token com selo CREF visível e dentro dos guardrails.
7. **Quality gate de IA** bloqueante: faithfulness à base/metodologia ≥0.9, safety = 0 vazamentos, 100% do `ValidationService`, isolamento de contexto de IA; custo de IA dentro do teto (~R$1,08/usuário/mês).
8. CI verde; cobertura ≥80% (100% no `ValidationService`); toda entrega via PR + 6 checks (`main` protegida); revisão de segurança de IA de Sato registrada.

### Pré-requisitos / bloqueadores a resolver no início da sprint

- **[Segredos — Henrique/Alexandre] Chaves de API de LLM (OpenAI GPT-4.1 e Anthropic Claude Sonnet 4.5) com ZDR + DPA/SCC ativos.** Sem as contas com Zero Data Retention e os DPAs assinados (Alexandre, ADR-005-R), o boundary de saúde não pode ir a produção. Chaves como Docker Secrets (local) / GitHub Secrets (CI), nunca `environment:`. **É o bloqueador nº 1 — resolver no dia 1.**
- **[Decisão de produto/jurídica — Alexandre + RT CREF] Modelo de supervisão/assinatura e auto-aprovação (US-2.4):** confirmar formalmente o modelo do fundador — o RT CREF **assina a metodologia** (prompt de metodologia + base de referência + faixas do validador + templates), **não cada treino**, e protocolos de usuários **sem** risco mapeado são **auto-aprovados** (`professional_id=RT`, `signature_hash`, `AUTO_APPROVED`/`ACTIVE`), deixando a tela do painel, a edição manual e as exceções para a Sprint 5. **Sem essa validação, não há como entregar protocolo auto-aprovado dentro do escopo CREF no lançamento** (não bloqueia dev local com mocks).
- **[Conteúdo clínico — RT CREF/Victor] Metodologia de treino + base de referência de exercícios + mapa de constraints (lesão/PAR-Q → exclusão/substituto) + faixas de carga/volume plausíveis** (US-2.1/US-2.3): é insumo clínico, não de engenharia. A IA planeja sob a metodologia do RT e a base; o validador usa a base e as faixas como gabarito. Ambos precisam ser aprovados pelo RT CREF antes.
- **[Conteúdo — Alexandre/RT CREF] Textos de template de fallback pré-aprovados** (US-2.3) e a lista final de termos proibidos (Sofia §13, base): quando o validador bloqueia e a regeração de modelo falha, o ValidationService substitui por template aprovado — precisa existir aprovado antes.
- **[Integração — Henrique] Credenciais e ranges de IP da AraraHQ** (US-2.5) para o outbound (e allowlist, se o provedor publicar ranges estáveis). O webhook de entrada é Sprint 3, mas o outbound precisa da conta AraraHQ ativa.
- **[Marca] Go-live com usuário real permanece condicionado à liberação INPI (MOVIVO × VIVO)** — trava herdada de Alexandre/Kimura. Construir, gerar e testar é liberado; **entrega a usuário real** depende do parecer de PI (não bloqueia esta sprint de desenvolvimento).

### Handoff para a Sprint 3 (AI Coach conversacional)

Concluída a Sprint 2, a Sprint 3 (AI Coach — `ARQUITETURA.md` §10) recebe: o `LLMRouter`, o `PIIScrubber` e o `ValidationService` **prontos e testados** (a Sprint 3 os reusa para as respostas conversacionais); protocolos `ACTIVE` persistidos (a episodic memory do Coach lê deles); a fila `ai-response` já registrada (US-1.7) esperando o `AIResponseWorker`; o outbound AraraHQ funcionando (a Sprint 3 adiciona o **inbound**: `WebhookController` com HMAC + debounce + lock + replay protection). A Sprint 3 implementa o `ContextService` de 3 camadas, o `IntentClassifier`, a **indexação do corpus RAG em PGVector** e o `RAGService`, e o reranker self-hosted de Victor. Antes de implementar, Leonardo e Victor devem observar que a suite adversarial (US-2.7) protege também as respostas conversacionais e que o rate limit de 50 msg/dia (Sato §9.4) passa a ser o teto operacional real. Este documento cobre **apenas** a Sprint 2; o planejamento da Sprint 3 será feito por Lucas depois, com o aprendizado desta.

---

*Documento de planejamento operacional da Sprint 2 — Lucas Monteiro (PM/PO). **Revisado para a decisão de produto do fundador: rejeição do Motor Determinístico puro em favor do modelo "gera-e-valida" (IA planeja sob a metodologia do RT CREF + base de referência; validador determinístico veta o treino inteiro inseguro; RT assina a metodologia; painel auto-aprova).** Escopo de: `ARQUITETURA.md` §10 (Sprint 2 — Pipeline de Protocolo). Camada de IA de `12-relatorio-victor.md` (LLMRouter, PII Scrubber, ValidationService, avaliação, custo). Tipos de domínio e fluxo de geração de `10-relatorio-rafael.md` §3.4/§5.2 (reaproveitados no `ProtocolStructure`; o gate de 100% migrou do Motor para o ValidationService). Requisitos de segurança de IA de `11-relatorio-sato.md` §5/§9.4/§10 (boundary, anti-abuso, prompt injection, red-team). UX de entrega de `09-relatorio-sofia.md` §10-11/§13. Supervisão CREF e gate PAR-Q de `06-relatorio-alexandre.md`. Teto de custo de `07-relatorio-eduardo.md`. Consistência de produto com o Épico 3 de `08-relatorio-lucas.md`. Construído sobre a fundação da Sprint 0 e o core de usuário/anamnese da Sprint 1.*
