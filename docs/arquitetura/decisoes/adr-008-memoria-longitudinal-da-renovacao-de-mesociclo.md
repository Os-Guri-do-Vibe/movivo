# ADR-008 — Memória longitudinal da renovação de mesociclo

**Status:** Proposta

**Data:** 2026-09-11

**Autor:** Victor (Distinguished AI Engineer)

**Escopo:** pipeline de renovação de mesociclo (`ProtocolRenewalGenerationWorker` +
`ProtocolGeneratorService`). Não altera a ADR-005-R2 (seleção de provedor) nem a estratégia de
IA geral do `12-relatorio-victor.md`.

**Relacionada:** ADR-005-R2 (gate neutro por provedor / preços), `ARQUITETURA.md` §3.1

---

## Contexto

O worker de renovação hoje monta o contexto do LLM a partir de três fontes apenas:

1. O protocolo **imediatamente anterior** (`previousProtocolId`) — fase, duração e a
   `constraints` JSONB herdada em cascata.
2. As respostas dos 5 blocos do formulário de renovação — **autorrelato retrospectivo**.
3. `constraints.continuation.summary`, uma narrativa em PT-BR montada por
   `buildContinuationSummary()` e injetada como mensagem `user` para o modelo interpretar
   livremente, **sem nenhuma regra determinística associada**.

Três consequências foram confirmadas por leitura de código, não por hipótese:

- **Não existe visão de periodização.** O modelo vê N-1 e nada antes disso. Não há como
  ele perceber "este aluno fez HIPERTROFIA três mesociclos seguidos sem deload" ou
  "já tentamos FORCA no M4 e a aderência despencou".
- **A evidência real de execução não chega.** `workout_sessions`, `workout_set_entries`,
  `workout_completions` e `checkins` existem e são populados — carga real por série,
  repetições reais, RPE real, dor por sessão, comentário livre — e **nenhuma linha
  dessas tabelas é lida pelo pipeline de renovação**. O sistema decide o próximo
  mesociclo usando a *percepção* do aluno sobre o ciclo, ignorando o *registro* do ciclo.
- **Três campos coletados morrem no banco:** `newPain.soughtCare`, `barrierOther` e
  `goalChange.newGoalOther`. Este último é o pior caso: `toGenerationGoal('OTHER')`
  mapeia sempre para `CONDITIONING` e o texto real do aluno é descartado do fluxo de
  geração.

A tentação óbvia — "manda o histórico todo no prompt" — é inviável por três motivos
independentes, e o de custo **não é o principal**.

### Por que "mandar tudo cru" está errado

**(a) Custo cresce quadraticamente ao longo da assinatura.** Cada renovação reenviaria
todo o histórico acumulado. Estimativa por mesociclo de 6 semanas, 4 sessões/semana:

| Artefato bruto | Volume | Tokens (serialização compacta) |
|---|---:|---:|
| `ProtocolStructure` do mesociclo | 4 sessões × ~6 exercícios | ~2.200 |
| `workout_set_entries` | ~500 linhas (24 sessões × 6 ex. × 3,5 séries) | ~8.000 |
| `workout_sessions` (duração, RPE, dor, feedback) | 24 linhas | ~1.000 |
| `checkins` semanais | 6 linhas | ~700 |
| **Total por mesociclo** | | **~11.900** |

A ~8,7 renovações/ano, o histórico acumulado chega a **~104k tokens no ano 1** e
**~204k tokens no ano 2**, somados ao baseline atual de ~20k tokens de prompt
(metodologia ~3,4k + catálogo filtrado ~10k + RAG 18k chars ≈ 5,1k + schema/instruções ~1,5k).

**(b) O custo explode no fallback, não no candidato principal.** Aos preços da
ADR-005-R2 e `LLM_USD_BRL_RATE=5.5`:

| Cenário (renovação nº 17, ~2 anos) | DeepSeek V4 Pro | GPT-4.1 | Claude Sonnet 4.5 |
|---|---:|---:|---:|
| Baseline atual (~20k in / 4k out) | R$0,07 | R$0,40 | R$0,66 |
| Histórico bruto (~224k in / 4k out) | R$0,56 | **R$2,64** | **R$3,70** |

