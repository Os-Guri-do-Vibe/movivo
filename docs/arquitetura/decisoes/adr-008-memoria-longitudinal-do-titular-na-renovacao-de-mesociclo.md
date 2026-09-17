# ADR-008 — Memória longitudinal do titular na renovação de mesociclo

**Status:** Proposta
**Data:** 2026-09-11
**Autor:** Rafael Nakamura (Distinguished Software Architect)
**Escopo:** aditivo ao pipeline de renovação existente. Não altera `10-relatorio-rafael.md`
nem `ARQUITETURA.md` — revisão pontual de um fluxo.
**Relacionada:** ADR-001 (monólito modular), ADR-003 (PgBouncer transaction mode),
ADR-005-R2 (gate neutro de provedor LLM).

---

## 1. Contexto

O `ProtocolRenewalGenerationWorker` (`apps/api/src/modules/protocol/protocol-renewal-generation.worker.ts`)
gera o próximo mesociclo lendo **três** fontes: o protocolo imediatamente anterior (uma linha,
por `previousProtocolId`), os cinco blocos do formulário de renovação e a `constraints` JSONB
herdada em cascata.

Não lê: `anamnesis_sessions` (anamnese de cadastro), o histórico dos mesociclos 1..N-1, nem o
diário de execução (`workout_sessions`, `workout_set_entries`, `workout_completions`, `checkins`).

Consequências práticas:

- **Deriva por cascata.** `toConstraints()` parte do snapshot do mesociclo anterior, que por sua
  vez partiu do anterior. A anamnese original é a raiz dessa cadeia, mas a cadeia nunca é
  reconciliada com a raiz. Um `sanitizeBaseConstraints()` que preenche defaults sobre uma
  `constraints` de fallback (forma mínima) fica permanente: `level` vira `INICIANTE`,
  `injuryTags` vira `[]`, e nada nunca restaura o dado verdadeiro.
- **Zero visão de periodização.** A IA decide a fase do próximo mesociclo vendo um único ciclo.
  Não há como evitar repetir três blocos de hipertrofia seguidos nem reconhecer um padrão de
  estagnação de 6 meses.
- **O dado mais valioso é escrito e nunca lido.** Carga, repetições, RPE, dor e comentário por
  série existem em `workout_set_entries`/`workout_sessions` e não influenciam a prescrição
  seguinte. O sistema pergunta ao aluno "você conseguiu progredir a carga?" (Bloco 1,
  autorrelato categórico) tendo a resposta numérica exata no banco.

Este fluxo é **permanente**: roda uma vez por mesociclo, indefinidamente, enquanto houver
assinatura ativa. Qualquer custo aqui é recorrente e perpétuo por titular.

**Restrição econômica dura:** infra MVP é uma VPS Hostinger KVM 2 (2 vCPU, 8 GB RAM, **100 GB
NVMe**, ~R$75/mês) e o orçamento de LLM é ~R$1,08/mês por usuário, sobre mensalidade de R$39.

---

## 2. Volumetria (base de toda decisão abaixo)

Premissas: 3,5 sessões/semana, ~6 exercícios/sessão, ~3,5 séries/exercício; mesociclo médio de
6 semanas → ~8 renovações/ano por titular.

| Tabela | Linhas/ano/titular | Por mesociclo | A 10.000 assinantes |
|---|---|---|---|
| `workout_set_entries` | ~3.800 | ~440 | **38 M linhas/ano** |
| `workout_sessions` | ~180 | ~21 | 1,8 M/ano |
| `workout_completions` | ~180 | ~21 | 1,8 M/ano |
| `checkins` | 52 | 6 | 520 k/ano |
| `protocols` | ~8 | 1 | 80 k/ano |
| `anamnesis_sessions` | — (1 na vida) | — | ~1 linha/titular |

`workout_set_entries` a ~140 B de heap + ~160 B de índices (PK, unique de 3 colunas, e
`(user_id, exercise_id)`) ≈ **300 B/linha** → **~11 GB/ano a cada 10 k assinantes**.

**Conclusão dimensionante: o gargalo desta feature não é CPU de query nem custo de banco — é
disco e é token.** A 10 k assinantes o disco de 100 GB dura ~4 anos; a 50 k, dura ~1 ano.

Frequência de renovação a 10 k assinantes: ~220/dia ≈ **0,0025 QPS**. Qualquer leitura por
titular nesse ritmo é gratuita em termos de banco.

---

## 3. Decisão

