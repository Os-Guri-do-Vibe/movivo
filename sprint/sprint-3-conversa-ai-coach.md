# Sprint 3 — Conversa com o AI Coach (MOVI) e Webhook de Entrada (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-07-30
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 3)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + Engenheiro de IA (Victor) + QA (Mariana), com revisão de segurança de IA de Sato e validação clínico-jurídica de Alexandre
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§3.1 ADR-005-R, §5 arquitetura híbrida, §6 filas, §8 segurança/RLS, §10 roadmap Sprint 3, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/12-relatorio-victor.md` (LLMRouter §1, **ContextService 3 camadas §2**, **IntentClassifier §3**, **RAG pipeline §4**, ValidationService/PII Scrubber §5, LLMOps/avaliação §6, guardrails anti-injeção §7, custo §8, latência §9, ondas §11) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` (§6 HMAC + proteção contra replay do webhook AraraHQ, §9.4 anti-abuso LLM10 / rate limit 50 msg/dia, §10 guardrails/prompt injection, red-team no CI) · `docs/fitness-ia-whatsapp/10-relatorio-rafael.md` (fluxo do AIResponseWorker, debounce/lock, memória 3 camadas, `conversations`/`knowledge_base`) · `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (§11 persona MOVI, tom, aha moment, quebra de mensagens, escopo/handoff §11.4, §13 termos proibidos) · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (**Épico 4 — Conversa com AI Coach**, escopo/handoff/memória/tom, North Star, teto de custo) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (supervisão CREF, direito de contestação/handoff, AI Act) · `docs/fitness-ia-whatsapp/07-relatorio-eduardo.md` (teto de custo de IA por usuário/mês)

---

## Como ler este documento

Hierarquia: **Épico → User Stories (US-3.x) → Tasks (TASK-3.x.y)**.

- Cada **User Story** declara: agentes participantes e ordem, dependências (depende de / habilita), jornada (o que se constrói e por quê), objetivo, resultado esperado, tasks e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD (code review, teste automatizado verde, quality gate de IA de Mariana/Victor, revisão de segurança de IA de Sato, validação clínico-jurídica de Alexandre etc.).
- Esta é a **terceira** sprint de desenvolvimento. A Sprint 1 entregou a **porta de entrada** (anamnese → `SUBMITTED`); a Sprint 2 entregou o **núcleo de valor** (protocolo gerado, validado, auto-aprovado e entregue no WhatsApp em ≤2h — **outbound-only**). **A Sprint 3 entrega o diálogo recorrente**: o usuário responde no WhatsApp e o **AI Coach (persona MOVI)** conversa — substituição de exercício, dúvida de execução, motivação, orientação de segurança, memória ("lembra de ontem") e recusa honesta do que está fora de escopo. É a primeira sprint com **IA em resposta síncrona a mensagem do usuário** (a Sprint 2 só chamava o LLM em batch, na geração) e a primeira que abre a **superfície de ENTRADA** do sistema (webhook), o que torna a **validação HMAC + anti-replay + debounce + lock**, o **scrubber de prompt injection sobre a mensagem do usuário** e o **teto anti-abuso por custo/usuário/dia** requisitos **bloqueantes**, não recomendações.

> **Decisão de produto (coração desta sprint):** a Sprint 2 provou que **a IA planeja o treino sob a metodologia do RT CREF e um validador determinístico veta o inseguro**. A Sprint 3 aplica o **mesmo princípio à conversa**: MOVI **verbaliza e orienta** dentro do escopo seguro; **o mesmo `ValidationService` (US-2.3) veta as RESPOSTAS do Coach** (sem diagnóstico/prescrição/promessa/leak; substituição de exercício restrita à base de referência da US-2.1); e **toda pergunta fora de escopo é recusada com honestidade e, quando há sinal de risco à saúde, encaminhada para avaliação humana** (parar o treino + procurar avaliação + handoff CREF). A IA **nunca** altera o estado de treino por texto (Sato §10.1) — MOVI é uma camada de linguagem sobre um protocolo já assinado. O respaldo do profissional CREF é **sempre visível** ao usuário.

### Base já entregue pelas Sprints 0-2 (não reconstruir — consumir)

- **`LLMRouter` + `PIIScrubber` + `ai_jobs` (US-2.2):** o Coach chama o **mesmo router** (GPT-4.1→Claude Sonnet 4.5 ZDR, circuit breaker <2s, `max_tokens` teto — **500 no Coach**, prompt caching, roteamento por `dataClass` com `default=HEALTH`, logging pseudonimizado). O PII Scrubber inescapável no boundary de entrada já existe. **Nenhum módulo importa SDK de provedor fora do router.** A Sprint 3 **não reimplementa** nada disto — reusa.
- **`ValidationService` + scrubber de prompt injection (US-2.3):** a **pedra angular de segurança**, 100% de cobertura bloqueante. O **mesmo validador protege as respostas do Coach** — camada de linguagem (sem diagnóstico/prescrição/promessa/violação-PAR-Q/leak, termos proibidos de Sofia §13) e camada estrutural (substituição de exercício só dentro da base de referência/nível/equipamento do usuário, nunca exercício contraindicado por lesão/PAR-Q). O scrubber de prompt injection (`<mensagem_usuario>`, heurística, anti-leak) já está implementado. **Reafirmação:** a Sprint 3 **estende os casos de teste** do validador ao diálogo, mas não altera seu contrato central.
- **Transporte WhatsApp OUTBOUND (US-2.5):** processor da fila `whatsapp-outbound` (conc. 10, lock 30s, 5 retries, **rate limit 80 msg/s global**), cliente AraraHQ confinado ao `WhatsappModule`, idempotência por chave de negócio, quebra em bolhas por `\n---\n` com "digitando…". A resposta do Coach sai por aqui.
- **Fila `ai-response` já registrada (US-1.7):** os 5 filas de §6 já têm `WorkerFactory`, DLQ handler e drenagem graciosa. A Sprint 3 **preenche o processor** de `ai-response` (o `AIResponseWorker`) — não reconstrói a infraestrutura de filas.
- **PGVector disponível (Sprint 0), ocioso desde então:** a Sprint 2 injetou a base de referência como contexto estruturado no prompt, **sem retrieval vetorial**. **A Sprint 3 ativa o PGVector de verdade:** indexação do corpus RAG de literatura curada + retrieval + reranker self-hosted (Victor §4). Este é um dos maiores blocos novos da sprint.
- **Protocolos `ACTIVE` persistidos (US-2.4):** `protocols.content` JSONB, `constraints` imutável (equipamentos/lesões/PAR-Q), `par_q_flags`, fase/semana. A **episodic memory** do Coach lê deste estado sob RLS (`SET LOCAL`).
- **Isolamento por titular (RLS `FORCE ROW LEVEL SECURITY` + namespacing Redis, Sprint 1):** estende-se ao **contexto de conversa** — working memory Redis namespaceada por `user_id`, episodic sob `SET LOCAL`, `input_snapshot` escopado. Nenhum job de A lê contexto de B.

### Regras inegociáveis que valem nesta sprint (de `ARQUITETURA.md` §12, `12-victor`, `11-sato`, `09-sofia`)

1. **A IA verbaliza e orienta; nunca decide/altera o treino por texto** (Sato §10.1, Victor §7): MOVI não tem tools com efeito colateral — não escreve no banco, não altera protocolo, não dispara pagamento. Substituição de exercício é **buscada na base de referência** (US-2.1) e apenas **verbalizada** por MOVI; a IA nunca inventa exercício fora do vocabulário aprovado. O ajuste de protocolo (efeito no estado) é o check-in semanal — **fora desta sprint**.
2. **O `ValidationService` (US-2.3) veta toda resposta do Coach antes do envio** — mesmo contrato bloqueante da Sprint 2, agora sobre texto conversacional: BLOCK → resposta-padrão pré-aprovada; FLAG → envia mas marca para revisão. **0% de orientação médica direta** (critério de aceite do Épico 4). Nenhuma resposta não-validada sai.
3. **Webhook de entrada com HMAC + anti-replay (Sato §6):** (a) HMAC-SHA256 sobre o **corpo bruto** + `timingSafeEqual`; (b) timestamp assinado dentro de **janela ±5 min** (o timestamp entra no cálculo do HMAC); (c) nonce/`messageId` de uso único em Redis (`SET NX` TTL 600s) para pegar replay dentro da janela. **200-rápido e enfileira** — o webhook nunca processa IA de forma síncrona.
4. **Debounce + lock por usuário (Rafael, Sato §9.4):** usuários mandam 3-5 mensagens picadas; o handler faz **debounce (3-5s, concatena o batch)** e **Redis lock por `user_id`** — só um job de resposta por usuário roda por vez; mensagem que chega com job em curso é enfileirada, não processada em paralelo.
5. **Anti-abuso de LLM (LLM10 — Sato §9.4):** **rate limit de 50 msg/dia por usuário** (counter Redis namespaceado, herdado da US-2.2.4 e agora **teto operacional real** do Coach), `budget alert` por custo/usuário/dia, `max_tokens=500`, circuit breaker. Acima do teto → resposta gentil de limite, sem chamar o LLM.
6. **PII Scrubber inescapável + provedor ZDR** (Sato §5, Victor §5.1): a mensagem do usuário (campo livre — vetor de injeção) passa pelo scrubber antes de qualquer montagem de prompt; `input_snapshot` sempre pseudonimizado; `dataClass` fail-safe `HEALTH`. DeepSeek ausente.
7. **Guardrails de linguagem** (Sofia §13, Gabriel/Clóvis): nunca "diagnóstico", "tratamento", "cura", "resultado garantido"; MOVI se apresenta **sempre como ferramenta do profissional CREF**, com **transparência de IA na 1ª mensagem** (AI Act/Alexandre); respaldo CREF visível; tom "manda áudio pro amigo", mensagens curtas em bolhas.
8. **SLA de resposta ≤30s p95** (Épico 4 de Lucas, Victor §9): "digitando…" imediato mascara a latência; orçamento típico 4-12s. **Custo dentro do teto** (~R$1,08/usuário/mês, ≤15% do ARPU — Victor §8/Eduardo).
9. **Isolamento multi-tenant do contexto de conversa** (Sato §10.3): working memory Redis por `user_id`, episodic sob `SET LOCAL`/RLS, RAG somente-leitura (`movivo_app` só SELECT em `knowledge_base`/`intent_examples`). Nenhum job reusa objeto de contexto entre usuários.
10. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI; cobertura ≥80% (100% no `ValidationService` mantido); AI eval de conversa (faithfulness/safety), suíte adversarial **estendida ao diálogo** e isolamento de contexto **bloqueantes**. Nenhum push direto.

---

# ÉPICO 4 — Conversa com o AI Coach (MOVI) + Webhook de Entrada

### Descrição

Fechar o **diferencial competitivo central da MOVIVO**: transformar a entrega outbound da Sprint 2 num **diálogo recorrente**. O usuário responde no WhatsApp e MOVI conversa — dentro de um escopo seguro e supervisionado por CREF. O épico tem seis blocos construídos nesta sprint: (1) o **webhook de ENTRADA** da AraraHQ (o inbound que a Sprint 2 explicitamente adiou), com HMAC + anti-replay + debounce + lock + 200-rápido/enfileira; (2) o **`ContextService` de 3 camadas** (working memory Redis / episodic Postgres sob RLS / semantic PGVector), escopado por `user_id`, que dá a MOVI a memória ("lembra de ontem") sem estourar tokens; (3) o **RAG pipeline** — ativação real do PGVector: indexação do corpus curado, retrieval com threshold e reranker self-hosted (`bge-reranker-v2-m3`), consultado **só** em dúvida técnica; (4) o **IntentClassifier** (guardrail de entrada + embedding-kNN + fallback nano) que roteia a mensagem para o handler certo; (5) o **`AIResponseWorker`** sobre a fila `ai-response`, que orquestra intent→contexto→(RAG)→LLMRouter→**ValidationService**→outbound, cobrindo substituição de exercício, execução, motivação e a **recusa honesta / handoff** para o que foge do escopo; e (6) o **handoff humano CREF** (estado persistido consultável — o painel do profissional é Sprint 5) + a **captura de feedback (thumbs)** e o loop de engajamento. Fecha com uma US de **QA + AI eval + segurança de IA da conversa** (faithfulness/safety do diálogo, suíte adversarial estendida, isolamento, custo) como gate bloqueante.

### Objetivo

Ao final da Sprint 3, um usuário que recebeu seu protocolo na Sprint 2 pode **conversar com MOVI no WhatsApp**: pedir a substituição de um exercício e receber uma alternativa **dentro do seu nível/equipamento e da base de referência**; tirar dúvida de execução com resposta ancorada em literatura (RAG) sem alucinação; receber motivação no tom da persona; ter MOVI **lembrando** o que foi conversado antes; e, ao perguntar algo fora de escopo (nutrição/suplementos) ou relatar dor anormal, receber uma **recusa honesta** (limite claro + recurso externo) ou uma **orientação de segurança** (parar + procurar avaliação + handoff CREF). Tudo em **≤30s p95**, com **0% de orientação médica direta**, respaldo CREF visível, e o mesmo validador determinístico vetando qualquer saída insegura. A entrada é protegida por HMAC/anti-replay/debounce/lock e o custo fica dentro do teto.

### Resultado esperado do épico

- **Webhook de entrada AraraHQ** (`WebhookController` em `WhatsappModule`): HMAC-SHA256 sobre corpo bruto + `timingSafeEqual`, janela ±5 min, nonce único em Redis; **200 em <1s** e enfileira em `ai-response`; debounce 3-5s concatenando o batch do usuário; Redis lock por `user_id`; rate limit de webhook (Cloudflare + `ThrottlerGuard`) + allowlist de IP AraraHQ se houver ranges estáveis.
- **`ContextService` de 3 camadas** escopado por `user_id`: working memory Redis (`session:{user_id}:{data}`, janela 10-15 msgs, TTL 24h, resumo assíncrono de sessão longa em Postgres), episodic Postgres sob `SET LOCAL`/RLS (protocolo ativo, semana, fase, constraints, `par_q_flags`, últimos ajustes), semantic PGVector (RAG, só em dúvida técnica). PII Scrubber roda sobre tudo antes de retornar.
- **RAG pipeline** ativado: indexação offline do corpus curado (chunking ~400-512 tk, overlap 15%, `text-embedding-3-small`, HNSW `m=16/ef_construction=64`); retrieval top-20 com threshold cosseno >0.75 + reranker self-hosted `bge-reranker-v2-m3` → top-3; fail-safe anti-alucinação (sem RAG → MOVI reconhece o limite). Corpus **somente-leitura** (`movivo_app` só SELECT).
- **IntentClassifier**: guardrail de entrada (regex <1ms para sinais de risco clínico → força handoff), embedding-kNN primário, fallback GPT-4.1-nano; taxonomia `DUVIDA_TECNICA`/`SUBSTITUICAO_EXERCICIO`/`MOTIVACAO`/`CHECKIN_ANTECIPADO`/`FORA_DE_ESCOPO` + operacionais; prompts por intenção versionados em `prompts/`, todos herdando o bloco base de guardrails.
- **`AIResponseWorker`** sobre `ai-response` (parâmetros US-1.7): orquestra intent→contexto→(RAG)→LLMRouter (PII Scrubber inescapável)→**ValidationService** (veta a resposta)→`whatsapp-outbound`; persiste em `conversations` (sender, texto, `job_id`, `validation_action`); logging completo em `ai_jobs`; DLQ com fallback; SLA ≤30s p95 instrumentado.
- **Substituição de exercício segura**: MOVI encontra o substituto **na base de referência** (US-2.1, dentro do padrão de movimento/nível/equipamento, nunca contraindicado por lesão/PAR-Q) e apenas verbaliza — nunca inventa. O validador confirma que o substituto pertence à base.
- **Recusa honesta + orientação de segurança + handoff CREF**: fora de escopo → resposta-padrão pré-aprovada com limite claro e recurso externo; sinal de dor anormal/risco → orientar parar + procurar avaliação + **handoff** ("quero falar com o profissional" — direito de contestação/AI Act). Estado de handoff **persistido e consultável** (o painel do profissional é Sprint 5).
- **Feedback (thumbs) + engajamento**: 👍/👎 capturado por interação → PostHog (CSAT ≥80%); métricas de engajamento (2ª mensagem no mesmo dia ≥40%). Entrega em bolhas com "digitando…" (reusa US-2.5).
- **Quality gate de IA da conversa** bloqueante: faithfulness do diálogo (RAG ancorado, substituição fiel à base), safety = 0 vazamentos (suíte adversarial estendida ao diálogo: injeção multi-turn, jailbreak, extração de PII, leak cross-user), isolamento de contexto, custo dentro do teto. Revisão de segurança de IA de Sato registrada.
- CI verde; cobertura ≥80% (100% no `ValidationService` mantido); custo de IA medido dentro do teto.

### Não-escopo desta sprint (para não haver ambiguidade)

A fronteira da Sprint 3 é **"conversa + entrada"** — o diálogo recorrente e a superfície inbound. Ficam **explicitamente fora**, e esta é uma decisão de foco deliberada (não inchar a sprint que já carrega webhook + memória + RAG + intent + worker):

- **Check-in semanal e ajuste de protocolo (Sprint 5):** `CheckinWeeklyWorker` + cron/`repeat` do BullMQ + a lógica de **ajuste do protocolo** pós-check-in (o efeito no estado de treino). Motivo do adiamento: o check-in **muda o protocolo** — é uma operação de escrita sobre o estado, tecnicamente e regulatoriamente distinta da conversa (que só verbaliza). A intenção `CHECKIN_ANTECIPADO` é **detectada** nesta sprint (o classificador a reconhece e responde com a estrutura de 3 quick replies de Sofia §11.5), mas o **ajuste real do protocolo** que ela dispararia fica para a Sprint 5. Misturar os dois faria a Sprint 3 assumir a superfície de escrita de treino sem o painel de supervisão pronto — risco desnecessário.
- **Conversão trial→pago e pagamento (Épico 5 / Sprint 4):** `SUBSCRIPTION` (Stripe/Asaas), `ConversionSequenceWorker` (dias 7/10/13/14), webhooks de pagamento. Motivo: é um épico de monetização independente do valor conversacional; a conversa precisa existir e engajar **antes** de otimizarmos a conversão sobre ela. A sequência de nurturing usa o canal outbound (já pronto) e não depende de o diálogo estar completo.
- **Dashboard CREF (Sprint 5):** a **UI** do painel do profissional, a fila de handoffs, a resposta humana ao usuário e o tratamento das exceções. Nesta sprint, o handoff **persiste o estado consultável** (`conversations`/flag), mas a **tela e a resposta humana** são Sprint 5. A notificação em tempo real (Socket.io) também é Sprint 5 — aqui emite-se o evento e persiste-se o estado.
- **Hybrid search (BM25+RRF), fine-tuning de tom, sumarização avançada de sessão longa (Fase 2/na tração):** no MVP, denso + threshold + rerank já cobrem o corpus curado (Victor §4.2). O resumo de sessão >15 turnos entra numa forma mínima (job assíncrono simples), sem sumarização sofisticada.
- **App mobile, dashboard do usuário final, wearables, gamificação, referral (Fase 2 do produto).**

### Mapa de dependências entre User Stories

```
US-3.1 (Webhook de ENTRADA: HMAC + anti-replay + debounce + lock + 200-fast/enqueue · Leonardo+Sato+Henrique) ─┐
US-3.2 (ContextService 3 camadas escopado por usuário · Victor+Leonardo) ──────────┐                            │
US-3.3 (RAG pipeline: indexação corpus PGVector + retrieval + reranker · Victor+Leonardo+Henrique)              │
        └── habilita a camada semantic de US-3.2                                    │                            │
