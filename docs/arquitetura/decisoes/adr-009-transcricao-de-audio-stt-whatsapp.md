# ADR-009 — Transcrição de áudio (STT) do AI Coach no WhatsApp

**Status:** Aceita

**Data:** 2026-09-14 (decisão original) · **revisada no mesmo dia** — item 1 mudou de
"fornecedor único" para "cascata com fallback automático" a pedido do fundador, depois de a
chave da OpenAI de dev ficar sem saldo (`credit_balance_exhausted`) durante o teste local.

## Contexto

Sofia já recomendava esta feature em `docs/fitness-ia-whatsapp/25-sofia-ux-conversacional.md`
§5.5, mas fora do MVP: *"Um coach que entende áudio do aluno (transcrição) mas responde em texto
é um ganho grande de conversão de turno... Recomendo isso como o primeiro item de Fase 2 da
conversa."* O fundador pediu a implementação em 2026-09-14, com o produto já em Fase 5
(Desenvolvimento) e escopo inicial deliberadamente restrito à EvolutionAPI (canal de teste
Baileys) — a AraraHQ (BSP de produção) segue descartando áudio na borda até o webhook de voz de
produção ser confirmado (`arara-inbound.edge.ts` ainda documenta o payload como placeholder).

Nenhum dos três provedores já integrados ao `LLMRouter` (DeepSeek V4 Pro, GPT-4.1, Claude Sonnet
4.5) aceita áudio na integração usada aqui — todos são chamados como chat completions
somente-texto (`providers.ts`). Transcrição para texto, e só então entregar o texto ao pipeline
de IA já existente (contexto, RAG, guardrails CREF, `LLMRouter`), é o único caminho — não é um
workaround, é como ChatGPT/Claude também resolvem entrada de voz por trás dos apps deles.

Transcrição é transferência de dado do titular a um provedor externo, igual a uma chamada de
LLM — e potencialmente mais sensível (voz é dado biométrico-adjacente; o aluno pode falar sobre
dor, lesão ou sintoma). Por isso precisa do mesmo tipo de gate que a ADR-005-R2 já aplica ao
`LLMRouter`, não pode ser um desvio dele.

## Decisão

1. **Cascata de STT com `AudioTranscriptionCascade` (`core/audio/`): `gpt-4o-mini-transcribe`
   (OpenAI) como perna PRIMÁRIA, Groq `whisper-large-v3-turbo` como FALLBACK automático — em
   produção E local, não uma troca manual de provedor.** Decisão original (mesmo dia) era
   fornecedor único (OpenAI, sem cascata) pra não abrir diligência de DPA com um fornecedor de
   STT novo; revisada depois que a chave OpenAI de dev ficou sem saldo durante o teste local — o
   mesmo raciocínio que já vale pro `LLMRouter` (nunca depender de um único fornecedor externo)
   se aplica aqui. Cada perna só entra na cascata com chave + aprovação de HEALTH PRÓPRIAS; se a
   primária lançar (rate limit, sem saldo, erro de rede), a cascata cai pra próxima automaticamente
   — sem circuit breaker/retry por perna (menor criticidade que o `LLMRouter`; falha total já tem
   fallback de UX pronto: avisa o aluno pra escrever).
2. **Gate de HEALTH próprio e separado do LLM, por PERNA**: `STT_OPENAI_HEALTH_DATA_APPROVED` e
   `STT_GROQ_HEALTH_DATA_APPROVED`, nenhum dos dois é `LLM_OPENAI_HEALTH_DATA_APPROVED`. Mesmo
   fornecedor (no caso da OpenAI), mas uma superfície de dado diferente (áudio bruto do titular,
   não texto já escrito por ele) — pode exigir avaliação própria de Jurídico/Segurança antes de
   ligar. Fail-closed em DUAS camadas: `WhatsappInboundService` checa `isAudioTranscriptionConfigured`
   (pelo menos uma perna pronta) antes de chamar a porta, e a cascata com zero pernas lança em vez
   de fingir transcrever.
3. **Só a transcrição é retida; o áudio bruto nunca é persistido** — decisão do fundador,
   minimização de dado (LGPD): o áudio é baixado, transcrito e descartado; o texto resultante
   entra em `conversations` como qualquer outra mensagem do aluno.
4. **Escopo inicial: só EvolutionAPI.** `EvolutionInboundEdge` para de descartar `audioMessage` e
   emite uma referência de mídia (`audio.mediaKey`, o `key` do Baileys serializado);
   `EvolutionTransport.downloadAudio` busca o base64 via
   `POST /chat/getBase64FromMediaMessage/{instance}`. A AraraHQ continua descartando áudio na
   borda — decisão do fundador, revisitar quando o webhook de voz de produção for confirmado.