### 3.1 Anamnese — leitura direta a cada renovação, sem cache

Ler `anamnesis_sessions` diretamente no `load()` do worker, dentro da mesma transação
`runAsUser` já existente. **Nenhum cache, nenhuma desnormalização.**

Um cache com TTL para um dado lido uma vez a cada ~6 semanas tem taxa de acerto
indistinguível de zero e adiciona superfície de invalidação sobre dado de saúde. Custo real
da leitura: 1 linha por índice + `pgp_sym_decrypt` do `data_block_2` ≈ **< 5 ms**; a 220
renovações/dia, **~1 segundo de CPU de banco por dia**.

O que entra no prompt é uma **projeção destilada** da anamnese (condições clínicas, lesões,
PAR-Q, contexto imutável), nunca o JSON bruto.

Efeito colateral desejado — **reconciliação**: a anamnese passa a ser a raiz de verdade contra a
qual a `constraints` em cascata é conferida a cada renovação. Uma `injuryTag` perdida num
fallback volta a aparecer. A regra de precedência é a já vigente no código: segurança
(`injuryTags`) nunca é rebaixada por preferência (`avoid`); a união é sempre conservadora.

### 3.2 Histórico de mesociclos — projeção estreita + resumo por mesociclo

Nunca fazer `SELECT content` sobre o histórico. `protocols.content` é um JSONB TOASTed de
~20–40 KB; 50 mesociclos (5 anos) são ~1,5 MB detoasted ≈ **~400 k tokens** — inviável no prompt,
ainda que barato no banco.

Padrão adotado:

1. **Coluna nova `mesocycle_summary` (JSONB, ~1–2 KB)** em `protocols`, escrita **uma única vez**
   no fechamento do mesociclo — nunca recalculada. Write-once, read-many.
2. **Janela recente**: os últimos **N = 4** mesociclos entram completos como resumo.
3. **Digest de carreira**: um agregado de tamanho **fixo** (total de mesociclos, fases já
   cumpridas em ordem, tendência de carga por padrão de movimento, lesões recorrentes) cobre
   tudo que ficou fora da janela.

O que entra no prompt fica **limitado por construção**: 4 resumos + 1 digest, independentemente
de o titular ter 5 ou 500 mesociclos. Paginação e query crescente sem limite ficam descartadas
— ambas fazem o custo crescer com o tempo de assinatura, que é exatamente o inverso do que a
unit economics de um produto de retenção precisa.

### 3.3 Diário de treino — rollup incremental no fechamento do mesociclo

O agregado do mesociclo é computado **uma vez, quando o mesociclo fecha**, sobre a janela
daquele mesociclo (~440 linhas de `workout_set_entries` + ~21 sessões), e persistido no mesmo
`mesocycle_summary` de §3.2.

**View materializada foi avaliada e rejeitada.** `REFRESH MATERIALIZED VIEW`, inclusive
`CONCURRENTLY`, recomputa a query inteira: o custo é proporcional ao tamanho da tabela de
origem, não ao delta. Sobre 38 M linhas/ano isso é um full scan por refresh, num box de 2 vCPU,
para atender 220 leituras/dia. É a ferramenta errada para este formato de dado.

O dado tem duas propriedades que tornam o rollup no fechamento estritamente superior:
é **append-only** e tem um **evento natural de encerramento** (fim do mesociclo). Um mesociclo
fechado é imutável — recomputá-lo a cada renovação é pagar N vezes por um resultado que não
muda. Custo do rollup: **~20 ms, uma vez por mesociclo**. Os ~130 KB de dado bruto do mesociclo
viram ~1,5 KB de resumo — **~1,2% do volume**, respondendo 100% das leituras de renovação.

Conteúdo do rollup (agregação pura em SQL, sem LLM):

- adesão real: sessões concluídas / prescritas, por semana;
- progressão de carga por exercício: primeira vs. última carga da série de trabalho, tonelagem
  semanal, tendência;
- RPE médio e sua tendência ao longo das semanas;
- incidência de dor: `pain_reported` por região/exercício, contagem e recorrência;
- exercícios sistematicamente pulados (`skipped`) — sinal de aversão ou inviabilidade.