US-3.4 (IntentClassifier + guardrail de entrada + prompts por intenção · Victor) ──┤                            │
US-3.5 (AIResponseWorker: orquestra intent→contexto→RAG→LLMRouter→ValidationService→outbound · Leonardo+Victor) │
        └── depende de US-3.1 (recebe o job) + US-3.2 (contexto) + US-3.3 (RAG) + US-3.4 (intent)               │
            + REUSA US-2.2 (LLMRouter) + US-2.3 (ValidationService) + US-2.5 (outbound)                         │
US-3.6 (Handoff humano CREF + feedback thumbs + engajamento · Leonardo+Felipe+Alexandre) ── depende de US-3.5   │
US-3.7 (QA + AI eval + segurança de IA da conversa · Mariana+Victor+Sato) ── valida US-3.1 a US-3.6 ────────────┘
```

**Sequência prática recomendada (10 dias úteis):** **US-3.1 (webhook), US-3.2 (contexto) e US-3.3 (RAG) começam no dia 1 em paralelo** — são as três fundações independentes (Leonardo lidera o webhook com Sato; Victor lidera contexto e RAG, com Leonardo pareando na persistência/RLS e Henrique no container do reranker). US-3.4 (IntentClassifier) dias 2-5, apoiando-se no embedding e na tabela `intent_examples`. US-3.5 (AIResponseWorker — o orquestrador) dias 4-9, consumindo as fundações à medida que estabilizam e **reusando** LLMRouter/ValidationService/outbound da Sprint 2. US-3.6 (handoff + feedback) dias 7-9, sobre o worker. US-3.7 (QA + AI eval + segurança) corre do dia 3 ao 10, fechando a sprint — a suíte adversarial multi-turn e os testes de isolamento de contexto são construídos em paralelo ao código que protegem.

---

## US-3.1 — Webhook de ENTRADA AraraHQ: HMAC + anti-replay + debounce + lock + 200-rápido/enfileira

**Agentes:** Leonardo (lead — `WebhookController`, rawBody, debounce, lock, enqueue) · Sato (valida HMAC/anti-replay/rate limit do webhook — §6/§9.4) · Henrique (colabora — credenciais/allowlist de IP AraraHQ, regra Cloudflare, observabilidade de ingestão).
**Depende de:** US-2.5 (transporte AraraHQ e `WhatsappModule` já existem — esta US adiciona o lado inbound), US-1.7 (fila `ai-response` registrada). É uma das **três US que começam no dia 1**.
**Habilita:** US-3.5 (o `AIResponseWorker` consome o job que este webhook enfileira).

### Jornada

A Sprint 2 foi **outbound-only** e adiou explicitamente o webhook de entrada. Esta US abre a **primeira superfície inbound do sistema** — e, com isso, o vetor de ataque nº 1 do threat model de Sato (T-01: spoofing de webhook). A implementação de Rafael validava assinatura mas **não protegia contra replay** (Sato §6): esta US fecha isso com as **três camadas obrigatórias** — HMAC-SHA256 sobre o **corpo bruto** (o `rawBody` precisa ser preservado antes de qualquer parse; assinar o JSON re-serializado quebra o HMAC) com `timingSafeEqual`; **timestamp assinado** dentro de janela ±5 min, com o timestamp **entrando no cálculo do HMAC**; e **nonce/`messageId` de uso único** em Redis (`SET NX` TTL 600s) para pegar replay dentro da janela. Assinatura inválida ou replay → responde **200** (para não vazar informação ao atacante) e descarta. O webhook **nunca processa IA de forma síncrona**: valida, aplica **debounce** (3-5s, concatenando as mensagens picadas do mesmo usuário num batch — o padrão real do WhatsApp, Rafael §6) sob **Redis lock por `user_id`** (só um job de resposta por usuário por vez; mensagem que chega com job em curso é enfileirada), enfileira em `ai-response` e responde **200 em <1s**. Henrique adiciona a regra Cloudflare (allowlist de IP AraraHQ se houver ranges estáveis) e o `ThrottlerGuard`.

### Objetivo

Ter um `WebhookController` que recebe mensagens da AraraHQ com segurança (HMAC + anti-replay), concatena rajadas por debounce sob lock por usuário, enfileira em `ai-response` e responde 200 em <1s — sem nunca processar IA na thread do webhook.

### Resultado esperado

Um payload legítimo é validado, o batch do usuário é concatenado e enfileirado, e o webhook responde 200 em <1s; um payload forjado (HMAC inválido) é rejeitado; um payload replay (mesmo nonce ou timestamp fora da janela ±5min) é descartado; duas mensagens do mesmo usuário em 2s viram um único job; um retry legítimo da AraraHQ é idempotente.

### Tasks

**TASK-3.1.1 — `WebhookController` com HMAC + timestamp + nonce (anti-replay) (Leonardo + Sato).**
Implementar `POST /webhook/whatsapp` (Sato §6): preservar `rawBody` no `WhatsappModule` (configurar o body-parser do NestJS para manter o corpo bruto **só** neste path); HMAC-SHA256 sobre `timestamp + rawBody` com `timingSafeEqual`; rejeitar se timestamp fora de ±5 min; nonce/`messageId` em Redis via `SET NX` TTL 600s → se já existe, é replay, descarta. Assinatura inválida/replay → **200** (não vazar) + log de segurança (Loki: assinatura inválida, replay detectado). Segredo do webhook via Docker Secret/GitHub Secret.
**Conclusão:** payload forjado rejeitado; replay (nonce repetido / timestamp velho) descartado; HMAC calculado sobre corpo bruto; segredo via secret; eventos de segurança logados.

**TASK-3.1.2 — Debounce + Redis lock por usuário + enqueue (Leonardo).**
Implementar o debounce (janela 3-5s) que concatena as mensagens do mesmo `user_id` num único batch (Rafael §6) e o **Redis lock por `user_id`** (namespaced, helper da Sprint 0): só um job de `ai-response` por usuário roda por vez; mensagem que chega com job em curso é enfileirada para depois, não em paralelo. Enfileirar o batch em `ai-response` e responder **200 em <1s**. Idempotência: retry da AraraHQ sobre o mesmo `messageId` não cria job duplicado (coberto pelo nonce da 3.1.1).
**Conclusão:** rajada de 3-5 msgs vira 1 job; lock impede processamento paralelo por usuário; webhook responde <1s; retry não duplica job.

**TASK-3.1.3 — Rate limit de webhook, allowlist e observabilidade (Henrique + Sato).**
Cloudflare WAF (Rafael §9.4) + `ThrottlerGuard` NestJS no path do webhook; regra Cloudflare para aceitar POST em `/webhook/whatsapp` só de faixas de IP da AraraHQ (allowlist) **se** o provedor publicar ranges estáveis (senão, documentar a limitação). Instrumentar métricas de ingestão (mensagens recebidas, rejeitadas por HMAC, replays, latência do webhook) para o Prometheus/Grafana de Henrique; alerta de pico de assinaturas inválidas (P2 — tentativa de forjar, Sato §6.1).
**Conclusão:** rate limit ativo no webhook; allowlist configurada ou limitação documentada; métricas de ingestão e alerta de assinatura inválida no painel.

### Definição de Pronto (US-3.1 "validada")

- [ ] Tasks 3.1.1–3.1.3 concluídas.
- [ ] Webhook valida HMAC sobre corpo bruto + janela ±5min + nonce único; forjado/replay descartados com 200; debounce+lock por usuário; 200 em <1s; enqueue em `ai-response`; idempotente.
- [ ] Rate limit e (se possível) allowlist de IP ativos; métricas de ingestão instrumentadas.
- [ ] **Validada por:** code review + **revisão de segurança de Sato** (§6/§9.4 — HMAC, replay, rate limit) + testes de payload forjado/replay/debounce/idempotência verdes (US-3.7).

---

## US-3.2 — ContextService: 3 camadas de memória escopadas por usuário ("lembra de ontem")

**Agentes:** Victor (lead — desenho das 3 camadas, montagem do contexto, resumo de sessão longa) · Leonardo (co-implementa a leitura episodic sob RLS, working memory Redis, DI no `AiCoachModule`).
**Depende de:** US-2.2 (PII Scrubber roda na montagem), US-2.4 (protocolos `ACTIVE` persistidos — fonte da episodic memory), US-3.3 (fornece a camada semantic/RAG). É uma das **três US que começam no dia 1** (working + episodic não dependem do RAG pronto; a camada semantic pluga quando US-3.3 estabiliza).
**Habilita:** US-3.5 (o worker chama `ContextService.build` para montar o prompt).

### Jornada

Aqui vive a decisão de produto **"lembra de ontem"** (Épico 4 de Lucas, gap de memória): MOVI precisa ser percebido como **um coach real que acompanha a evolução**, não um chatbot sem memória. Victor implementa o `ContextService` de 3 camadas (§2), montado **por request e escopado ao `user_id`** — nunca reusa objeto de contexto entre jobs (isolamento multi-tenant, Sato §10.3): **(1) Working memory (Redis)** — `session:{user_id}:{yyyy-mm-dd}`, LIST das últimas 10-15 mensagens, TTL 24h renovado a cada mensagem, namespaceada por `user_id`; **(2) Episodic memory (Postgres, sob `SET LOCAL`/RLS)** — a fonte da verdade do estado: protocolo ativo, semana atual, fase, `constraints` (equipamentos/lesões/PAR-Q), `par_q_flags`, últimos 3 ajustes — injetada como **JSON estruturado**, não texto bruto (é o que dá a redução de tokens e já elimina identificadores); **(3) Semantic memory (PGVector)** — RAG, ativada **só** em `DUVIDA_TECNICA` (US-3.3). O **PII Scrubber roda sobre tudo** antes de retornar (mensagem do usuário é campo livre). Sessão >15 turnos dispara um **job assíncrono de resumo** (versão mínima no MVP) que condensa turnos antigos em 2-3 frases persistidas em Postgres, mantendo o Redis com a janela recente + o resumo — controla tokens sem perder continuidade.

### Objetivo

Ter um `ContextService.build(userId, intent, message)` que retorna, escopado ao usuário e já pseudonimizado, o contexto tipado (`cacheablePrefix`, `volatileSuffix`, `ragDocs`) pronto para o LLMRouter — combinando working memory recente, estado episodic sob RLS e (em dúvida técnica) trechos de RAG.

### Resultado esperado

Uma segunda mensagem do usuário no mesmo dia carrega as anteriores (MOVI "lembra"); o estado episodic reflete o protocolo/semana/constraints atuais sob RLS; um job de A nunca lê working/episodic de B; sessão longa é resumida sem estourar o contexto; a saída do serviço nunca contém PII em claro.

### Tasks

**TASK-3.2.1 — Working memory em Redis namespaceada por usuário (Victor + Leonardo).**
Implementar a camada 1 (Victor §2.1): `session:{user_id}:{data}` como LIST (RPUSH `{role,content,ts}`), janela `LRANGE -15 -1`, `LTRIM`, TLL 24h renovado por mensagem. Namespace por `user_id` (Sato §7). Acesso Redis com as proteções da Sprint 0 (requirepass/TLS). Escrita da mensagem do usuário e da resposta de MOVI na sessão.
**Conclusão:** working memory guarda/recupera a janela por usuário; TTL renovado; namespacing impede leitura cruzada; teste de isolamento cross-user verde.

**TASK-3.2.2 — Episodic memory sob RLS + montagem final do contexto (Victor + Leonardo).**
Implementar a camada 2 (Victor §2.2) dentro de `db.transaction` + `SET LOCAL app.current_user_id` (RLS fail-closed, padrão de Sato §4.4/US-1.1): ler protocolo `ACTIVE`, `current_week`, fase corrente, `constraints`, `par_q_flags`, últimos ajustes — como **JSON estruturado**. Implementar `ContextService.build`: working → episodic → (se `DUVIDA_TECNICA`) RAG (US-3.3) → **PII Scrubber sobre tudo** → retorna `{cacheablePrefix, volatileSuffix, ragDocs}` tipado, com o prefixo estável no topo (maximiza cache hit — Victor §1.3). Nunca reusa objeto de contexto entre jobs.
**Conclusão:** episodic lido sob `SET LOCAL`/RLS; contexto montado com prefixo estável + sufixo volátil; PII Scrubber inescapável na saída; isolamento por request comprovado.

**TASK-3.2.3 — Resumo de sessão longa (versão mínima) (Victor + Leonardo).**
Quando a sessão excede ~15 turnos, disparar um **job assíncrono** (GPT-4.1-nano via LLMRouter, roteado como `HEALTH` por segurança) que condensa os turnos antigos em 2-3 frases persistidas em Postgres (`coaching_sessions.summary` ou equivalente); o Redis mantém a janela recente + o resumo. Versão mínima no MVP (sem sumarização sofisticada — não-escopo). Migração da tabela/coluna de resumo sob RLS.
**Conclusão:** sessão longa gera resumo persistido; contexto seguinte usa janela+resumo sem estourar tokens; migração aplica sob RLS.

### Definição de Pronto (US-3.2 "validada")

- [ ] Tasks 3.2.1–3.2.3 concluídas.
- [ ] 3 camadas montadas por request e escopadas ao `user_id`; episodic sob `SET LOCAL`/RLS; PII Scrubber sobre tudo; prefixo estável para caching; resumo de sessão longa mínimo funcionando.
- [ ] Nenhum job lê contexto de outro usuário (working/episodic/semantic).
- [ ] **Validada por:** code review + teste de isolamento cross-tenant de contexto + revisão de Sato (namespacing/RLS) + AI eval de continuidade ("lembra de ontem") verde (US-3.7).

---

## US-3.3 — RAG pipeline: indexação do corpus em PGVector + retrieval + reranker self-hosted

**Agentes:** Victor (lead — chunking, embeddings, retrieval, threshold, reranking) · Leonardo (co-implementa o job de indexação offline, `knowledge_base`, permissões) · Henrique (colabora — container do reranker `bge-reranker-v2-m3`, latência na VPS).
**Depende de:** PGVector (Sprint 0), US-2.2 (embeddings via LLMRouter/endpoint ZDR). É uma das **três US que começam no dia 1**.
**Habilita:** US-3.2 (camada semantic) e US-3.5 (respostas de `DUVIDA_TECNICA` ancoradas em evidência).

### Jornada

O PGVector foi criado na Sprint 0 e ficou **ocioso** — a Sprint 2 injetou a base de referência como contexto estruturado no prompt, sem retrieval. Esta US **ativa o RAG de verdade** (Victor §4), o que dá a MOVI a capacidade de responder dúvidas técnicas ("quanto descanso entre séries?", "como faço agachamento?") **ancorada em literatura curada**, sem alucinar. **Indexação (offline, controlada pela equipe, corpus somente-leitura — Sato §10.4):** corpus de guidelines/revisões (~500-2.000 docs curados, cada um com `reliability` e `topic`), chunking recursivo por estrutura semântica (~400-512 tokens, overlap 15%), embeddings `text-embedding-3-small`, HNSW `m=16/ef_construction=64`. **Retrieval (runtime):** busca densa top-20 com filtro de tópico + threshold cosseno >0.75 → **reranker self-hosted `bge-reranker-v2-m3`** (cross-encoder em CPU, ~100-200ms; **decisão de Victor §4.3 de não adicionar sub-processor** — Cohere Rerank exigiria DPA/SCC e vazaria contexto de saúde) → top-3. **Fail-safe anti-alucinação:** se após rerank nenhum chunk ≥ threshold, **não injeta RAG** e MOVI reconhece o limite ("vou confirmar isso com o profissional") — evita alucinação forçada por contexto irrelevante. Corpus **somente-leitura**: `movivo_app` só SELECT em `knowledge_base`. **Restrição de realidade:** o corpus curado real (com ratificação do RT CREF sobre a confiabilidade das fontes) é insumo clínico/de conteúdo — em dev roda com um corpus-semente pequeno; o corpus definitivo é pré-requisito de qualidade, não de dev.

### Objetivo

Ter um `RAGService` que indexa o corpus curado em PGVector (offline) e, em runtime, recupera top-3 trechos relevantes com threshold + rerank self-hosted para ancorar respostas de dúvida técnica — com fail-safe que prefere "não sei, vou confirmar" a alucinar.

### Resultado esperado

Uma dúvida técnica coberta pelo corpus retorna top-3 trechos relevantes (score ≥ threshold), citáveis; uma dúvida sem cobertura no corpus retorna vazio e MOVI reconhece o limite (não inventa estudo/número); o corpus é somente-leitura; a latência do retrieval+rerank cabe folgada no orçamento de 30s.

### Tasks

**TASK-3.3.1 — Job de indexação offline do corpus (Leonardo + Victor).**
Implementar o job offline autenticado (Victor §4.1, Sato §10.4) que ingere o corpus curado: chunking recursivo (~400-512 tk, overlap 15%), embeddings `text-embedding-3-small` (Batch API para custo), gravação em `knowledge_base` com metadados (`source_url, title, topic, reliability, published_at`) e índice HNSW `m=16/ef_construction=64` `vector_cosine_ops`. Permissão: `movivo_app` só SELECT (a escrita é do job de indexação, role separada). Corpus-semente para dev; corpus real como pré-requisito de qualidade documentado.
**Conclusão:** job indexa o corpus-semente; chunks com embeddings e metadados em `knowledge_base`; índice HNSW criado; `movivo_app` não escreve no corpus (teste de permissão).

**TASK-3.3.2 — Retrieval com threshold + reranker self-hosted (Victor + Henrique).**
Implementar o retrieval runtime (Victor §4.2-4.3): embedding da query → busca densa HNSW top-20 com filtro de `topic` + threshold cosseno >0.75 → **reranker `bge-reranker-v2-m3` self-hosted** (container gerido por Henrique, CPU) → top-3 com score normalizado ≥0.5. **Fail-safe:** nenhum chunk ≥ threshold → retorna vazio (sem RAG). Henrique valida a latência real do reranker na VPS.
**Conclusão:** retrieval retorna top-3 relevantes com threshold; rerank self-hosted em <200ms medido; fail-safe (sem RAG quando irrelevante) testado; nenhum trecho sai para provedor externo além do embedding ZDR.

### Definição de Pronto (US-3.3 "validada")

- [ ] Tasks 3.3.1–3.3.2 concluídas.
- [ ] Corpus indexado (semente) em PGVector, somente-leitura; retrieval top-20→rerank→top-3 com threshold; fail-safe anti-alucinação ativo; reranker self-hosted dentro do orçamento de latência.
- [ ] Corpus real (com confiabilidade ratificada pelo RT CREF) documentado como pré-requisito de qualidade (não bloqueia dev).
- [ ] **Validada por:** code review + revisão de Sato (corpus read-only, boundary de dados) + AI eval de faithfulness do RAG (Mariana/Victor) verde (US-3.7).

---

## US-3.4 — IntentClassifier: guardrail de entrada + embedding-kNN + prompts por intenção

**Agentes:** Victor (lead — guardrail de segurança, classificação híbrida, prompts por intenção) · Leonardo (colabora — `intent_examples` em PGVector, DI).
**Depende de:** US-2.2 (embeddings/nano via LLMRouter). Pode começar no dia 2 (apoia-se no embedding, independente do worker).
**Habilita:** US-3.5 (o worker roteia a mensagem pelo intent para o handler certo).

### Jornada

MOVI não pode tratar toda mensagem igual: "não consigo fazer leg press, tem outro?" (substituição), "como faço agachamento?" (dúvida técnica → RAG), "tô sem vontade hoje" (motivação) e "tô com dor no peito" (**risco clínico → handoff imediato**) exigem caminhos diferentes. Victor implementa o classificador de duas etapas (§3.2) precedido por um **guardrail de segurança de entrada**: **Etapa 0** — regex leve (<1ms) que detecta padrões de **alto risco clínico** (dor no peito, "tô passando mal", nomes de medicamento, ideação de automutilação) e **força `FORA_DE_ESCOPO`/handoff imediato antes de qualquer custo de IA** (fail-safe clínico); **Etapa 1** — embedding-kNN (`text-embedding-3-small` endpoint ZDR, kNN contra centróides rotulados em `intent_examples`, ~40-60ms) classifica se a confiança for alta; **Etapa 2** — fallback GPT-4.1-nano (JSON mode, `max_tokens=20`) só nos ~10-20% ambíguos. Taxonomia: `DUVIDA_TECNICA`, `SUBSTITUICAO_EXERCICIO`, `MOTIVACAO`, `CHECKIN_ANTECIPADO` (detectado, mas o **ajuste de protocolo é Sprint 5** — responde com a estrutura de 3 quick replies e informa que o ajuste vem no check-in), `FORA_DE_ESCOPO`, + operacionais (`SAUDACAO`, `RELATO_TREINO` que fecha o loop do aha moment, `PEDIDO_HANDOFF`). Cada intent tem um **template de sistema versionado em `prompts/`**, todos herdando o **bloco base de guardrails** (Victor §7.1 — regras invioláveis, transparência de IA, `<mensagem_usuario>` como dado ≠ instrução).

### Objetivo

Ter um `IntentClassifier` que, com guardrail clínico de entrada + embedding-kNN + fallback nano, roteia cada mensagem à intenção correta a custo/latência mínimos — e um conjunto de prompts por intenção versionados que instruem MOVI a verbalizar sem decidir.

### Resultado esperado

Uma mensagem com sinal de risco clínico é forçada a handoff antes de qualquer custo de IA; mensagens comuns são classificadas por embedding a fração de centavo; casos ambíguos caem no nano; cada intent aciona seu prompt especializado; o prompt de `SUBSTITUICAO_EXERCICIO` instrui a IA a só verbalizar o substituto da base (não decidir).

### Tasks

**TASK-3.4.1 — Guardrail de entrada + classificação híbrida (Victor + Leonardo).**
Implementar a Etapa 0 (regex de risco clínico → `FORA_DE_ESCOPO`/handoff, <1ms), a Etapa 1 (embedding-kNN contra `intent_examples` em PGVector, ~30 exemplos/intent, similaridade cosseno, margem ≥0.15 e score ≥0.55) e a Etapa 2 (fallback nano JSON `max_tokens=20`). `intent_examples` versionada e cresce com red-team/logs. Registrar `intent` em `ai_jobs`.
**Conclusão:** risco clínico forçado a handoff antes de custo de IA; casos claros classificados por embedding; ambíguos caem no nano; `intent` logado; `intent_examples` versionada.

**TASK-3.4.2 — Prompts por intenção versionados + bloco base de guardrails (Victor).**
Escrever os templates de sistema por intenção em `prompts/` (Victor §3.3), todos herdando o **bloco base de guardrails** (§7.1): `DUVIDA_TECNICA` (responde só com base nos trechos RAG + protocolo; sem inventar estudo), `SUBSTITUICAO_EXERCICIO` ("apenas explique a troca do substituto `{X}` já escolhido na base; NÃO sugira exercício fora da lista" — a IA verbaliza, não decide), `MOTIVACAO` (tom Companheiro, curto, 1 pergunta de baixo atrito), `CHECKIN_ANTECIPADO` (3 quick replies, abre com vitória; **informa que o ajuste vem no check-in** — Sprint 5), `FORA_DE_ESCOPO` (**não chama LLM generativo** — resposta-padrão pré-aprovada + handoff). Transparência de IA na 1ª mensagem. Prompts versionados (semver) — mudança dispara reavaliação.
**Conclusão:** cada intent tem prompt versionado herdando os guardrails; substituição instrui verbalização (não decisão); fora-de-escopo não chama LLM; transparência de IA presente.

### Definição de Pronto (US-3.4 "validada")

- [ ] Tasks 3.4.1–3.4.2 concluídas.
- [ ] Guardrail clínico de entrada + embedding-kNN + fallback nano roteando corretamente; `intent` logado; `intent_examples` e prompts versionados.
- [ ] Prompts por intenção herdam o bloco base de guardrails; substituição = verbalização; fora-de-escopo sem LLM generativo; `CHECKIN_ANTECIPADO` não promete ajuste nesta sprint.
- [ ] **Validada por:** code review + revisão de Sato (guardrail de entrada, delimitação de dado) + AI eval de acurácia de intenção (Mariana/Victor) verde (US-3.7).

---

## US-3.5 — AIResponseWorker: orquestração da resposta conversacional (reusa LLMRouter + ValidationService + outbound)

**Agentes:** Leonardo (lead — processor da fila, orquestração, persistência de `conversations`, DLQ) · Victor (colabora — encadeia intent→contexto→RAG→LLMRouter→ValidationService, tuning de prompt).
**Depende de:** US-3.1 (recebe o job), US-3.2 (contexto), US-3.3 (RAG), US-3.4 (intent), e **REUSA** US-2.2 (LLMRouter+PII Scrubber), US-2.3 (ValidationService), US-2.5 (outbound). É o **orquestrador** — começa dia 4.
**Habilita:** US-3.6 (handoff/feedback penduram na saída do worker) e o valor conversacional inteiro do Épico 4.

### Jornada

Este é o **coração da sprint**: o `AIResponseWorker` sobre a fila `ai-response` (parâmetros da US-1.7 — conc., lock, retries, DLQ) que transforma uma mensagem recebida numa resposta de MOVI. O fluxo (Rafael, Victor §2.4/§5): recebe o batch do job → **IntentClassifier** (US-3.4) → **ContextService.build** (US-3.2, monta 3 camadas + RAG se dúvida técnica, tudo pseudonimizado) → **LLMRouter.complete** (US-2.2, GPT-4.1→Claude ZDR, `max_tokens=500`, cache do prefixo) → **ValidationService** (US-2.3 — **veta a resposta**: sem diagnóstico/prescrição/promessa/violação-PAR-Q/leak; substituição de exercício confirmada contra a base de referência; termos proibidos de Sofia §13) → se PASS/FLAG envia via `whatsapp-outbound` (US-2.5, bolhas + "digitando…"), se BLOCK envia **resposta-padrão pré-aprovada** + `human_review_required=true`; persiste em `conversations` (sender user/ai, texto, `job_id`, `validation_action`) e loga tudo em `ai_jobs` (provider/model/tokens/latência/custo/intent/`validation_action`). **Anti-abuso (Sato §9.4):** o counter de **50 msg/dia por usuário** (herdado da US-2.2.4) é agora o **teto operacional real** — acima dele, resposta gentil de limite **sem** chamar o LLM. **Substituição de exercício** é o caso que exige atenção de produto: MOVI **nunca inventa** — busca o substituto na base (US-2.1, mesmo padrão de movimento/nível/equipamento, nunca contraindicado) e verbaliza; o validador confirma. **Recusa honesta:** `FORA_DE_ESCOPO` responde com limite claro + recurso externo, sem LLM generativo. SLA ≤30s p95, com "digitando…" imediato mascarando a latência.

### Objetivo

Ter o `AIResponseWorker` orquestrando ponta a ponta a resposta conversacional — intent→contexto→(RAG)→LLM→validação→outbound — reusando as peças da Sprint 2, respeitando o teto de 50 msg/dia, persistindo a conversa e cumprindo ≤30s p95, com fallback no BLOCK e DLQ.

### Resultado esperado

Uma pergunta de substituição recebe um substituto válido da base verbalizado por MOVI; uma dúvida técnica recebe resposta ancorada no RAG (ou o reconhecimento honesto do limite); uma tentativa de obter diagnóstico/prescrição é **bloqueada** e recebe resposta-padrão; um usuário no 51º msg do dia recebe aviso de limite sem custo de LLM; a conversa é persistida; um job que falha além dos retries cai na DLQ com fallback; p95 ≤30s.

### Tasks

**TASK-3.5.1 — Processor da fila `ai-response` e orquestração do fluxo (Leonardo + Victor).**
Implementar o processor sobre o `WorkerFactory`/parâmetros da US-1.7: intent (US-3.4) → contexto (US-3.2) → RAG se `DUVIDA_TECNICA` (US-3.3) → **LLMRouter** (US-2.2, `purpose='AI_RESPONSE'`, `dataClass=HEALTH`, `max_tokens=500`) → **ValidationService** (US-2.3, veta a resposta) → `whatsapp-outbound` (US-2.5). Emitir "digitando…" imediato (via outbound) ao pegar o job. Persistir `conversations` (sender, texto, `job_id`, `validation_action`) sob RLS; logar `ai_jobs` completo e pseudonimizado.
**Conclusão:** fluxo intent→contexto→(RAG)→LLM→validação→outbound roda; "digitando…" imediato; conversa persistida sob RLS; `ai_jobs` logado; reusa (não reimplementa) LLMRouter/ValidationService/outbound.

**TASK-3.5.2 — Substituição de exercício segura + recusa/fora-de-escopo (Leonardo + Victor).**
Para `SUBSTITUICAO_EXERCICIO`: buscar o substituto **na base de referência** (US-2.1 — mesmo padrão de movimento, dentro do nível/equipamento do usuário, **nunca contraindicado** por lesão/PAR-Q) e passar à IA **apenas para verbalizar**; o ValidationService confirma que o substituto pertence à base (senão BLOCK). Para `FORA_DE_ESCOPO`: resposta-padrão pré-aprovada (limite claro + recurso externo: "isso foge do que eu posso orientar com segurança; melhor falar com [médico/o profissional responsável]"), **sem LLM generativo**. Copy dentro dos guardrails.
**Conclusão:** substituição só usa exercício da base, nunca contraindicado, verbalizada (não decidida); fora-de-escopo responde com limite honesto sem LLM; validador bloqueia substituto fora da base.

**TASK-3.5.3 — Teto de 50 msg/dia, fallback (BLOCK), DLQ e SLA (Leonardo + Sato ref.).**
Aplicar o **teto de 50 msg/dia por usuário** (counter Redis da US-2.2.4, agora operacional) — acima do teto, resposta gentil de limite **sem** chamar o LLM (Sato §9.4, LLM10). No BLOCK do validador: enviar resposta-padrão pré-aprovada + `human_review_required=true` + evento `ai_response_blocked` (PostHog). Job que falha além dos retries → **DLQ** + fallback (mensagem de "já te respondo" dentro dos guardrails). Instrumentar SLA submit-msg→resposta e emitir métrica para o alvo ≤30s p95.
**Conclusão:** 51ª msg/dia recebe limite sem custo de LLM; BLOCK cai em resposta-padrão + evento; DLQ dispara fallback; métrica de SLA emitida; teste cobre limite/BLOCK/DLQ.

### Definição de Pronto (US-3.5 "validada")

- [ ] Tasks 3.5.1–3.5.3 concluídas.
- [ ] Worker orquestra intent→contexto→(RAG)→LLMRouter→ValidationService→outbound, reusando a Sprint 2; conversa persistida sob RLS; `ai_jobs` logado; "digitando…" imediato.
- [ ] Substituição segura (só base, nunca contraindicado, verbalizada); recusa honesta sem LLM; teto de 50 msg/dia; BLOCK→resposta-padrão; DLQ com fallback; p95 ≤30s instrumentado.
- [ ] **Validada por:** code review + **revisão de segurança de IA de Sato** (reuso do validador na saída, anti-abuso) + teste de integração (substituição/dúvida/motivação/BLOCK/limite/DLQ) verde (US-3.7).

---

## US-3.6 — Handoff humano CREF + feedback (thumbs) + loop de engajamento

**Agentes:** Leonardo (lead — persistência do estado de handoff, captura de feedback) · Felipe (colabora — captura de thumbs no WhatsApp/instrumentação) · Alexandre (valida o modelo de handoff e o direito de contestação/AI Act).
**Depende de:** US-3.5 (o worker é onde handoff e feedback penduram). Começa dia 7.
**Habilita:** a Sprint 5 (o painel CREF consome o estado de handoff persistido aqui) e a medição dos critérios de aceite do Épico 4 (CSAT ≥80%, 2ª msg no mesmo dia ≥40%).

### Jornada

Duas peças de produto que fecham o Épico 4 e alimentam as próximas sprints. **(1) Handoff humano CREF:** quando MOVI recebe um pedido explícito ("quero falar com o profissional" — `PEDIDO_HANDOFF`, direito de contestação/AI Act, Alexandre), detecta sinal de dor anormal/risco (guardrail da US-3.4) ou o validador dá FLAG, o sistema **persiste um estado de handoff consultável** (flag em `conversations` + registro do motivo) e o usuário vê uma mensagem clara e acolhedora ("vou pedir pro profissional responsável olhar isso com você — te retorno em breve"), **sem alarme e sem diagnóstico** (guardrails). A **decisão de produto crítica:** o **painel do profissional (a UI, a resposta humana, a notificação em tempo real) é Sprint 5** — nesta sprint **apenas se persiste o estado** que a Sprint 5 vai consumir. Alexandre valida que o modelo de handoff satisfaz o direito de contestação. **(2) Feedback (thumbs) + engajamento:** cada resposta de MOVI pode receber 👍/👎 (quick reply/reação) → PostHog, para medir **CSAT ≥80%** (Épico 4); e instrumentar o evento de **2ª mensagem do usuário no mesmo dia** para medir engajamento conversacional ≥40% (Épico 4). O loop de engajamento (MOVI abre com vitória, 1 pergunta de baixo atrito) já vem dos prompts da US-3.4 — aqui garante-se a **medição**.

### Objetivo

Ter o estado de handoff CREF persistido e consultável (com a mensagem certa ao usuário), o direito de contestação atendido, e a captura de feedback (thumbs) + os eventos de engajamento instrumentados para medir os critérios de aceite do Épico 4.

### Resultado esperado

Um pedido de handoff / sinal de risco / FLAG persiste um estado consultável e o usuário recebe a mensagem acolhedora sem diagnóstico; o profissional (na Sprint 5) conseguirá listar os handoffs pendentes; cada resposta capta 👍/👎 em PostHog; o evento de 2ª mensagem no mesmo dia é medido.

### Tasks

**TASK-3.6.1 — Estado de handoff persistido + mensagem ao usuário (Leonardo + Alexandre).**
Ao detectar `PEDIDO_HANDOFF`, sinal de risco (guardrail US-3.4) ou FLAG do validador: persistir estado de handoff consultável (flag + motivo + timestamp em `conversations`/tabela de handoff, sob RLS) e enviar ao usuário a mensagem acolhedora dentro dos guardrails (sem alarme, sem diagnóstico, respaldo CREF visível). Emitir evento `handoff_requested` (PostHog). **A tela/resposta humana é Sprint 5** — aqui só o estado. Alexandre valida o modelo (direito de contestação/AI Act).
**Conclusão:** handoff persiste estado consultável + motivo; usuário recebe mensagem nos guardrails; evento emitido; Alexandre valida o modelo por escrito; sem UI de painel (Sprint 5).

**TASK-3.6.2 — Captura de feedback (thumbs) + eventos de engajamento (Felipe + Leonardo).**
Capturar 👍/👎 por resposta de MOVI (quick reply/reação do WhatsApp) → PostHog (`ai_response_feedback`), para o **CSAT ≥80%** (Épico 4). Instrumentar `whatsapp_user_second_message_same_day` (2ª msg no mesmo dia — engajamento ≥40%, Épico 4) e os eventos de conversa relevantes. Garantir que o feedback é escopado ao usuário e não altera estado de treino.
**Conclusão:** thumbs capturado e enviado ao PostHog por interação; evento de 2ª msg/dia instrumentado; feedback não altera treino; eventos escopados por usuário.

### Definição de Pronto (US-3.6 "validada")

- [ ] Tasks 3.6.1–3.6.2 concluídas.
- [ ] Handoff persiste estado consultável + mensagem acolhedora nos guardrails; direito de contestação atendido; painel humano fica para a Sprint 5.
- [ ] Thumbs (CSAT) e evento de 2ª msg/dia instrumentados no PostHog.
- [ ] **Validada por:** code review + **validação de Alexandre** (modelo de handoff/contestação) + revisão de copy (Sofia/guardrails) + teste dos eventos verde (US-3.7).

---

## US-3.7 — QA, avaliação de qualidade de IA da conversa e revisão de segurança de IA

**Agentes:** Mariana (lead — testes, cobertura, quality gates, AI evaluation do diálogo) · Victor (golden set conversacional, faithfulness, framework — §6) · Sato (revisão de segurança de IA: webhook, prompt injection multi-turn, anti-abuso, isolamento — §6/§9.4/§10).
**Depende de:** US-3.1 a US-3.6 (há o que testar). **Alimenta** o CI (quality gate).
**Habilita:** a entrada segura da Sprint 3 em `main` e a disciplina de qualidade de IA conversacional das próximas sprints.

### Jornada

A Sprint 3 é a primeira com **IA respondendo síncrono ao usuário sobre dado de saúde** e com **superfície inbound aberta** — o que amplia a superfície de risco: injeção agora pode vir **multi-turn** (o atacante constrói o jailbreak ao longo de várias mensagens), e o contexto de conversa é um novo vetor de vazamento cross-user. Mariana **estende** o golden set (as 20 FAQs de Lucas + casos conversacionais: substituição, dúvida técnica, motivação, fora-de-escopo, dor anormal) e a **suíte adversarial ao diálogo** (promptfoo/garak: injeção multi-turn, jailbreak progressivo, extração de PII na conversa, leak de system prompt ou de dado de outro usuário via memória/RAG) como **quality gate bloqueante** — safety = 0 vazamentos (Victor §6.2, Sato §10.5). Mede **faithfulness do diálogo** (resposta de dúvida técnica ancorada nos chunks RAG sem inventar; substituição fiel à base; 0% de orientação médica direta), a **continuidade** ("lembra de ontem" funciona) e o **isolamento de contexto de conversa** (nenhum job de A injeta working/episodic/RAG de B). Reforça que o **100% de cobertura do `ValidationService`** (US-2.3) continua bloqueante — agora com os casos de saída conversacional. Mede o **custo de IA por usuário** (deve seguir dentro do teto ~R$1,08/mês). Sato registra a revisão consolidada da segurança de IA da conversa (webhook, boundary, anti-abuso, guardrails multi-turn).

### Objetivo

Cobertura ≥80% do código novo (100% no `ValidationService` mantido), suíte adversarial multi-turn bloqueante (0 vazamentos), faithfulness do diálogo comprovada, isolamento de contexto de conversa, teto de 50 msg/dia e HMAC/anti-replay testados, custo dentro do teto, e revisão de segurança de IA de Sato registrada — tudo no CI.

### Resultado esperado

O CI reprova qualquer PR que: quebre o isolamento de contexto de conversa, deixe passar injeção multi-turn/leak/PII na safety suite, derrube a faithfulness do diálogo abaixo da meta, permita substituição de exercício fora da base, deixe passar orientação médica direta, quebre o HMAC/anti-replay do webhook, ou derrube a cobertura global abaixo de 80% (100% no `ValidationService`); o fluxo conversacional (feliz/BLOCK/handoff/limite/DLQ) tem teste de integração verde; a revisão de Sato está anexada.

### Tasks

**TASK-3.7.1 — Golden set conversacional e faithfulness do diálogo (Mariana + Victor).**
Estender o golden set (20 FAQs + casos conversacionais: substituição, dúvida técnica RAG, motivação, fora-de-escopo, dor anormal→handoff) e o teste de **faithfulness do diálogo**: resposta de dúvida técnica **ancorada nos chunks RAG** (RAGAS-style, LLM-as-judge com Claude Opus como juiz + amostra humana), substituição **fiel à base** (nunca exercício fora da base/contraindicado), **0% de orientação médica direta**. Meta faithfulness ≥0.9, accuracy ≥90%, CSAT-alvo ≥80%. **Gate bloqueante.**
**Conclusão:** golden set conversacional versionado; teste de faithfulness roda no CI e bloqueia; resposta que inventa estudo, foge da base ou dá orientação médica falha.

**TASK-3.7.2 — Suíte adversarial multi-turn como gate bloqueante (Mariana + Sato + Victor).**
Estender a suíte promptfoo/garak ao diálogo (Sato §10.5, Victor §6.2): injeção **multi-turn** (jailbreak construído ao longo de mensagens), extração de PII na conversa, leak de system prompt e de dado de outro usuário **via memória/RAG**, tentativa de fazer MOVI prescrever/diagnosticar. Incluir o caso do webhook forjado/replay (US-3.1) e o campo de mensagem malicioso. **Gate bloqueante:** safety = 0 vazamentos.
**Conclusão:** suíte adversarial multi-turn no CI; 0 vazamentos exigido; um jailbreak multi-turn plantado que passe **falha** o pipeline.

**TASK-3.7.3 — Isolamento de contexto de conversa + 100% do ValidationService (Mariana).**
Testes de **isolamento multi-tenant do contexto de conversa**: um job de resposta de A nunca lê/injeta working (Redis), episodic (Postgres/RLS) ou RAG de B; `input_snapshot` escopado. Manter o gate de **100% de cobertura do `ValidationService`** ativo, agora com os casos de saída conversacional (substituição fora da base, diagnóstico/prescrição/promessa/leak no diálogo). Marcar ambos como bloqueantes.
**Conclusão:** vazamento cross-tenant de contexto de conversa falha o pipeline; 100% do `ValidationService` mantido e bloqueante com os novos casos.

**TASK-3.7.4 — Teste de integração do fluxo conversacional + webhook (Mariana + Leonardo).**
Integração ponta a ponta: webhook (HMAC válido/forjado/replay, debounce) → job → intent → contexto → (RAG) → LLM → validação → outbound (feliz); o caminho **BLOCK** (resposta-padrão); o **handoff** (estado persistido); o **limite de 50 msg/dia**; e a **DLQ** (falha persistente → fallback). Cobrir a idempotência do webhook e do outbound e a métrica de SLA (≤30s p95).
**Conclusão:** integração dos caminhos (feliz/BLOCK/handoff/limite/DLQ) + webhook (válido/forjado/replay/debounce) verde local e no CI.

**TASK-3.7.5 — Custo de IA da conversa, revisão de Sato e atualização de gates (Mariana + Sato + Victor).**
Medir o **custo de IA por usuário** com a conversa real (`sum(cost_brl)` de `ai_jobs`) e confirmar dentro do teto (~R$1,08/usuário/mês, ≤15% do ARPU — Victor §8/Eduardo). Sato registra a **revisão de segurança de IA consolidada da conversa** (webhook HMAC/replay, boundary/Scrubber, anti-abuso 50 msg/dia, guardrails multi-turn, isolamento — §6/§9.4/§10). Atualizar o documento de quality gates: "faithfulness do diálogo", "safety multi-turn", "isolamento de contexto de conversa" e "HMAC/anti-replay do webhook" como **ativos/bloqueantes**.
**Conclusão:** custo medido dentro do teto; revisão de Sato registrada; documento de gates atualizado.

### Definição de Pronto (US-3.7 "validada")

- [ ] Tasks 3.7.1–3.7.5 concluídas.
- [ ] Faithfulness do diálogo ≥0.9, 0% orientação médica direta, safety multi-turn = 0 vazamentos; isolamento de contexto de conversa e 100% do `ValidationService` bloqueantes; integração (feliz/BLOCK/handoff/limite/DLQ) + webhook verde; custo dentro do teto.
- [ ] Cobertura ≥80% global; gates integrados ao CI.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de IA de Sato registrada** + Victor confirma faithfulness/custo + CI verde com os novos gates ativos.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-3.1 | Webhook de ENTRADA (HMAC + anti-replay + debounce + lock) | **Leonardo** | Henrique (IP/Cloudflare/obs.), Sato (segurança) | **Sato (HMAC/replay/rate limit)** + Mariana |
| US-3.2 | ContextService 3 camadas escopado por usuário | **Victor** | Leonardo (RLS/Redis/DI) | Sato (isolamento) + AI eval continuidade (Mariana) |
| US-3.3 | RAG pipeline (indexação PGVector + retrieval + reranker) | **Victor** | Leonardo (indexação/`knowledge_base`), Henrique (reranker) | Sato (corpus read-only) + AI eval faithfulness (Mariana) |
| US-3.4 | IntentClassifier + guardrail de entrada + prompts por intenção | **Victor** | Leonardo (`intent_examples`/DI) | Sato (guardrail de entrada) + AI eval acurácia (Mariana) |
| US-3.5 | AIResponseWorker (orquestra a resposta; reusa Sprint 2) | **Leonardo** | Victor (encadeia IA/prompt) | **Sato (segurança de IA)** + integração (Mariana) |
| US-3.6 | Handoff humano CREF + feedback (thumbs) + engajamento | **Leonardo** | Felipe (thumbs/instrumentação), Sofia (UX ref.) | **Alexandre** (handoff/contestação) + copy/guardrails + Mariana |
| US-3.7 | QA + AI eval de conversa + segurança de IA | **Mariana** | Victor, Sato, Leonardo | Mariana + **Sato** + Victor + gate no CI |

> **Leonardo carrega a orquestração** (webhook US-3.1 + worker US-3.5) — as duas peças de backend mais pesadas da sprint. **Victor (IA)** é responsável (R) por contexto, RAG e intent (US-3.2 a US-3.4) e colabora no worker (US-3.5). **Sato** valida a segurança de IA de ponta a ponta (webhook HMAC/replay, prompt injection multi-turn, anti-abuso 50 msg/dia, isolamento) — **é o validador central da sprint que abre a superfície inbound**. **Alexandre** valida o modelo de handoff (direito de contestação/AI Act). **Henrique** tem participação em infra (allowlist/Cloudflare do webhook, container do reranker, observabilidade). **Felipe** tem carga leve (captura de thumbs/instrumentação — não há tela nova nesta sprint; o painel CREF é Sprint 5).

## Critério de conclusão da Sprint 3 (aceite do Épico 4)

A Sprint 3 é **entregue** quando as 7 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. O **webhook de entrada** valida HMAC sobre corpo bruto + janela ±5min + nonce único, aplica debounce+lock por usuário, responde 200 em <1s e enfileira em `ai-response`; forjado/replay descartados.
2. O **ContextService** monta 3 camadas escopadas por usuário (working Redis + episodic Postgres/RLS + semantic PGVector), com PII Scrubber inescapável e resumo de sessão longa; MOVI "lembra de ontem"; nenhum job lê contexto de outro usuário.
3. O **RAG** está ativo (indexação + retrieval + reranker self-hosted + threshold + fail-safe anti-alucinação), corpus somente-leitura.
4. O **IntentClassifier** roteia com guardrail clínico de entrada + embedding-kNN + fallback nano; prompts por intenção versionados herdam os guardrails; substituição = verbalização (não decisão).
5. O **AIResponseWorker** orquestra intent→contexto→(RAG)→**LLMRouter**→**ValidationService**→outbound **reusando a Sprint 2**; substituição só usa exercício da base (nunca contraindicado); fora-de-escopo recusa com honestidade; teto de 50 msg/dia; BLOCK→resposta-padrão; DLQ com fallback; **≤30s p95**; **0% de orientação médica direta**.
6. O **handoff humano CREF** persiste estado consultável (o painel é Sprint 5) e atende o direito de contestação; **feedback (thumbs)** e o evento de 2ª msg/dia instrumentados (CSAT ≥80%, engajamento ≥40%).
7. **Quality gate de IA da conversa** bloqueante: faithfulness do diálogo ≥0.9, safety multi-turn = 0 vazamentos, isolamento de contexto de conversa, 100% do `ValidationService` mantido; custo dentro do teto (~R$1,08/usuário/mês).
8. CI verde; cobertura ≥80% (100% no `ValidationService`); toda entrega via PR + 6 checks (`main` protegida); revisão de segurança de IA de Sato registrada.

### Pré-requisitos / bloqueadores a resolver no início da sprint

- **[Segredos — Henrique/Alexandre] Segredo do webhook AraraHQ + confirmação do esquema de assinatura/timestamp/nonce do provedor.** A implementação de HMAC/anti-replay (US-3.1) precisa do formato real que a AraraHQ envia (header de assinatura, se inclui timestamp, se há `messageId` para nonce). Em dev roda com mock/fixture; **o formato real é bloqueador do inbound em produção** (não bloqueia dev). Segredo via Docker/GitHub Secrets, nunca `environment:`.
- **[Conteúdo clínico — RT CREF/Victor] Corpus RAG curado + confiabilidade das fontes ratificada pelo RT CREF** (US-3.3): é insumo clínico/de conteúdo, não de engenharia. Em dev roda com corpus-semente; o **corpus definitivo aprovado pelo RT é pré-requisito de qualidade** (faithfulness real) antes do lançamento.
- **[Conteúdo — Alexandre/RT CREF] Respostas-padrão pré-aprovadas de fora-de-escopo/recusa e a mensagem de handoff** (US-3.5/US-3.6): quando MOVI recusa ou encaminha, usa texto aprovado dentro dos guardrails — precisa existir aprovado antes do lançamento.
- **[Decisão de produto/jurídica — Alexandre] Modelo de handoff e direito de contestação** (US-3.6): confirmar formalmente o que dispara handoff, o que o usuário vê, e como o estado fica consultável para o painel da Sprint 5. Não bloqueia dev; bloqueia o lançamento do inbound.
- **[Infra — Henrique] Container do reranker self-hosted (`bge-reranker-v2-m3`) e validação de latência na VPS** (US-3.3): decisão de Victor §4.3; precisa caber no orçamento de 30s. Validar cedo.
- **[Realidade de dev] Chaves reais/ZDR/DPA/SCC, conta AraraHQ e ratificação CREF do corpus/respostas são bloqueadores de LANÇAMENTO, não de dev.** O desenvolvimento da Sprint 3 roda com **mocks/fakes** (webhook simulado, chaves de teste, corpus-semente, respostas-padrão provisórias) — consistente com a memória do projeto ("dev local, não produção"). Deixar isto explícito em cada peça que toca o boundary externo.
- **[Marca] Go-live com usuário real permanece condicionado à liberação INPI (MOVIVO × VIVO)** — trava herdada. Construir e testar a conversa é liberado; **entrega a usuário real** depende do parecer de PI (não bloqueia esta sprint de desenvolvimento).

### Handoff para a Sprint 4/5

Concluída a Sprint 3, o AI Coach conversacional está completo e testado. As próximas sprints recebem: o `AIResponseWorker`, o `ContextService` de 3 camadas, o RAG e o `IntentClassifier` prontos; a intenção `CHECKIN_ANTECIPADO` **detectada** (esperando a **Sprint 5** implementar o `CheckinWeeklyWorker` + cron/`repeat` + o **ajuste de protocolo** que ela dispara); o estado de **handoff persistido** (esperando o **Dashboard CREF da Sprint 5** — UI, resposta humana, notificação Socket.io, tratamento das exceções e das sessões `BLOCKED_PENDING_CLEARANCE` da Sprint 2); e o canal conversacional engajado (esperando a **Sprint 4** implementar a conversão trial→pago / `SUBSCRIPTION` / `ConversionSequenceWorker` sobre ele). A suíte adversarial multi-turn (US-3.7) protege também as futuras respostas de check-in. Este documento cobre **apenas** a Sprint 3; o planejamento das Sprints 4/5 será feito por Lucas depois, com o aprendizado desta.

---

*Documento de planejamento operacional da Sprint 3 — Lucas Monteiro (PM/PO). Escopo: Épico 4 de `08-relatorio-lucas.md` (Conversa com AI Coach) + o webhook de ENTRADA que a Sprint 2 adiou. Camada de IA conversacional de `12-relatorio-victor.md` (ContextService §2, IntentClassifier §3, RAG §4, guardrails §7 — reusa LLMRouter/ValidationService/PII Scrubber já entregues). Segurança de entrada e de IA de `11-relatorio-sato.md` §6 (HMAC + anti-replay), §9.4 (anti-abuso 50 msg/dia), §10 (prompt injection). Persona MOVI, tom, escopo/handoff e quebra de mensagens de `09-relatorio-sofia.md` §11/§13. Supervisão CREF e direito de contestação de `06-relatorio-alexandre.md`. Teto de custo de `07-relatorio-eduardo.md`. Construído sobre a fundação das Sprints 0-2 (LLMRouter, ValidationService, outbound AraraHQ, fila `ai-response`, protocolos `ACTIVE`). **Decisão de foco: check-in semanal (ajuste de protocolo) e conversão/pagamento ficam explicitamente fora — a Sprint 3 entrega a conversa + a entrada.***