Uma única renovação no fallback passaria a custar **2,4× a meta de R$1,08/usuário/mês**.
E o fallback não é hipótese: é o caminho do circuit breaker.

**(c) O argumento decisivo é de qualidade, não de custo.** A degradação de desempenho
com crescimento de contexto ("context rot") é reproduzida em 18 modelos de fronteira,
inclusive GPT-4.1 e Claude 4: tarefas que atingem >95% de acerto em prompt curto caem
para 60–70% quando o mesmo conteúdo relevante é diluído em distratores, com curva em U
(pior no meio do contexto). Enterrar o sinal de decisão — "a carga do supino parou de
subir nas últimas 3 semanas" — no meio de 200k tokens de linhas de série **reduz** a
qualidade da periodização em vez de aumentá-la.

---

## Decisão

Adotar uma **memória longitudinal de três camadas, derivada deterministicamente**, com
tamanho **constante** no prompt independentemente de quantos anos o aluno tenha de
assinatura. Nenhuma camada usa LLM para resumir.

### Camada 0 — Regra determinística (custo zero de token)

Sinais com limiar clínico defensável não viram texto para o modelo julgar: viram
restrição no `UserConstraints` e/ou veto no `ValidationService`, exatamente como
`maxPhase`/`requiresProfessionalReview` já funcionam hoje. Um teto aplicado em código é
gratuito, auditável, testável e não depende de obediência do modelo — a mesma lição já
registrada em `catalogContext()` (filtrar o que o modelo vê é mais confiável do que pedir
para ele evitar).

### Camada 1 — Ficha de periodização (`periodization_ledger`)

Uma linha estruturada por mesociclo encerrado, gravada **uma vez** no fechamento do
mesociclo e reaproveitada em todas as renovações seguintes. Formato fixo, ~45 tokens:

```
M7 | HIPERTROFIA 6sem | ABC 4x/sem | aderência 78% | carga +6% | RPE méd 7,4 | dor 0 | 82→81kg
```

No prompt entram os **últimos 6 mesociclos em linha completa** (~270 tokens) mais **uma
linha agregada** para tudo que veio antes (~60 tokens). Total: **~330 tokens, constante
para sempre**. É esta camada — e só ela — que dá ao modelo a "visão do todo" da
periodização que hoje não existe.

### Camada 2 — Digest de execução do mesociclo encerrado

Agregação **calculada em SQL**, uma vez, no fechamento do mesociclo, a partir de
`workout_set_entries`, `workout_sessions`, `workout_completions` e `checkins`. Entra no
prompt só o digest do ciclo que acabou, com o delta contra o anterior (~400 tokens):

- **Por exercício principal (top ~10 por volume):** tendência de carga com ponto inicial e
  final, faixa de repetições efetiva, RPE médio e sessões realizadas/prescritas —
  `supino_reto: 40→50kg (+25%), 3x8-10, RPE 7,0→8,0, 11/12 sessões`.
- **Agregados do ciclo:** aderência real vs. planejada, desvio de duração de sessão,
  contagem de sessões com dor reportada e as regiões, tendência de RPE global.
- **Texto livre do aluno:** apenas comentários de sessões com `painReported = true` ou
  RPE ≥ 9, deduplicados, no máximo 5, sempre via `wrapUserMessage()`.

A literatura de séries temporais com LLM sustenta exatamente este desenho: resumos
estatísticos **com descritores de tendência** (slope, min/max, mediana) superam tanto o
envio de linhas cruas — que remove viés indutivo útil e força o modelo a fazer aritmética
— quanto médias nuas sem tendência, que perdem o padrão temporal.

### Camada 3 — Invariantes da anamnese original

Histórico de lesão original, experiência declarada e preferências duradouras já viajam
parcialmente na `constraints` em cascata. O que não viaja é anexado como bloco fixo de
~150 tokens, marcado como invariante (não se re-deriva a cada renovação).

### Resumo é **computado**, nunca gerado