**Restrição técnica que condiciona o desenho:** `workout_sessions.feedback_cipher` e
`checkins.responses_cipher` são `bytea` de `pgp_sym_encrypt`. **Texto livre não é agregável em
SQL.** Portanto o rollup é bipartido: agregados numéricos/categóricos em JSONB (mesma postura
de `protocols.content` e `checkins.adjustments` hoje), e qualquer texto livre destilado
decifrado na aplicação e regravado em **coluna `bytea` cifrada própria** — nunca em claro, nunca
misturado ao JSONB agregável. Não introduzir `pgp_sym_decrypt` dentro de `GROUP BY`: derruba o
uso de índice e expõe chave em plano de query.

### 3.4 Particionamento — decidido agora, executado por gatilho

`workout_set_entries` e `workout_sessions` recebem partição declarativa por RANGE mensal
**quando** qualquer gatilho disparar:

- `workout_set_entries` ultrapassar **50 M linhas** ou **20 GB** (heap + índices); ou
- `VACUUM`/`REINDEX` da tabela passar de **30 min**; ou
- disco da VPS passar de **60%**.

Não antes. Particionar cedo troca um problema que não existe por complexidade de migração,
planner e RLS que existe desde o dia 1.

O que o particionamento compra, uma vez que o rollup exista: com o resumo persistido, o dado
bruto fica **frio** no instante em que o mesociclo fecha. `DETACH PARTITION` + dump comprimido
para storage frio é quase instantâneo e não gera o WAL bloat de um `DELETE` de milhões de
linhas. É isso que põe **teto** no disco: com 24 meses quentes a 10 k assinantes, ~24 GB
estáveis em vez de crescimento perpétuo.

Cuidado obrigatório: sob ADR-003 (PgBouncer transaction mode) + RLS `FORCE`, as políticas
precisam existir na tabela particionada **pai** e o acesso precisa passar pelo pai para
herdá-las. Um `INSERT`/`SELECT` direto numa partição filha não herda a política do pai — isso
seria um vazamento entre titulares. Todo acesso continua via `runAsUser` e via a tabela pai.

### 3.5 Ordem do prompt é decisão de arquitetura de custo, não de conteúdo

O componente dominante do custo de input é o cache de prefixo. Em DeepSeek V4 Pro, input
cache-hit custa **$0,022/M** contra **$0,66/M** cache-miss — **30×**. Metodologia e catálogo
de exercícios são idênticos entre todos os titulares e constituem o maior bloco do prompt.

Regra vinculante: **dado do titular nunca é inserido antes de metodologia/catálogo no prefixo.**
Hoje o código já está correto (`system` = metodologia + catálogo; `user` = constraints). Inserir
o histórico longitudinal no lugar errado invalidaria o prefixo compartilhado e multiplicaria o
maior componente do prompt por 30 — uma regressão de custo invisível em code review e invisível
em teste funcional. Todo material novo desta ADR entra **depois** do bloco estável.

*(A formatação semântica desse material — como destilar, o que priorizar, como o modelo deve
raciocinar sobre periodização — é de Victor, não desta ADR.)*

---

## 4. Impacto em custo

Preços DeepSeek V4 Pro off-peak: input cache-miss $0,66/M, cache-hit $0,022/M, output $1,98/M
(peak = 2×). Câmbio ~R$5,10/US$.

| Abordagem | Tokens de input adicionais | Custo/renovação | Custo/titular/mês |
|---|---|---|---|
| Hoje (sem histórico) | 0 | — | — |
| **Ingênua** (histórico + diário crus) | ~880.000 | ~R$2,96 | **~R$1,97** |
| **Desta ADR** (destilado + rollup) | ~2.200 | ~R$0,0074 | **~R$0,005** |

A abordagem ingênua **sozinha** custaria ~1,8× todo o orçamento de IA do produto (R$1,08/mês) e
em horário de pico ~3,6×. A abordagem desta ADR consome **~0,5%** desse orçamento — e ainda
assim entrega anamnese + periodização + diário granular.

Custo de armazenamento do rollup: 80 k linhas/ano × ~1,5 KB = **~160 MB/ano** a 10 k assinantes,
contra ~11 GB/ano do dado bruto que ele resume.

Custo de banco no caminho da renovação: 3 leituras por índice + 1 leitura de rollup, todas
O(1) ou O(janela fixa). **Nenhuma cresce com o tempo de assinatura.** É esta propriedade — e não
o valor absoluto de hoje — que é a decisão.

---

## 5. Alternativas rejeitadas

