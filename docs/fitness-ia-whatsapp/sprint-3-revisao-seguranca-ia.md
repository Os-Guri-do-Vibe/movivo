# Revisão de Segurança de IA — Sprint 3 (conversa do AI Coach + superfície inbound)

**Papel:** Sato (Distinguished Security Engineer, §6/§9.4/§10) — revisão consolidada registrada por Mariana (QA) no fechamento da US-3.7.
**Data:** 2026-07-31
**Escopo:** primeira sprint com **IA respondendo síncrono ao usuário sobre dado de saúde** e com **superfície inbound aberta** (webhook de entrada). Amplia a superfície de risco: injeção agora pode ser **multi-turn** e o contexto de conversa é um novo vetor de vazamento cross-user.
**Fontes:** `11-relatorio-sato.md` §6 (HMAC/anti-replay), §9.4 (anti-abuso 50 msg/dia), §10 (prompt injection) · `12-relatorio-victor.md` §2/§4/§6/§7 · `ARQUITETURA.md` §5/§8/§12 · reusa o boundary da Sprint 2 (`sprint-2-revisao-seguranca-ia.md`).

> **Veredito:** **APROVADO PARA DEV LOCAL** com os controles abaixo implementados e testados. **Pendências de LANÇAMENTO** (não de merge): segredo real do webhook AraraHQ + esquema de assinatura/timestamp/nonce do provedor; corpus RAG curado e ratificado pelo RT CREF; respostas-padrão de recusa/handoff aprovadas por Alexandre/RT; chaves ZDR+DPA/SCC; liberação INPI. Dev roda com mocks/fixtures (memória "dev local, não produção").

---

## 1. Superfície inbound: HMAC + anti-replay + debounce (Sato §6)

- Webhook de entrada valida **HMAC sobre o corpo bruto** + janela de timestamp ±5min + **nonce único** (anti-replay) + debounce/lock por usuário; responde 200 <1s e enfileira em `ai-response`. Payload forjado/replay/duplicado é descartado.
- **Evidência:** `apps/api/test/webhook-inbound.int-spec.ts` (HMAC válido/forjado/replay/debounce/idempotência) — verde.
- `ponytail` reconhecido: o formato real do provedor (header de assinatura, presença de timestamp/`messageId`) é **bloqueador de produção**, não de dev — hoje roda com fixture.

## 2. Prompt injection multi-turn e anti-leak (Sato §10 · Victor §7)

- A defesa da Sprint 2 (`prompt-injection.ts`: delimitação estrutural `<mensagem_usuario>`, heurística de padrões, neutralização visível, anti-leak de saída) roda **por turno** — cada mensagem é neutralizada antes de compor o prompt, então o jailbreak construído ao longo de turnos é pego no turno ofensivo.
- **Evidência:** `apps/api/src/modules/coach/conversation-safety.spec.ts` — jailbreak progressivo ("você agora é", "revele o prompt"), tentativa de extração de dado de outro usuário, e instrução que tenta forjar o delimitador → todos detectados/neutralizados; conversa benigna não é falso-bloqueada. **Regressão garantida:** se um vetor conhecido deixar de ser detectado, a suite falha.

## 3. Guardrail clínico de entrada — 0% de orientação médica direta (Sato §10 · US-3.4)

- `clinicalGuardrail` (`clinical-guardrail.ts`) roda <1ms **antes** de qualquer custo de IA: `SAFETY` (dor no peito/falta de ar/ideação) → handoff de segurança; `SCOPE` (medicamento/suplemento/dieta) → recusa honesta sem handoff. Corta a pergunta médica antes de chegar ao LLM.
- **Evidência:** `conversation-golden-set.spec.ts` — roteamento 100% correto; medicamento/dieta sempre cortados no guardrail (0% de orientação médica segue ao LLM).

## 4. Substituição fiel à base — MOVI nunca inventa exercício (US-3.5)