5. **Teto de duração** (`AUDIO_TRANSCRIPTION_MAX_DURATION_SECONDS`, default 120s) verificado
   ANTES de baixar/transcrever — protege custo de STT e o SLA de latência do turno (Sofia §5.4:
   ≤8s até a 1ª bolha).
6. **Transcrição só roda DEPOIS do nonce/titular/orçamento** do `WhatsappInboundService`
   passarem — é custo real de terceiro, nunca pago por uma entrega não autenticada ou fora do
   orçamento de 30 msg/5min do titular. Trade-off aceito: a isenção de orçamento da frase de
   revogação de consentimento (LGPD Art. 18) não se aplica a áudio (checar a frase exigiria
   transcrever ANTES do orçamento) — o direito continua 100% exercível por texto, e a frase dita
   por voz ainda é honrada depois de transcrita, só não fura o orçamento pra chegar lá.
7. **Qualquer falha (duração excedida, gate fechado, download ou transcrição falha) avisa o
   aluno** com uma mensagem pedindo pra escrever, em vez de descartar em silêncio — ninguém fica
   esperando uma resposta que nunca chega.

## Aplicação no runtime

```text
STT_OPENAI_HEALTH_DATA_APPROVED           # false por padrão — fail-closed
STT_GROQ_HEALTH_DATA_APPROVED             # false por padrão — fail-closed
GROQ_API_KEY / GROQ_API_KEY_FILE          # opcional; sem ela a cascata roda só com OpenAI
AUDIO_TRANSCRIPTION_MAX_DURATION_SECONDS  # default 120
AUDIO_TRANSCRIPTION_TIMEOUT_MS            # default 20000
```

`OPENAI_API_KEY` é reaproveitada da ADR-005-R2 — não é uma credencial nova. `GROQ_API_KEY` é
nova, mas opcional: sem ela a cascata simplesmente roda com uma perna só (OpenAI).

## Custo comparado (decisão de 2026-09-14)

| Opção | Preço | Observação |
|---|---|---|
| **OpenAI `gpt-4o-mini-transcribe` (perna primária)** | US$0,003/min | Reaproveita fornecedor/diligência já em curso |
| OpenAI `gpt-4o-transcribe` / `whisper-1` | US$0,006/min | Maior qualidade em áudio ruidoso, custo maior |
| **Groq `whisper-large-v3-turbo` (perna de fallback)** | US$0,04/hora (~US$0,00067/min) | ~18x mais barato; free tier cobre o volume do MVP — abre diligência de DPA própria, mas entra como fallback, não como decisão de substituir a OpenAI |
| Self-hosted (whisper.cpp) | Sem custo por chamada | Exige VPS dedicada (a KVM 2 atual não sobra CPU sem estourar o SLA de latência) — custo fixo de infra maior que qualquer vendor no volume do MVP |

No volume do MVP (dezenas a milhares de alunos), qualquer opção gerenciada custa poucos reais por
mês — a decisão de ter DUAS pernas não foi por preço, foi por resiliência (não depender de um
único fornecedor externo, mesmo raciocínio já aplicado ao `LLMRouter` na ADR-005-R2).

## Consequências

- STT entra sob o mesmo modelo de gate fail-closed da ADR-005-R2, mas como atestado
  independente POR PERNA — aprovar `LLM_OPENAI_HEALTH_DATA_APPROVED` não libera nenhuma perna de
  STT, e aprovar uma perna de STT não libera a outra.
- Até pelo menos uma aprovação explícita, o AI Coach não transcreve áudio nenhum — pede pro
  aluno escrever, sem quebrar a conversa.
- Groq agora é dependência de PRODUÇÃO (ainda que só como fallback), não mais só uma ferramenta
  de teste local — isso reabre a pergunta de diligência de DPA que a decisão original evitava
  abrir; fica registrado como item pendente para Alexandre revisar antes de qualquer tráfego real
  de aluno passar por essa perna.
- AraraHQ (produção) segue sem suporte a áudio até este ADR ser revisitado com o contrato real do
  webhook de voz.

## Fontes

- OpenAI, pricing de transcrição (gpt-4o-transcribe, gpt-4o-mini-transcribe, whisper-1): https://developers.openai.com/api/docs/pricing
- Groq, pricing de Whisper Large v3 Turbo: https://console.groq.com/docs/models
- Hostinger, planos VPS KVM: https://www.hostinger.com/vps-hosting