| Alternativa | Por que não |
|---|---|
| Cache Redis da anamnese | Hit rate ~0 em leitura a cada 6 semanas; invalidação sobre dado de saúde sem contrapartida. |
| Desnormalizar anamnese em `users` | Duplica dado do Art. 11 em mais um lugar, com dois pontos de expurgo para LGPD. Resolve um custo que não existe. |
| `REFRESH MATERIALIZED VIEW` (mesmo `CONCURRENTLY`) | Recompute integral; custo proporcional à tabela, não ao delta. Full scan de 38 M linhas/ano em 2 vCPU. |
| `pg_ivm` / view incremental de verdade | Extensão fora do core, overhead no caminho de escrita do diário (o caminho quente), para atender 0,0025 QPS de leitura. Complexidade sem retorno. |
| Query lifetime a cada renovação | Funciona hoje (~50–100 ms), mas é O(N) recomputado sobre dado imutável, crescendo com o tempo de assinatura — precisamente o vetor que corrói LTV. |
| Paginação do histórico | Mantém o crescimento, só o distribui em mais round-trips. Não resolve o limite de tokens. |
| Particionar agora | Complexidade de RLS/planner/migração antes de qualquer gatilho. |
| Embeddar o diário no pgvector e fazer RAG sobre ele | Busca semântica sobre série numérica é a ferramenta errada; agregação determinística responde melhor, é auditável e é mais barata. `SUM`/`AVG` não alucinam. |

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Rollup de mesociclo interrompido deixa o resumo ausente | Cálculo idempotente por `protocolId` (upsert); worker de renovação computa sob demanda se ausente. Degrada para lento, nunca para errado. |
| Titular com histórico raso (mesociclo 1→2) | Digest e janela são opcionais por construção; ausência é estado válido, não erro. |
| Rollup amplia a superfície de dado de saúde | Texto livre em coluna cifrada própria; RLS `FORCE` na tabela; rollup entra no mesmo inventário de expurgo LGPD do dado que resume. **Validar retenção com Alexandre (§7).** |
| Custo de token cresce em silêncio | Teto duro de tokens do bloco longitudinal, imposto em código antes do envio; emitir o tamanho em `ai_jobs` para observabilidade. |
| Arquivar o bruto elimina prova documental | Não elimina: a prova é o protocolo assinado + hash de assinatura, que tem `ON DELETE RESTRICT` e não é tocado. Confirmar com Alexandre. |

---

## 7. Dependências de outros agentes

- **Victor (IA):** destilação semântica, priorização e formato do material longitudinal no
  prompt; avaliação de regressão da qualidade do protocolo com o contexto novo.
- **Alexandre (CLO):** prazo de retenção do diário granular (§3.4) e posição sobre arquivamento
  em storage frio de dado do Art. 11.
- **Leonardo (Backend):** implementação do rollup, migração da coluna, índice parcial de §8.
- **Henrique (Plataforma):** alarme de disco em 60%, que é o gatilho real de §3.4.

---

## 8. Achados adjacentes no fluxo de renovação (fora do escopo desta ADR)

Levantados na investigação; registrados para não se perderem.

1. **Convite de renovação é irrepetível (bug de ciclo de vida, prioridade alta).**
   `uq_protocol_renewal_sessions_previous_protocol` + `onConflictDoNothing` garantem uma sessão
   por protocolo vencido — para sempre. Se o titular não preencher o formulário em 14 dias, a
   sessão vira `EXPIRED` (marcação preguiçosa, no acesso) e **o scheduler nunca cria outra**.
   O titular fica preso num protocolo vencido, sem novo convite, indefinidamente — pagando
   assinatura. Precisa de reconvite ou de renovação de TTL.
2. **Índice do scan.** `scan()` filtra `status='ACTIVE' AND end_date <= now`, mas
   `idx_protocols_status` cobre só `status`. Um índice parcial em `(end_date) WHERE
   status='ACTIVE'` elimina a varredura diária de todas as linhas ativas. Barato, não bloqueante.
3. **`scan()` é serial.** Um round-trip por titular em laço `for...of`. Aceitável até ~10 k
   assinantes; revisar quando o scan passar de 5 min.

---

## 9. Fontes consultadas

- https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html
- https://www.epsio.io/blog/postgres-refresh-materialized-view-a-comprehensive-guide
- https://www.postgresql.org/docs/current/ddl-partitioning.html
- https://medium.com/@fklezin/when-to-consider-postgres-partitioning-in-2026-71189ac88728
- https://deepseek.ai/pricing
- https://pricepertoken.com/pricing-page/model/deepseek-deepseek-v4-pro
- https://benchlm.ai/deepseek/api-pricing