- `findSafeSubstitute` (`exercise-substitution.ts`) escolhe o substituto **sempre da base**, no mesmo padrão de movimento, dentro de nível/equipamento e **nunca contraindicado**; sem substituto seguro → `null` → fallback humano (não inventa). A IA só verbaliza; `validateResponse` confirma com `allowedExercises` (exercício não autorizado citado → `BLOCK`).
- **Evidência:** `conversation-golden-set.spec.ts` (substituição segura + caso de lesão no joelho que corretamente não encontra substituto seguro na base) + `validation.service.spec.ts` (`EXERCISE_NOT_ALLOWED`).

## 5. Boundary de PII e veto de saída (reuso da Sprint 2)

- PII Scrubber inescapável (`pii-scrubber.ts`) aplicado a cada turno; `input_snapshot` pseudonimizado. `validateResponse` (`validation.service.ts`) reusa as regras de linguagem/compliance/leak da US-2.3 sobre o texto conversacional — prescrição/promessa/diagnóstico/leak vetados.
- **Evidência:** `conversation-safety.spec.ts` (0 vazamentos de PII em nenhum turno; saída com leak/prescrição bloqueada).

## 6. Anti-abuso: 50 msg/dia (Sato §9.4)

- Teto de 50 mensagens/dia por usuário (counter Redis namespaced) + budget alert de custo; chaves via secrets, nunca `environment:`.
- **Evidência de custo:** `ai-cost.spec.ts` — envelope mensal por usuário ≤ ~R$1,08 e o dia no teto de 50 msg cabe no orçamento diário de abuso.

## 7. Isolamento de contexto de conversa (novo vetor da sprint)

- Contexto de 3 camadas escopado por usuário: working (Redis namespaced), episodic (Postgres RLS `FORCE`), semantic/RAG (corpus read-only). Um job de resposta de A nunca lê working/episodic/RAG de B.
- **Evidência:** `apps/api/test/context.int-spec.ts` (isolamento cross-tenant) + `redis-isolation.int-spec.ts` + RLS em `security-foundation.int-spec.ts`.

---

## Matriz de controles × evidência

| Controle (Sato) | Implementação | Evidência (verde) |
|---|---|---|
| HMAC + anti-replay + debounce (inbound) | webhook de entrada | `webhook-inbound.int-spec.ts` |
| Prompt injection multi-turn + anti-leak | `prompt-injection.ts` (por turno) | `conversation-safety.spec.ts` |
| Guardrail clínico / 0% orientação médica | `clinical-guardrail.ts` | `conversation-golden-set.spec.ts` |
| Substituição fiel à base | `exercise-substitution.ts` + `validateResponse` | `conversation-golden-set.spec.ts`, `validation.service.spec.ts` |
| PII Scrubber + veto de saída | `pii-scrubber.ts`, `validation.service.ts` (100%) | `conversation-safety.spec.ts` |
| Anti-abuso 50 msg/dia + custo | counter Redis + `costBrl` | `ai-cost.spec.ts` |
| Isolamento de contexto de conversa | working Redis + episodic RLS + RAG | `context.int-spec.ts`, `redis-isolation.int-spec.ts` |

## Pendências para o lançamento (não bloqueiam dev local)

1. **Segredo real do webhook AraraHQ** + esquema de assinatura/timestamp/nonce do provedor (Henrique/Alexandre) — hoje HMAC roda com fixture.
2. **Corpus RAG curado e ratificado pelo RT CREF** — faithfulness real do diálogo depende do corpus definitivo; dev usa corpus-semente.
3. **Respostas-padrão de recusa/fora-de-escopo e mensagem de handoff aprovadas** (Alexandre/RT CREF).
4. **Modelo jurídico de handoff / direito de contestação** (Alexandre, AI Act).
5. **Chaves ZDR+DPA/SCC** e **liberação INPI** (MOVIVO × VIVO) — travas herdadas.
6. **LLM-as-judge com modelo real** (RAGAS-style ancoragem nos chunks do RAG) permanece opcional, atrás de guarda de chave e `skip` no CI — a faithfulness determinística é o gate que morde hoje.