Ponto central desta ADR: como a fonte é **estruturada**, o resumo incremental é
preenchimento de template a partir de SQL — não uma chamada de LLM. Isso elimina de uma
vez (i) o custo de tokens da sumarização, (ii) a alucinação na sumarização, e (iii) o
erro composto de "resumo de resumo" que degrada os desenhos clássicos de memória de
agente. É o motivo de **não** adotarmos um framework de memória de agente pronto
(mem0/Letta/A-MEM): eles resolvem o caso de memória sobre **conversa não estruturada**.
O nosso histórico é tabela relacional tipada com invariantes de domínio.

### Os três campos órfãos

| Campo | Destino | Justificativa |
|---|---|---|
| `newPain.soughtCare` | **Regra + prompt** | Regra: dor nova **sem** avaliação profissional com intensidade alta ou tendência de piora eleva o alerta de handoff (`evaluateRenewalSafety`); dor já sob acompanhamento não precisa do mesmo grau de conservadorismo. Prompt: uma frase curta, sem nomear condição, para o modelo calibrar progressão na região. Nunca vira diagnóstico nem justificativa clínica no texto gerado. |
| `barrierOther` | **Prompt apenas** | Texto livre sobre barreira de aderência. Não existe limiar determinístico defensável ("falta de tempo" ≠ "medo de lesão"). Entra via `wrapUserMessage()` como DADO, junto das barreiras enumeradas que já vão no `continuation.summary`. |
| `goalChange.newGoalOther` | **Prompt apenas — `toGenerationGoal` não muda** | Ver abaixo. |

**Sobre `newGoalOther`:** o mapeamento `OTHER → CONDITIONING` **permanece**. Ele existe
porque `GenerationGoal` alimenta `PRIORITY_PATTERNS_BY_GOAL` e o `ValidationService`, e
uma décima categoria sem faixa definida pelo RT CREF quebraria os dois — é decisão de
segurança, não descuido. O que muda é que o **texto deixa de ser descartado**: passa a
entrar no prompt como declaração de intenção do aluno, delimitado, exatamente no mesmo
padrão do `importantEvent.description`, que já convive com um objetivo estruturado sem
substituí-lo. Correção de premissa registrada: o `primaryGoalOther` da anamnese inicial
**também não entra no prompt hoje** — ele é preservado só para o painel CREF. Esta ADR
propõe passar os dois a entrar, não replicar um comportamento que não existe.

---

## Orçamento resultante

| Item | Tokens adicionados | Δ custo/renovação (DeepSeek) | Δ custo/renovação (Claude) |
|---|---:|---:|---:|
| Ficha de periodização (constante) | ~330 | R$0,0008 | R$0,0054 |
| Digest de execução | ~400 | R$0,0010 | R$0,0066 |
| Invariantes da anamnese | ~150 | R$0,0004 | R$0,0025 |
| Três campos órfãos | ~40 | R$0,0001 | R$0,0007 |
| **Total** | **~920** | **~R$0,002** | **~R$0,015** |

Contra **+R$0,49 (DeepSeek) a +R$2,24 (GPT-4.1)** por renovação do histórico bruto no
ano 2 — e, diferente deste, **o custo não cresce com o tempo de assinatura**. O acréscimo
é ≈0,2% da meta mensal de R$1,08 no candidato principal, e ≈1,4% no pior fallback.

### Sobre prompt caching

Os três provedores suportam cache de prefixo (DeepSeek automático por prefixo em disco,
OpenAI automático a partir de 1024 tokens, Anthropic via `cache_control`, já implementado
em `providers.ts`), e a redução de preço no hit é de ~90–99%. **Mas não se deve contar com
ele para financiar esta mudança**, por três motivos concretos:

1. Os TTLs são de **5 a 10 minutos**; renovações do mesmo aluno ocorrem a cada 4–8
   **semanas**. Cache por usuário é estruturalmente inútil aqui.
2. Só há hit por compartilhamento de prefixo **entre usuários diferentes na mesma janela
   de minutos** — e `catalogContext()` filtra o catálogo por local, nível e tags de lesão,
   o que fragmenta o prefixo em dezenas de variantes. Com a base atual de usuários, o
   hit-rate esperado é próximo de zero.
3. O conteúdo desta ADR é **por usuário** e entra em `messages`, depois do system — ou
   seja, é justamente a parte não cacheável, por construção correta.

