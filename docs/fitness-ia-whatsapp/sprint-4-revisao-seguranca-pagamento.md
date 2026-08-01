# Revisão de Segurança de Pagamento — Sprint 4 (fluxo de dinheiro)

**Papel:** Sato (Distinguished Security Engineer, §6.4/T-15) — revisão consolidada registrada por Mariana (QA) no fechamento da US-4.7.
**Data:** 2026-08-01
**Escopo:** primeira sprint que **movimenta dinheiro** — checkout, webhook de pagamento, ciclo de vida da assinatura, acesso derivado do estado. Um bug aqui não é resposta ruim: é **fraude, cobrança indevida ou receita fantasma**. O webhook de pagamento é o **vetor de fraude nº 1** (T-15).
**Fontes:** `11-relatorio-sato.md` §6.4 / T-15 (webhook forjado que ativa assinatura falsa) · `ARQUITETURA.md` §8/§12 · reusa o padrão de webhook da Sprint 3.

> **Veredito:** **APROVADO PARA DEV LOCAL** com os controles abaixo implementados e testados. **Pendências de LANÇAMENTO** (não de merge): adaptadores de gateway REAL (Stripe/Asaas em `real-gateways.ts`) + DPA assinado (Sato/Alexandre); preço do plano **Semestral** a definir por Eduardo (placeholder no dev); contratos de assinatura / CDC / reembolso / retenção fiscal (Alexandre); chaves de gateway como secrets. Dev roda com `MockGateway` (mesma interface, sem rede/conta).

---

## 1. Webhook de pagamento: HMAC + T-15 (Sato §6.4)

- Assinatura HMAC-SHA256 sobre o **corpo bruto** (`${timestamp}.${rawBody}`, estilo Asaas; no real, Stripe `constructEvent`) verificada dentro do `PaymentGateway.parseWebhookEvent`; janela de tolerância de 300s. Assinatura ausente/errada/expirada ou **corpo adulterado após assinar** → `null` — o evento **nunca vira ativação**. O controller responde 200 sem processar (não vaza qual camada falhou ao atacante).
- **T-15 coberto:** o atacante que forja um `CHECKOUT_CONFIRMED` para ativar assinatura falsa é rejeitado no boundary. Um vetor plantado que ativasse **falha** a suíte.
- **Evidência:** `payment-security.spec.ts` (forjado/adulterado → null; corpo íntegro parseia) + `mock-gateway.spec.ts` (HMAC válida/tolerância) + `payment-webhook.int-spec.ts` (fluxo real sob RLS).
- `ponytail`: o `MockGateway` imita o real; os adaptadores reais + DPA são bloqueadores de **lançamento**.

## 2. Idempotência de ativação (anti-replay + reentrega)

- Dedup por `event_id` via `SET NX` no Redis (TTL 7d) — reentrega do mesmo evento é descartada. `uniqueIndex(externalSubscriptionId)` é a **2ª barreira** contra ativação dupla. Transição inválida (`InvalidTransitionError`) é ignorada, não corrompe estado.
- **Evidência:** `payment-webhook.service.ts` + `payment-webhook.int-spec.ts` (replay não ativa 2x; reentrega não cria 2ª assinatura).

## 3. PCI-boundary — 0 dado de cartão no backend

- **Checkout hospedado:** o backend só cria a sessão e recebe o `checkoutUrl` do gateway; o cartão é digitado no ambiente PCI do provedor, nunca no nosso. O contrato de API prova o boundary: `createCheckoutSchema` = `{plan, method}` (campo de cartão injetado é descartado pelo schema, nunca persistido); `subscriptionViewSchema` = `{plan, status, access, currentPeriodEnd}` — sem cartão, sem CVV, sem id externo do gateway.
- **Evidência:** `payment-security.spec.ts` (assertividade sobre os dois schemas Zod).

## 4. Ciclo de vida, acesso e isolamento por titular

- Máquina de estados pura (`canTransition`): `TRIALING→ACTIVE→PAST_DUE→CANCELED/PAUSED`, `EXPIRED→ACTIVE` (win-back), `CANCELED` terminal; transições inválidas rejeitadas. Acesso derivado do estado (`resolveAccess`): trial na janela e ACTIVE → FULL; PAST_DUE na graça → FULL (dunning, não bloqueio abrupto); trial expirado/PAUSED/CANCELED/EXPIRED/PAST_DUE pós-graça → RESTRICTED.
- **Isolamento por titular:** assinatura de A nunca lida/alterada por B (RLS + IDOR no acesso por token).
- **Evidência:** `subscription-model.spec.ts` + `subscription.int-spec.ts` (cancelar/pausar/retomar + IDOR).

## 5. Dunning conversacional (decisão do fundador)

- No `payment_failed` → `PAST_DUE`: antes de restringir, a MOVI envia o link de pagamento no WhatsApp (fila `whatsapp-outbound`) durante a janela de graça. Copy dentro dos guardrails (cancelamento sempre possível; nunca "resultado garantido").
- **Evidência:** `payment-webhook.service.ts` (`enqueueDunning`) + `payment-security.spec.ts` (copy sem termo proibido).

## 6. Secrets e confinamento do SDK

- Segredo do webhook e chaves do gateway via secrets (Docker/GitHub), nunca `environment:`. SDK do gateway confinado ao adaptador (`gateway-confinement.spec.ts`) — nenhum outro módulo importa o SDK do provedor.

---

## Matriz de controles × evidência

| Controle (Sato) | Implementação | Evidência (verde) |
|---|---|---|
| HMAC do webhook + T-15 (forjado não ativa) | `mock-gateway.ts` `parseWebhookEvent` | `payment-security.spec.ts`, `mock-gateway.spec.ts` |
| Idempotência de ativação (replay/reentrega) | `payment-webhook.service.ts` (SET NX + uniqueIndex) | `payment-webhook.int-spec.ts` |
| PCI-boundary (0 cartão no backend) | `createCheckoutSchema` / `subscriptionViewSchema` | `payment-security.spec.ts` |
| Ciclo de vida + acesso | `subscription-model.ts` (`canTransition`/`resolveAccess`) | `subscription-model.spec.ts` |
| Isolamento por titular (RLS/IDOR) | RLS + acesso por token | `subscription.int-spec.ts` |
| Unit economics (payback do downgrade) | `PLAN_CATALOG` | `payment-security.spec.ts` |
| Copy nos guardrails | `subscription-messages.ts` | `payment-security.spec.ts` |
| Confinamento do SDK do gateway | adaptadores `payment/` | `gateway-confinement.spec.ts` |

## Pendências para o lançamento (não bloqueiam dev local)

1. **Adaptadores de gateway REAL (Stripe/Asaas) + DPA assinado** (Sato/Alexandre) — hoje roda com `MockGateway`.
2. **Preço do plano Semestral** a definir por Eduardo (placeholder 18900c no dev).
3. **Contratos de assinatura / CDC / reembolso / retenção fiscal** (Alexandre) e ratificação da versão dos Termos (`SUBSCRIPTION_TERMS_VERSION`, hoje rascunho).
4. **Validação de unit economics** de Eduardo por escrito (payback ≤3 meses, LTV/CAC ≥3) sobre os preços finais.
5. **Chaves de gateway como secrets** em produção; **liberação INPI** (MOVIVO × VIVO) — trava herdada.