A ordenação atual (prefixo estável no `system`, variável nas `messages`) está certa e deve
ser preservada. Cache é otimização oportunista de volume, não alavanca de orçamento.

---

## Consequências

**Positivas**
- O modelo passa a periodizar com visão longitudinal real, não com uma janela de um ciclo.
- Autorrelato subjetivo passa a ser confrontado com execução registrada (o aluno que diz
  "progredi bem" e cuja carga ficou plana em 3 exercícios passa a ser detectável).
- Custo de contexto **constante** por renovação, com teto conhecido em qualquer provedor.
- Sinais de segurança que hoje dependem da interpretação do LLM sobre um texto corrido
  (fadiga alta, sono ruim, dor sem avaliação) passam a ter teto determinístico auditável.
- Três campos coletados do aluno deixam de ser desperdício de fricção no formulário.

**Negativas e riscos**
- Requer materialização nova no banco (ficha + digest) e um gatilho no fechamento de
  mesociclo — escopo do Rafael/Leonardo, não desta ADR.
- Agregação determinística **perde** padrões que ninguém antecipou ao escrever a query;
  é o trade-off clássico de fidelidade vs. abstração, e é aceito conscientemente.
- Aluno com poucos dados de diário (não usa o registro de treino) gera digest esparso: o
  pipeline **deve** degradar para o comportamento atual, nunca alucinar tendência a partir
  de 2 sessões. Limiar mínimo de sessões para emitir tendência por exercício é obrigatório.
- Todo esse conteúdo é derivado de dado de saúde: viaja como `dataClass: HEALTH` (o
  default fail-safe do `LlmRouter`) e permanece sob o gate da ADR-005-R2. Preferir número
  derivado a narrativa clínica crua reduz o raio de exposição sem perder sinal.

**Explicitamente fora de escopo**
- RAG/embeddings sobre comentários de texto livre do aluno. Volume real (~24 comentários
  por mesociclo, maioria vazios) não justifica busca vetorial; filtro determinístico +
  teto de 5 resolve com custo zero de infraestrutura. Reavaliar apenas quando houver
  necessidade de recall semântico entre mesociclos — e, nesse caso, a unidade a indexar é
  o **digest do mesociclo**, nunca o comentário isolado.
- Qualquer mudança em `toGenerationGoal` ou no vocabulário de `GenerationGoal`.
- Fine-tuning. Não há volume de dado proprietário que o justifique, e o problema aqui é de
  contexto, não de capacidade do modelo.

---

## Validação exigida antes de promover a "Aceita"

1. Golden set de renovação com casos de periodização longitudinal (deload devido,
   estagnação de carga, aderência decrescente) — hoje o `golden-set.fixture.ts` cobre
   geração inicial, não continuidade.
2. Medição A/B de tokens e custo reais por `ai_jobs` com `intent` separado antes e depois.
3. Teste de regressão de segurança: o digest **nunca** pode reintroduzir linguagem de
   diagnóstico no texto gerado (`checkLanguage` continua sendo o gabarito).

---

## Fontes

- Chroma, *Context Rot: How Increasing Input Tokens Impacts LLM Performance*: https://www.trychroma.com/research/context-rot
- *Memory for Autonomous LLM Agents: Mechanisms, Evaluation, and Emerging Frontiers*: https://arxiv.org/html/2603.07670v1
- mem0, *State of AI Agent Memory 2026: Benchmarks & Trends*: https://mem0.ai/blog/state-of-ai-agent-memory-2026
- *Prompt Engineering for Time-Series Analysis with Large Language Models*: https://towardsdatascience.com/prompt-engineering-for-time-series-analysis-with-large-language-models/
- *Health-LLM: Large Language Models for Health Prediction via Wearable Sensor Data*: https://arxiv.org/pdf/2401.06866
- OpenAI, *Prompt caching*: https://developers.openai.com/api/docs/guides/prompt-caching
- Anthropic, *Prompt caching*: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- DeepSeek, *Models & Pricing*: https://api-docs.deepseek.com/quick_start/pricing/
- ADR-005-R2 (preços e gate de provedor): `docs/arquitetura/decisoes/adr-005-r2-selecao-neutra-de-provedor-llm.md`
