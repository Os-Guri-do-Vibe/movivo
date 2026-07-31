# Sprint 4 — Conversão Trial→Assinatura e Pagamento (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-07-31
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 4)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + QA (Mariana), com revisão de segurança de pagamento de Sato, validação financeira de Eduardo e validação jurídica de Alexandre (LGPD/contratos de assinatura)
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§6 filas, §8 segurança/RLS, §10 roadmap, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (**Épico 5 — Conversão Trial→Assinatura**, sequência dias 7/10/13/14, downgrade, win-back, MVP §pagamento) · `docs/fitness-ia-whatsapp/07-relatorio-eduardo.md` (**plano único por período** Mensal R$39 / Trimestral R$99 / Anual R$349, trial 7 dias sem cartão, payback ≤3 meses, LTV/CAC ≥3, Simples Anexo III) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (contratos de assinatura, LGPD dado financeiro, direito de arrependimento CDC, retenção fiscal) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` (§6.4 webhook Stripe/Asaas — `constructEvent`, idempotência por `event_id`, T-15 replay de pagamento; rawBody) · `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (§11 persona MOVI, tom, offboarding-pausa/Peak-End, §13 termos proibidos) · `docs/fitness-ia-whatsapp/05-relatorio-helena.md` (funil de conversão, abertura de WhatsApp, CAC/LTV)

---

## Como ler este documento

Hierarquia: **Épico → User Stories (US-4.x) → Tasks (TASK-4.x.y)**.

- Cada **User Story** declara: agentes participantes e ordem, dependências (depende de / habilita), jornada (o que se constrói e por quê), objetivo, resultado esperado, tasks e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD (code review, teste automatizado verde, quality gate, revisão de segurança de pagamento de Sato, validação financeira de Eduardo e jurídica de Alexandre).
- Esta é a **quarta** sprint de desenvolvimento. As Sprints 1-3 entregaram a porta de entrada (anamnese), o núcleo de valor (protocolo gerado/validado/entregue) e o diálogo recorrente (AI Coach MOVI). **A Sprint 4 entrega a função de sobrevivência do negócio: transformar trialists em assinantes pagantes.** É a primeira sprint que **toca dinheiro** — o que torna a **segurança do webhook de pagamento** (HMAC/`constructEvent` + anti-replay + idempotência de ativação), o **confinamento do SDK do gateway a um único módulo**, a **não-retenção de dado de cartão (PCI)** e o **estado de acesso derivado do gateway** (nunca do app) requisitos **bloqueantes**, não recomendações.

> **Decisão de escopo desta sprint (argumentada) — foco em UM épico coeso: Épico 5 (Conversão + Pagamento).** Restavam três épicos: **5 (Conversão/Pagamento)**, **6 (Check-in Semanal e Retenção)** e **7 (Operações/Dashboard CREF)**. Escolhi o **Épico 5** por três razões de produto:
> 1. **É a função de sobrevivência e é sensível ao tempo.** O trial é de **7 dias sem cartão**; até esta sprint o produto **não consegue receber um único pagamento** — todo trialist expira e é perdido automaticamente. Não há métrica de negócio (MRR, LTV, payback) mensurável sem a capacidade de cobrar. O fundador precisa de receita, e cada trial que expira sem um caminho de conversão é receita permanentemente perdida.
> 2. **É o épico mais coeso e autocontido dos três restantes.** Checkout + webhooks + ciclo de vida da assinatura + sequência de nurturing + downgrade + win-back formam um bloco fechado, que **reusa** a fundação já pronta (fila `conversion-sequence`, tabela `subscriptions` já modelada, outbound WhatsApp, o padrão de webhook HMAC da Sprint 3) sem depender de nada que ainda não exista.
> 3. **A dependência de "retenção antes de monetização" já está parcialmente satisfeita.** O risco clássico de "converter para um balde furado" (Lucas, Risco 5) é real, mas o **valor em-trial já existe**: o usuário recebeu protocolo (Sprint 2) e conversa com MOVI (Sprint 3) — há aha moment e engajamento medível **antes** do dia 7. A retenção de longo prazo (check-in semanal) é o **passo imediatamente seguinte**, mas ela só tem quem reter **depois** que a conversão existe. Construir monetização primeiro é a ordem logicamente correta.
>
> **O que fica explicitamente para depois:** **Épico 6 (Check-in Semanal e Retenção) → Sprint 5**, agora sobre uma base de usuários pagantes reais e reusando geração+validação da Sprint 2 para o ajuste de protocolo. **Épico 7 (Dashboard CREF / Operações) → Sprint 5/6**, para drenar a dívida operacional que se acumulou (protocolos `PENDING_REVIEW` da Sprint 2, `handoff_alerts`/`BLOCKED_PENDING_CLEARANCE` da Sprint 3 — hoje sem interface humana que os acione). **Recomendo enfaticamente que o Dashboard CREF seja a Sprint 5 junto com o Check-in**, porque o check-in também gera protocolos que podem cair em `PENDING_REVIEW`, e a dívida de supervisão CREF é requisito de compliance, não conveniência — ver "Handoff para a Sprint 5".

### Base já entregue pelas Sprints 0-3 (não reconstruir — consumir)

- **Tabela `subscriptions` já modelada (Sprint 0/1):** com `plan`, `priceCents` (centavos, inteiro — nunca float para dinheiro), `status` (`TRIALING`/…), `paymentProvider` (nulo no trial), **`externalSubscriptionId` com `uniqueIndex` (chave de idempotência do webhook — múltiplos NULLs não colidem, comportamento desejado)**, `trialEndsAt`, `currentPeriodStart/End`, `canceledAt`, `cancelReason`, `onDelete: 'restrict'` (assinatura é registro fiscal, não some com o titular). A Sprint 4 **preenche a lógica de negócio** sobre este schema — não o remodela.
- **Fila `conversion-sequence` já registrada (US-1.7):** `attempts: 1`, `concurrency: 5`, sem backoff — **intencional**: uma mensagem ancorada no dia 7 não deve retentar para o dia 8. A Sprint 4 preenche o `ConversionSequenceWorker` — não reconstrói a infraestrutura de filas.
- **Transporte WhatsApp OUTBOUND (US-2.5):** fila `whatsapp-outbound` (rate limit 80 msg/s, idempotência, bolhas + "digitando…", persona MOVI). As mensagens de nurturing e win-back saem por aqui.
- **Padrão de webhook HMAC + anti-replay (US-3.1):** rawBody preservado, `timingSafeEqual`, janela de tolerância de timestamp, nonce/`event_id` único em Redis (`SET NX`). O webhook de **pagamento** reusa exatamente este padrão (Stripe `constructEvent` tolerância 300s / Asaas HMAC — Sato §6.4).
- **AI Coach conversacional (Sprint 3):** engajamento e sinais de valor em-trial (2ª msg/dia, thumbs, treinos auto-reportados) — insumo para o timing e a copy da sequência de conversão.
- **`users` com estado de ciclo de vida (`ONBOARDING`/`ACTIVE`/…) e `trial_ends_at` derivável:** o gate de acesso pós-trial deriva do estado da assinatura.
- **Isolamento por titular (RLS `FORCE ROW LEVEL SECURITY` + `SET LOCAL`):** estende-se a `subscriptions` e aos eventos de conversão. Nenhum job de A lê/altera assinatura de B.

### Regras inegociáveis que valem nesta sprint (de `ARQUITETURA.md` §12, `11-sato` §6, `06-alexandre`, `07-eduardo`)

1. **O webhook de pagamento NUNCA confia no corpo sem verificar** (Sato §6.4, T-15): Stripe via `stripe.webhooks.constructEvent` (assinatura + tolerância 300s); Asaas via HMAC sobre rawBody + `timingSafeEqual`. **Idempotência obrigatória** por `event_id`/`externalSubscriptionId` (`SET NX` + o `uniqueIndex` do schema) — um evento reentregue **nunca** ativa a assinatura duas vezes nem cria uma segunda. Reusa o rawBody/anti-replay da US-3.1.
2. **O SDK do gateway fica confinado a um único serviço** (`PaymentGatewayService`, padrão do `LLMRouter`): nenhum outro módulo importa SDK Stripe/Asaas. Troca de provedor (Stripe↔Asaas) é decisão de configuração, não refactor. **Em dev roda mockado** (mesmo contrato/interface dos provedores reais), com chaves de teste — o gateway real é bloqueador de **lançamento**, não de dev.
3. **Nunca armazenar dado de cartão** (PCI-DSS): o checkout é **hospedado pelo gateway** (Stripe Checkout / Asaas hosted). O sistema guarda apenas `externalSubscriptionId`, `status`, `plan`, `priceCents` — jamais PAN/CVV/validade. Nenhum dado de cartão trafega pelo nosso backend.
4. **O estado de acesso deriva da assinatura, cuja fonte da verdade é o gateway** (via webhook): trial expira → acesso restrito; conversão confirmada pelo webhook → `ACTIVE`; `past_due` → período de graça antes de restringir. O app **não** ativa acesso por conta própria — espera o evento do gateway.
5. **Copy de conversão dentro dos guardrails** (Sofia §13, Gabriel/Clóvis): nunca "resultado garantido", "diagnóstico", "cura"; **garantia de cancelamento a qualquer momento sempre visível**; respaldo CREF presente; tom persona MOVI. Templates de nurturing/win-back **pré-aprovados por Alexandre/Sofia**.
6. **Sem dark patterns** (anti-métrica de Lucas): cancelamento e downgrade são **self-service e fáceis**. Não inflar conversão com fricção de saída — a Peak-End Rule (Sofia) diz que o fim da experiência define a memória (e o win-back futuro).
7. **Sequência de conversão idempotente e ancorada no tempo:** cada touchpoint (dias 7/10/13/14) dispara **uma única vez por usuário**; quem já converteu **para de receber**; mensagem atrasada não dispara fora da janela (a fila é `attempts: 1`, sem retry, por design).
8. **LGPD + fiscal + CDC** (Alexandre): dado financeiro mínimo; `subscriptions` é registro fiscal (`onDelete: 'restrict'`) — exclusão de conta pós-cancelamento **não** apaga o histórico fiscal exigido por lei; **direito de arrependimento (CDC Art. 49, 7 dias)** e garantia de reembolso refletidos na copy e no fluxo.
9. **Dinheiro em centavos inteiros, sempre** (schema): nenhum `float`/`numeric` para valor monetário; toda aritmética de preço/desconto em centavos.
10. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI; cobertura ≥80%; testes de segurança de pagamento (assinatura inválida, replay, idempotência de ativação) e de isolamento **bloqueantes**. Nenhum push direto.

---

# ÉPICO 5 — Conversão Trial→Assinatura e Pagamento

### Descrição

Fechar o **ciclo de monetização da MOVIVO**: transformar trialists engajados em assinantes pagantes e sustentar o ciclo de vida da assinatura. O épico tem seis blocos construídos nesta sprint: (1) o **`SubscriptionModule` + `PaymentGatewayService`** confinado (Stripe/Asaas, mockado em dev) que modela planos, preços e o ciclo de vida da assinatura sobre a tabela `subscriptions` já existente; (2) o **checkout hospedado** (link de assinatura pré-preenchido enviado no WhatsApp) + os **webhooks de pagamento** (HMAC/`constructEvent` + idempotência) que ativam a assinatura e mantêm o estado sincronizado com o gateway; (3) o **`ConversionSequenceWorker`** sobre a fila `conversion-sequence` que dispara a sequência de nurturing nos dias 7/10/13/14; (4) o **downgrade** (oferecer o plano mais barato antes de perder o usuário) e o **win-back** (3 dias pós-trial, pergunta o motivo); (5) o **cancelamento self-service + offboarding-pausa** (transformar cancelamento em pausa, Peak-End/Sofia); e (6) a **página de checkout/gestão de assinatura** (Felipe). Fecha com uma US de **QA + segurança de pagamento** (assinatura inválida, replay, idempotência de ativação, estados do ciclo de vida, isolamento) como gate bloqueante, com revisão de Sato e validação de Eduardo/Alexandre.

### Objetivo

Ao final da Sprint 4, um trialist engajado recebe, na janela do dia 7 ao 14, uma **sequência de mensagens de conversão** com um **link de checkout pré-preenchido**; ao pagar no checkout hospedado do gateway, o **webhook confirma o pagamento**, ativa a assinatura de forma **idempotente** e libera o acesso pago; se o usuário hesita, recebe uma **oferta de downgrade** antes de perder o acesso; se não converte, entra num **fluxo de win-back**; e a qualquer momento pode **cancelar self-service** (com a opção de **pausar** em vez de cancelar). Tudo com **0 dado de cartão armazenado**, **idempotência de ativação garantida**, copy dentro dos guardrails, e o estado de acesso sempre derivado do gateway.

### Resultado esperado do épico

- **`SubscriptionModule` + `PaymentGatewayService`** (confinado, mockado em dev): modela os planos **Mensal R$39 (3900c) / Trimestral R$99 (9900c)** — MVP — e o ciclo de vida (`TRIALING`→`ACTIVE`→`PAST_DUE`→`CANCELED`); SDK do gateway isolado; troca de provedor por config.
- **Checkout hospedado + webhooks de pagamento**: link de assinatura pré-preenchido (plano pré-selecionado); webhook com `constructEvent`/HMAC + tolerância + idempotência por `event_id`/`externalSubscriptionId`; ativação idempotente; sincronização de estado (pagamento aprovado/falho/reembolso/cancelamento no gateway).
- **`ConversionSequenceWorker`** sobre `conversion-sequence`: dias 7 (check-in de progresso + 1ª menção ao plano), 10 (resultados + urgência suave), 13 (link direto + garantia), 14 (última chamada + oferta de downgrade); idempotente; para quem já converteu; ancorado no tempo.
- **Downgrade + win-back**: no dia 14, se não converteu no plano cheio, oferta do plano mais barato (Mensal); 3 dias pós-trial, mensagem de win-back perguntando o motivo (insumo de `cancel_reason`/objeção).
- **Cancelamento self-service + offboarding-pausa**: cancelar é fácil; antes de confirmar, oferecer **pausa** (Peak-End); registrar `cancelReason`.
- **Página de checkout/gestão de assinatura** (Felipe): mobile-first, sobre "O Pulso", guardrails, garantia de cancelamento visível, respaldo CREF; portal de gestão (plano atual, próxima cobrança, cancelar/pausar).
- **Gate de acesso pós-trial**: trial expira → acesso restrito (mensagem de conversão, não bloqueio abrupto); `ACTIVE` → acesso pleno; `PAST_DUE` → graça.
- **Quality gate de pagamento** bloqueante: assinatura de webhook inválida rejeitada; replay não ativa 2x; idempotência de ativação; estados do ciclo de vida corretos; isolamento por titular; copy nos guardrails. Revisão de Sato + validação de Eduardo (unit economics)/Alexandre (contratos/LGPD/CDC) registradas.
- CI verde; cobertura ≥80%; toda entrega via PR + 6 checks.

### Não-escopo desta sprint (para não haver ambiguidade)

A fronteira da Sprint 4 é **"converter e cobrar com segurança"**. Ficam **explicitamente fora**:

- **Check-in Semanal e Retenção (Épico 6 → Sprint 5):** `CheckinWeeklyWorker` + cron/`repeat`, o formato de 3 quick replies (semáforo de cansaço/treinos/pedido de ajuste, Sofia §11.5), o **ajuste de protocolo** reusando geração+validação da Sprint 2, o loop visível ("ajustei seu treino…") e o reengajamento de inativos. Motivo: retenção opera sobre **usuários pagantes**, que só passam a existir **depois** desta sprint. É o passo imediatamente seguinte, com a fundação de conversão já pronta.
- **Dashboard CREF / Operações (Épico 7 → Sprint 5/6):** a UI do painel do profissional, a fila de `PENDING_REVIEW`/`handoff_alerts`/`BLOCKED_PENDING_CLEARANCE`, a edição manual do protocolo, a assinatura per-usuário, a liberação das sessões bloqueadas por PAR-Q, o dashboard de funil/SLA e a notificação Socket.io. Motivo: é um épico operacional independente da monetização; **recomendo fortemente que seja Sprint 5 junto com o Check-in** (ver Handoff), pois a dívida de supervisão CREF já tem duas sprints de profundidade.
- **Planos anuais no MVP:** o schema `subscriptions` suporta Anual (R$349/34900c) e Eduardo o validou, mas o **MVP oferece Mensal + Trimestral** (Lucas, MVP §"planos anuais → Fase 2"): validar a retenção mensal/trimestral **antes** de vender compromisso anual. O Anual fica **dark-launched** (código pronto, não ofertado na UI) até a retenção de 30/90 dias justificar. **(Ver pergunta em aberto ao fundador.)**
- **PIX recorrente automático (Fase 2):** o BC regulamentou recorrência PIX em 2026, mas fica para o roadmap Q2 (Lucas). No MVP, cartão via gateway hospedado (+ PIX/boleto avulso se o gateway oferecer nativamente no checkout, sem lógica de recorrência própria).
- **Cupons/promoções/referral pago, cobrança por uso, upsell entre tiers:** o modelo é **plano único por período, sem tiering de features** (Eduardo) — não há upsell de features a construir. Cupom é Fase 2.

### Mapa de dependências entre User Stories

```
US-4.1 (SubscriptionModule + PaymentGatewayService confinado, mockado · Leonardo+Eduardo) ─┐
US-4.2 (Checkout hospedado + webhooks de pagamento HMAC/idempotência · Leonardo+Sato) ──────┤
        └── depende de US-4.1 (modelo de assinatura/gateway)                                │
US-4.3 (ConversionSequenceWorker dias 7/10/13/14 · Leonardo) ── depende de US-4.1 + US-2.5  │
US-4.4 (Downgrade + win-back · Leonardo+Helena ref.) ── depende de US-4.2 + US-4.3          │
US-4.5 (Cancelamento self-service + offboarding-pausa · Leonardo+Sofia ref.) ── dep. US-4.2 │
US-4.6 (Frontend: checkout + portal de gestão · Felipe) ── consome US-4.1/US-4.2            │
US-4.7 (QA + segurança de pagamento · Mariana+Sato+Eduardo+Alexandre) ── valida US-4.1 a 4.6┘
```

**Sequência prática recomendada (10 dias úteis):** **US-4.1 (modelo/gateway) começa no dia 1** — é a fundação de que todo o resto depende (Leonardo lidera, Eduardo valida preços/estados). US-4.2 (checkout + webhooks) dias 2-6, o bloco de segurança crítico (Leonardo + Sato). US-4.3 (sequência de conversão) dias 3-7, em paralelo, reusando o outbound. US-4.4 (downgrade/win-back) e US-4.5 (cancelamento/pausa) dias 6-9, sobre o checkout e a sequência. US-4.6 (frontend) dias 3-9, com mocks e integrando quando a persistência estabiliza. US-4.7 (QA + segurança) corre do dia 3 ao 10, fechando a sprint — os testes de webhook forjado/replay/idempotência são construídos junto com o código que protegem.

---

## US-4.1 — SubscriptionModule + PaymentGatewayService confinado (planos, ciclo de vida, mock de dev)

**Agentes:** Leonardo (lead — `SubscriptionModule`, `PaymentGatewayService`, máquina de estados, persistência) · Eduardo (valida planos/preços/estados e o impacto em unit economics) · Alexandre (valida o contrato de assinatura e a base legal do tratamento de dado financeiro).
**Depende de:** tabela `subscriptions` já modelada (Sprint 0/1). É a **fundação** — começa no dia 1.
**Habilita:** US-4.2 (checkout/webhooks operam sobre este modelo), US-4.3 (a sequência lê o estado da assinatura), US-4.6 (o frontend consome os planos/estados).

### Jornada

Aqui vive a decisão de produto **"plano único por período, sem tiering de features"** (Eduardo): a retenção vem do **compromisso de período**, não de gate de funcionalidade — então não há upsell de features a modelar, apenas **planos por duração**. Leonardo implementa o `SubscriptionModule` sobre a tabela `subscriptions` existente (preços em **centavos inteiros**, `externalSubscriptionId` como chave de idempotência já indexada) e o **`PaymentGatewayService`** — um serviço confinado, no mesmo espírito do `LLMRouter`: **o único ponto do sistema autorizado a falar com o gateway de pagamento**, com uma interface estável (`createCheckoutSession`, `parseWebhookEvent`, `cancelSubscription`, `getSubscription`) que abstrai Stripe **ou** Asaas por trás de config. **Em dev, roda um adaptador mockado** que implementa a mesma interface e emite eventos de webhook simulados — consistente com a realidade do projeto (gateway real é bloqueador de lançamento, não de dev). A peça central é a **máquina de estados da assinatura** (`TRIALING`→`ACTIVE`→`PAST_DUE`→`CANCELED`, + `PAUSED` para o offboarding-pausa da US-4.5), cujas transições são **disparadas por eventos do gateway** (US-4.2), nunca pelo app arbitrariamente. Eduardo valida os planos (Mensal 3900c / Trimestral 9900c; Anual 34900c dark-launched) e que as transições preservam o unit economics; Alexandre valida o contrato de assinatura e a base legal.

### Objetivo

Ter um `SubscriptionModule` com um `PaymentGatewayService` confinado (mockado em dev) que modela os planos por período e uma máquina de estados de assinatura cujas transições são governadas por eventos do gateway, sobre a tabela `subscriptions` existente.

### Resultado esperado

Um usuário em trial tem uma `subscriptions` `TRIALING` com `trialEndsAt`; um checkout confirmado transiciona para `ACTIVE`; a interface do gateway é a única porta para o provedor; trocar Stripe↔Asaas é config; o mock de dev emite os mesmos eventos do provedor real; nenhum outro módulo importa SDK de gateway.

### Tasks

**TASK-4.1.1 — Modelo de planos e máquina de estados da assinatura (Leonardo + Eduardo).**
Modelar os planos (Mensal 3900c / Trimestral 9900c; Anual 34900c **dark-launched**, não ofertado na UI) e a máquina de estados `TRIALING`→`ACTIVE`→`PAST_DUE`→`CANCELED` (+ `PAUSED`, US-4.5) sobre `subscriptions`. Transições **só** por evento válido (do gateway ou ação self-service autorizada); toda transição sob RLS/`SET LOCAL`. Aritmética de preço em centavos inteiros. Eduardo valida preços/estados/impacto em unit economics.
**Conclusão:** planos e transições implementados e testados; transição inválida rejeitada; tudo em centavos; Eduardo aprova por escrito.

**TASK-4.1.2 — PaymentGatewayService confinado + adaptador mock de dev (Leonardo + Sato ref.).**
Implementar o `PaymentGatewayService` com interface estável (`createCheckoutSession`, `parseWebhookEvent`, `cancelSubscription`, `getSubscription`), abstraindo Stripe/Asaas por config. SDK do gateway **confinado a este serviço** (teste estrutural: nenhum outro módulo importa SDK de gateway — padrão do `LLMRouter`). **Adaptador mock** para dev/CI que implementa a mesma interface e emite eventos de webhook simulados (checkout confirmado, pagamento falho, cancelamento, reembolso). Chaves de gateway via Docker/GitHub Secrets, nunca `environment:`.
**Conclusão:** gateway acessível só via o serviço; teste estrutural de confinamento verde; mock emite os eventos do ciclo de vida; chaves via secret.

**TASK-4.1.3 — Contrato de assinatura e base legal (Alexandre + Leonardo).**
Refletir no modelo/fluxo os requisitos jurídicos (Alexandre): termos de assinatura versionados e aceitos no checkout (registro do aceite com timestamp/versão), **direito de arrependimento CDC (7 dias)**, política de reembolso, retenção fiscal de `subscriptions` (`onDelete: 'restrict'` já no schema — exclusão de conta não apaga histórico fiscal). Base legal do tratamento de dado financeiro documentada.
**Conclusão:** aceite de termos registrado (versão/timestamp); reembolso/arrependimento previstos no fluxo; Alexandre valida contrato e base legal por escrito.

### Definição de Pronto (US-4.1 "validada")

- [ ] Tasks 4.1.1–4.1.3 concluídas.
- [ ] Planos por período + máquina de estados governada por eventos; `PaymentGatewayService` confinado (mock em dev); preços em centavos; SDK de gateway não vaza para outros módulos.
- [ ] Contrato de assinatura, arrependimento CDC e retenção fiscal refletidos.
- [ ] **Validada por:** code review + **validação de Eduardo** (planos/estados/unit economics) + **validação de Alexandre** (contrato/base legal/CDC) + teste estrutural de confinamento verde (US-4.7).

---

## US-4.2 — Checkout hospedado + webhooks de pagamento (HMAC/constructEvent + idempotência de ativação)

**Agentes:** Leonardo (lead — checkout, `WebhookController` de pagamento, ativação idempotente, sincronização de estado) · Sato (valida assinatura/anti-replay/idempotência do webhook — §6.4/T-15) · Henrique (colabora — credenciais do gateway, allowlist/regra Cloudflare, observabilidade de pagamento).
**Depende de:** US-4.1 (modelo/gateway), US-3.1 (padrão de webhook HMAC/rawBody/anti-replay reusado). Bloco de segurança crítico — dias 2-6.
**Habilita:** US-4.3 (a sequência envia o link de checkout), US-4.4/US-4.5 (operam sobre a assinatura ativa), US-4.6 (o frontend redireciona ao checkout).

### Jornada

Este é o **bloco que toca dinheiro** — e o vetor de fraude nº 1 (Sato T-15: webhook de pagamento forjado → ativa assinatura falsa). O **checkout é hospedado pelo gateway** (Stripe Checkout / Asaas hosted): o nosso backend cria uma sessão de checkout com o **plano pré-selecionado** e devolve um **link**, que MOVI envia no WhatsApp (US-4.3) ou o frontend abre (US-4.6) — **nenhum dado de cartão passa pelo nosso sistema** (PCI). A confirmação do pagamento chega por **webhook**, e aqui a segurança é inegociável (Sato §6.4, reusando o padrão da US-3.1): **ler o corpo BRUTO** antes de qualquer parse; **Stripe** via `stripe.webhooks.constructEvent` (assinatura + tolerância 300s); **Asaas** via HMAC sobre rawBody + `timingSafeEqual`; **idempotência obrigatória** por `event_id` (`SET NX` em Redis) **e** pelo `uniqueIndex(externalSubscriptionId)` do schema — um evento reentregue **jamais** ativa a assinatura duas vezes nem cria uma segunda. O webhook responde **200 rápido** e processa a transição de estado (US-4.1): `checkout.completed`→`ACTIVE` + libera acesso; `payment_failed`→`PAST_DUE` (graça); `refund`/`canceled`→estado correspondente. O **estado de acesso deriva daqui, não do app**. Henrique cuida das credenciais (secret), allowlist de IP do gateway (se publicado) e observabilidade (pagamentos aprovados/falhos/replays).

### Objetivo

Ter o checkout hospedado (link com plano pré-selecionado, 0 dado de cartão no backend) e o webhook de pagamento que verifica assinatura, resiste a replay, ativa a assinatura de forma idempotente e mantém o estado sincronizado com o gateway.

### Resultado esperado

Um link de checkout abre a sessão hospedada com o plano certo; um pagamento confirmado ativa a assinatura uma única vez (mesmo com reentrega do evento); um webhook forjado é rejeitado; um `payment_failed` coloca em `PAST_DUE`; nenhum dado de cartão toca o backend; o acesso pago é liberado só após o evento do gateway.

### Tasks

**TASK-4.2.1 — Sessão de checkout hospedada com plano pré-selecionado (Leonardo).**
Implementar `createCheckoutSession(userId, plan)` via `PaymentGatewayService` (US-4.1): cria a sessão no gateway com o **plano pré-selecionado**, `externalSubscriptionId` vinculado, URLs de sucesso/cancelamento, e registra o aceite de termos (US-4.1.3). Devolve o **link** (não renderiza cartão — checkout hospedado). Aceita PIX/boleto se o gateway oferecer nativamente no checkout (sem recorrência própria). Idempotência: reabrir checkout do mesmo usuário/plano não duplica assinatura.
**Conclusão:** link de checkout abre a sessão hospedada com plano certo; nenhum dado de cartão no backend; reabertura idempotente.

**TASK-4.2.2 — WebhookController de pagamento: assinatura + anti-replay + idempotência (Leonardo + Sato).**
Implementar `POST /webhook/payment` reusando o padrão da US-3.1: **rawBody** preservado; **Stripe** `constructEvent` (tolerância 300s) / **Asaas** HMAC+`timingSafeEqual`; **idempotência** por `event_id` (`SET NX` TTL) + `uniqueIndex(externalSubscriptionId)`; assinatura inválida/replay → 200 + log de segurança. Processar as transições (US-4.1): `checkout.completed`→`ACTIVE`+libera acesso; `payment_failed`→`PAST_DUE`; `refund`/`subscription.canceled`→estado correspondente. Responder 200 rápido; a transição roda sob RLS.
**Conclusão:** webhook forjado rejeitado; replay não ativa 2x nem cria 2ª assinatura; cada evento mapeia à transição correta; acesso liberado só após evento válido; eventos de segurança logados.

**TASK-4.2.3 — Gate de acesso derivado da assinatura + observabilidade (Leonardo + Henrique).**
Implementar o gate de acesso derivado do estado da assinatura (não do app): `TRIALING` dentro da janela → acesso; trial expirado sem conversão → acesso restrito (recebe conversão, não bloqueio abrupto); `ACTIVE`→pleno; `PAST_DUE`→graça configurável antes de restringir. Instrumentar eventos (`subscription_created`, `subscription_cancelled`, `payment_failed`) no PostHog e métricas de pagamento (aprovados/falhos/replays) no Grafana (Henrique); alerta de pico de webhooks inválidos (P2 — tentativa de fraude).
**Conclusão:** acesso reflete o estado da assinatura; trial expirado não bloqueia abruptamente; eventos/métricas instrumentados; alerta de webhook inválido ativo.

### Definição de Pronto (US-4.2 "validada")

- [ ] Tasks 4.2.1–4.2.3 concluídas.
- [ ] Checkout hospedado (0 dado de cartão no backend, plano pré-selecionado); webhook com assinatura + anti-replay + idempotência de ativação; estado sincronizado com o gateway; acesso derivado da assinatura.
- [ ] **Validada por:** code review + **revisão de segurança de pagamento de Sato** (§6.4/T-15 — assinatura, replay, idempotência) + testes de webhook forjado/replay/idempotência verdes (US-4.7).

---

## US-4.3 — ConversionSequenceWorker: sequência de nurturing dias 7/10/13/14

**Agentes:** Leonardo (lead — processor da fila, agendamento por âncora de tempo, idempotência) · Helena (referência — funil/copy de conversão) · Sofia (referência — persona MOVI, tom).
**Depende de:** US-4.1 (lê o estado da assinatura), US-4.2 (envia o link de checkout), US-2.5 (outbound WhatsApp), US-1.7 (fila `conversion-sequence`). Dias 3-7.
**Habilita:** US-4.4 (downgrade no dia 14).

### Jornada

Aqui vive a decisão de produto de Lucas (Épico 5): **o link único no dia 14 é tarde demais** — a decisão de converter é feita no pico do engajamento, então a conversão é uma **sequência de nurturing**, não um evento. Leonardo preenche o `ConversionSequenceWorker` sobre a fila `conversion-sequence` (**`attempts: 1`, sem backoff — por design**: uma mensagem ancorada no dia 7 não deve retentar para o dia 8). A sequência (Lucas): **Dia 7** — check-in de progresso ("você está mandando bem!") + 1ª menção ao plano; **Dia 10** — resultados dos 10 dias + urgência suave ("faltam 4 dias"); **Dia 13** — link direto de checkout (plano pré-selecionado) + garantia (7 dias/CDC); **Dia 14** — última chamada + oferta de downgrade (US-4.4). Cada touchpoint é **idempotente e ancorado no tempo** (dispara uma vez por usuário; usa `trialEndsAt` e o estado da assinatura); **quem já converteu (`ACTIVE`) para de receber** — checar o estado antes de enviar. As mensagens saem pelo outbound (persona MOVI, bolhas), com copy pré-aprovada (Helena/Sofia/Alexandre) dentro dos guardrails (garantia de cancelamento visível, nunca "resultado garantido"). O engajamento em-trial (thumbs, 2ª msg/dia, treinos auto-reportados — Sprint 3) personaliza o "resultados obtidos".

### Objetivo

Ter o `ConversionSequenceWorker` disparando a sequência de nurturing nos dias 7/10/13/14, ancorada no tempo, idempotente, que para para quem já converteu, com link de checkout pré-preenchido e copy nos guardrails.

### Resultado esperado

Um trialist no dia 7 recebe a 1ª mensagem; no dia 13 recebe o link de checkout com o plano pré-selecionado; quem converteu no dia 9 não recebe as mensagens dos dias 10/13/14; nenhum touchpoint dispara duas vezes; mensagem atrasada não sai fora da janela.

### Tasks

**TASK-4.3.1 — Agendamento por âncora de tempo + idempotência (Leonardo).**
Agendar os jobs dos dias 7/10/13/14 ancorados em `trialEndsAt`/início do trial (BullMQ `delay`/scheduled). Idempotência: cada touchpoint dispara uma vez por usuário (guard por chave `user_id + touchpoint`); **checar o estado da assinatura antes de enviar** — se `ACTIVE` (já converteu), pular o restante da sequência. Fila `attempts: 1` (sem retry): touchpoint que falha não reenvia fora da janela.
**Conclusão:** touchpoints disparam nas âncoras corretas; nenhum dispara 2x; convertido para de receber; falha não reenvia fora da janela.

**TASK-4.3.2 — Copy da sequência (dias 7/10/13/14) + link pré-preenchido (Leonardo + Helena/Sofia ref.).**
Implementar as 4 mensagens (Lucas §Épico 5) com templates **pré-aprovados** (Helena/Sofia/Alexandre), persona MOVI, dentro dos guardrails (garantia de cancelamento, respaldo CREF, nunca "resultado garantido"). Dia 13/14 embute o **link de checkout pré-preenchido** (US-4.2, plano pré-selecionado). Personalizar "resultados dos 10 dias" com sinais de engajamento em-trial (Sprint 3). Emitir `conversion_message_sent` (PostHog) por touchpoint.
**Conclusão:** 4 mensagens enviadas via outbound nos guardrails; link pré-preenchido nos dias 13/14; evento por touchpoint; copy aprovada por escrito.

### Definição de Pronto (US-4.3 "validada")

- [ ] Tasks 4.3.1–4.3.2 concluídas.
- [ ] Sequência 7/10/13/14 ancorada no tempo, idempotente, para para convertidos; link de checkout pré-preenchido; copy pré-aprovada nos guardrails.
- [ ] **Validada por:** code review + revisão de copy (Helena/Sofia/guardrails) + teste de idempotência/parada-por-conversão verde (US-4.7).

---

## US-4.4 — Downgrade e win-back pós-trial

**Agentes:** Leonardo (lead — oferta de downgrade, fluxo de win-back) · Helena (referência — objeções/win-back) · Sofia (referência — tom).
**Depende de:** US-4.2 (assinatura/checkout), US-4.3 (dia 14 dispara o downgrade). Dias 6-9.
**Habilita:** recuperação de conversão e insumo de retenção (motivos de churn).

### Jornada

Duas peças de recuperação de receita (Lucas §Épico 5). **(1) Downgrade antes de perder o acesso:** no dia 14, se o usuário não converteu no plano oferecido, oferecer o **plano mais barato (Mensal R$39)** como último recurso antes de perder o usuário — reduz o atrito da decisão de preço para o ICP sensível a preço (Clóvis/Eduardo). Como o modelo é **plano único por período** (sem tiering de features), "downgrade" = **mudar para o período mais curto/barato**, não perder funcionalidade. **(2) Win-back pós-trial:** 3 dias após o encerramento do trial sem conversão, uma mensagem **sem julgamento** perguntando o motivo (registra em `cancelReason`/objeção) — se a objeção for resolvível (preço → oferta; dúvida → esclarecimento), há chance de recuperar; e o motivo alimenta a retenção futura. Ambas as copies são pré-aprovadas, nos guardrails, tom MOVI, **sem dark patterns** (a saída é digna — Peak-End/Sofia).

### Objetivo

Ter a oferta de downgrade no dia 14 (plano mais barato antes de perder o usuário) e o fluxo de win-back 3 dias pós-trial (pergunta o motivo, registra a objeção, oferece recuperação quando resolvível).

### Resultado esperado

Um usuário que não converteu no dia 14 recebe a oferta do plano Mensal; um usuário que expirou sem converter recebe, 3 dias depois, a mensagem de win-back; o motivo declarado é registrado; a copy é digna e sem dark pattern.

### Tasks

**TASK-4.4.1 — Oferta de downgrade no dia 14 (Leonardo + Helena/Eduardo ref.).**
No touchpoint do dia 14 (US-4.3), se não convertido, oferecer o **plano mais barato (Mensal)** com link de checkout pré-preenchido nesse plano. Eduardo valida que o downgrade preserva o unit economics (payback ≤3 meses no plano mensal). Idempotente; para se converter.
**Conclusão:** oferta de downgrade enviada quando não convertido no dia 14; link no plano mensal; Eduardo confirma unit economics; idempotente.

**TASK-4.4.2 — Win-back pós-trial + registro de motivo (Leonardo + Helena ref.).**
3 dias após o fim do trial sem conversão, enviar mensagem de win-back sem julgamento perguntando o motivo; capturar a resposta em `cancelReason`/objeção; se resolvível (preço/dúvida), oferecer recuperação (link/esclarecimento). Emitir `winback_sent`/`winback_responded` (PostHog). Copy pré-aprovada, sem dark pattern.
**Conclusão:** win-back dispara 3 dias pós-trial; motivo registrado; recuperação oferecida quando resolvível; eventos emitidos; copy aprovada.

### Definição de Pronto (US-4.4 "validada")

- [ ] Tasks 4.4.1–4.4.2 concluídas.
- [ ] Downgrade no dia 14 (plano mais barato, unit economics preservado) + win-back 3 dias pós-trial com registro de motivo; sem dark patterns.
- [ ] **Validada por:** code review + validação de Eduardo (unit economics do downgrade) + revisão de copy (Helena/Sofia/guardrails) verde (US-4.7).

---

## US-4.5 — Cancelamento self-service e offboarding-pausa

**Agentes:** Leonardo (lead — cancelamento, estado `PAUSED`, sincronização com o gateway) · Sofia (referência — offboarding-pausa, Peak-End) · Alexandre (valida cancelamento/reembolso/CDC).
**Depende de:** US-4.1 (estado `PAUSED`), US-4.2 (sincroniza cancelamento com o gateway). Dias 6-9.
**Habilita:** a saída digna (Peak-End) que sustenta o win-back futuro e reduz o churn irreversível.

### Jornada

A decisão de produto de Sofia/Lucas (gap 4): **o fim da experiência define a memória (Peak-End Rule)** — um cancelamento difícil gera um detrator; um cancelamento digno com opção de **pausa** preserva a relação e cria um caminho de volta. Leonardo implementa o **cancelamento self-service** (fácil, sem fricção artificial — anti-dark-pattern, guardrail 6): antes de confirmar o cancelamento, oferecer **pausar a assinatura** (estado `PAUSED` — mantém o histórico/protocolo, suspende a cobrança) em vez de cancelar de vez. O cancelamento e a pausa **sincronizam com o gateway** (via `PaymentGatewayService`, US-4.1/4.2) e registram `cancelReason`. Respeitar o **direito de arrependimento (CDC 7 dias)** e a política de reembolso (Alexandre). A copy é acolhedora, tom MOVI, respaldo CREF; a exclusão de conta **não apaga o histórico fiscal** de `subscriptions` (retenção legal, `onDelete: 'restrict'`).

### Objetivo

Ter o cancelamento self-service fácil, com a opção de pausa (Peak-End) antes de cancelar, sincronizado com o gateway, respeitando CDC/reembolso e a retenção fiscal, com o motivo registrado.

### Resultado esperado

Um usuário cancela em poucos toques; antes de confirmar, é oferecida a pausa; a pausa suspende a cobrança e mantém o histórico; o cancelamento sincroniza com o gateway; o motivo é registrado; o arrependimento CDC/reembolso é respeitado; o histórico fiscal permanece.

### Tasks

**TASK-4.5.1 — Cancelamento self-service + sincronização com o gateway (Leonardo + Alexandre).**
Implementar o cancelamento self-service (endpoint + ação no portal, US-4.6) que chama `cancelSubscription` (US-4.1) e sincroniza com o gateway; registrar `cancelReason` e `canceledAt`; respeitar arrependimento CDC (7 dias) e reembolso (Alexandre). Sem fricção artificial (guardrail 6). Exclusão de conta preserva histórico fiscal (`onDelete: 'restrict'`).
**Conclusão:** cancelamento funciona self-service e sincroniza com o gateway; motivo/data registrados; CDC/reembolso respeitados; histórico fiscal preservado; Alexandre valida.

**TASK-4.5.2 — Offboarding-pausa (estado PAUSED) (Leonardo + Sofia ref.).**
Antes de confirmar o cancelamento, oferecer **pausar** (estado `PAUSED`, US-4.1): suspende a cobrança, mantém histórico/protocolo, permite retomar depois. Copy acolhedora (Peak-End/Sofia), tom MOVI, nos guardrails. Emitir `subscription_paused`/`subscription_cancelled` (PostHog).
**Conclusão:** pausa oferecida antes do cancelamento; `PAUSED` suspende cobrança e mantém histórico; retomada possível; eventos emitidos; copy aprovada.

### Definição de Pronto (US-4.5 "validada")

- [ ] Tasks 4.5.1–4.5.2 concluídas.
- [ ] Cancelamento self-service fácil + offboarding-pausa (`PAUSED`) sincronizados com o gateway; CDC/reembolso/retenção fiscal respeitados; motivo registrado; sem dark patterns.
- [ ] **Validada por:** code review + **validação de Alexandre** (cancelamento/CDC/reembolso) + revisão de copy (Sofia/guardrails) + teste de sincronização verde (US-4.7).

---

## US-4.6 — Frontend: página de checkout e portal de gestão de assinatura

**Agentes:** Felipe (lead) · consome US-4.1/US-4.2 · Sofia (referência de UX) · Leonardo (endpoints).
**Depende de:** US-4.1 (planos/estados), US-4.2 (redireciona ao checkout hospedado). Pode começar com mocks (dias 3-9).
**Habilita:** a conversão via web (complemento ao link do WhatsApp) e a gestão self-service.

### Jornada

O checkout acontece **hospedado pelo gateway** (PCI), mas o usuário precisa de uma **página de seleção/confirmação de plano** que o leva até lá, e de um **portal de gestão** (plano atual, próxima cobrança, cancelar/pausar). Felipe constrói ambos sobre o design system "O Pulso", mobile-first, acessível (WCAG 2.2 AA), acessível por token (mesmo padrão não-autenticado do MVP, ADR-006). A página de planos mostra **Mensal + Trimestral** (Anual dark-launched não aparece), com o **plano pré-selecionado** recomendado, a **garantia de cancelamento a qualquer momento sempre visível**, o respaldo CREF, e um CTA que redireciona ao checkout hospedado (US-4.2) — **nenhum campo de cartão na nossa UI**. O portal de gestão consome o estado da assinatura (US-4.1) e expõe cancelar/pausar (US-4.5). Toda a copy nos guardrails (nunca "resultado garantido").

### Objetivo

Uma página de seleção/confirmação de plano (mobile-first, acessível, guardrails, garantia visível) que redireciona ao checkout hospedado, e um portal de gestão que expõe o estado da assinatura e cancelar/pausar — sem nenhum dado de cartão na nossa UI.

### Resultado esperado

A página mostra Mensal + Trimestral com plano recomendado e garantia visível; o CTA leva ao checkout hospedado; o portal mostra plano/próxima cobrança e permite cancelar/pausar; token inválido não expõe dado; `pnpm --filter web build` verde; axe sem violação crítica.

### Tasks

**TASK-4.6.1 — Página de seleção/confirmação de plano (Felipe + Sofia ref.).**
Página mobile-first sobre "O Pulso" com Mensal + Trimestral (Anual oculto), plano pré-selecionado recomendado, **garantia de cancelamento visível**, respaldo CREF, copy nos guardrails; CTA redireciona ao checkout hospedado (US-4.2, `createCheckoutSession`). Sem campo de cartão. DTO Zod compartilhado dos planos em `@movivo/shared`.
**Conclusão:** página renderiza os planos do MVP com garantia visível; CTA abre o checkout hospedado; sem dado de cartão na UI; contrato Zod compartilhado.

**TASK-4.6.2 — Portal de gestão + cancelar/pausar (Felipe + Leonardo).**
Portal que consome o estado da assinatura (US-4.1, endpoint read sob RLS/token) — plano atual, próxima cobrança, status — e expõe as ações de **cancelar/pausar** (US-4.5). Token inválido não vaza dado (IDOR, herdado da US-1.1). Instrumentar `checkout_viewed`/`subscription_manage_viewed` (PostHog).
**Conclusão:** portal mostra estado da assinatura; cancelar/pausar funcionam; token inválido não expõe dado; eventos instrumentados.

**TASK-4.6.3 — Acessibilidade, performance e guardrails (Felipe).**
WCAG 2.2 AA (semântica, foco, contraste, `lang="pt-BR"`); copy 100% nos guardrails (sem termos proibidos de Sofia §13); RSC/estático onde possível; sem regressão grosseira de Lighthouse.
**Conclusão:** axe sem violação crítica; copy nos guardrails; build/lint/typecheck verdes.

### Definição de Pronto (US-4.6 "validada")

- [ ] Tasks 4.6.1–4.6.3 concluídas.
- [ ] Página de plano (garantia visível, sem dado de cartão) redireciona ao checkout hospedado; portal de gestão com cancelar/pausar; token inválido não expõe dado; WCAG 2.2 AA.
- [ ] **Validada por:** code review + revisão de copy (Sofia/guardrails) + teste de acesso por token (IDOR) + smoke E2E verde (US-4.7).

---

## US-4.7 — QA, segurança de pagamento e validação financeira/jurídica

**Agentes:** Mariana (lead — testes, cobertura, quality gates de pagamento) · Sato (revisão de segurança de pagamento: webhook forjado/replay, idempotência, PCI-boundary — §6.4/T-15) · Eduardo (valida unit economics/estados) · Alexandre (valida contratos/CDC/LGPD).
**Depende de:** US-4.1 a US-4.6 (há o que testar). **Alimenta** o CI (quality gate).
**Habilita:** a entrada segura da Sprint 4 em `main` e a disciplina de qualidade do fluxo de dinheiro.

### Jornada

A Sprint 4 é a primeira que **movimenta dinheiro** — um bug aqui não é uma resposta ruim, é **fraude, cobrança indevida ou receita fantasma**. Mariana constrói a suíte de qualidade de pagamento como **quality gate bloqueante**: **webhook forjado** rejeitado, **replay** não ativa 2x, **idempotência de ativação** (evento reentregue não cria 2ª assinatura — o `uniqueIndex` + `SET NX`), **estados do ciclo de vida** corretos (`TRIALING`→`ACTIVE`→`PAST_DUE`→`CANCELED`/`PAUSED`, transições inválidas rejeitadas), **sequência de conversão idempotente e que para para convertidos**, **gate de acesso** derivado da assinatura, **isolamento por titular** (nenhum job lê/altera assinatura de outro), e **0 dado de cartão no backend** (teste que garante o PCI-boundary — o cartão nunca chega ao nosso sistema). Sato registra a revisão de segurança de pagamento (webhook, idempotência, boundary PCI, secrets). Eduardo valida que os estados/preços/downgrade preservam o unit economics (payback ≤3 meses, LTV/CAC ≥3). Alexandre valida contratos/CDC/LGPD/retenção fiscal. Toda a copy passa pelo filtro de guardrails.

### Objetivo

Cobertura ≥80% do código novo, suíte de segurança de pagamento bloqueante (forjado/replay/idempotência/PCI-boundary), estados do ciclo de vida e isolamento verdes, revisão de Sato registrada, e validações de Eduardo/Alexandre — tudo no CI.

### Resultado esperado

O CI reprova qualquer PR que: aceite webhook forjado, permita replay ativar 2x, quebre a idempotência de ativação, deixe um dado de cartão tocar o backend, corrompa uma transição de estado, dispare a sequência 2x, quebre o isolamento por titular, ou derrube a cobertura abaixo de 80%; o fluxo (checkout→webhook→ativação→acesso, downgrade, win-back, cancelamento/pausa) tem teste de integração verde; a revisão de Sato e as validações de Eduardo/Alexandre estão anexadas.

### Tasks

**TASK-4.7.1 — Suíte de segurança de webhook de pagamento (bloqueante) (Mariana + Sato).**
Testes: webhook forjado (assinatura inválida) rejeitado; replay (mesmo `event_id`/timestamp fora da tolerância) descartado; **idempotência de ativação** (evento reentregue não cria 2ª assinatura nem ativa 2x); rawBody preservado. **Gate bloqueante.** Incluir o caso T-15 de Sato (evento forjado que ativa assinatura falsa).
**Conclusão:** forjado/replay/reentrega plantados **falham** o pipeline se ativarem indevidamente; suíte bloqueante no CI.

**TASK-4.7.2 — Estados do ciclo de vida + gate de acesso + isolamento (Mariana).**
Testar todas as transições da máquina de estados (US-4.1) — válidas aplicadas, inválidas rejeitadas; o gate de acesso derivado da assinatura (trial/expirado/active/past_due/paused); **isolamento por titular** (nenhum job lê/altera assinatura de outro `user_id` — RLS). Marcar isolamento como bloqueante.
**Conclusão:** transições corretas; acesso reflete o estado; vazamento cross-tenant de assinatura falha o pipeline.

**TASK-4.7.3 — PCI-boundary + integração ponta a ponta (Mariana + Leonardo).**
Teste que garante que **nenhum dado de cartão toca o backend** (PCI-boundary — checkout hospedado). Integração ponta a ponta com o mock do gateway: checkout→webhook→ativação→acesso (feliz); `payment_failed`→`PAST_DUE`; sequência de conversão (idempotente, para para convertidos); downgrade; win-back; cancelamento/pausa. Idempotência do webhook e da sequência.
**Conclusão:** PCI-boundary comprovado; integração dos caminhos (feliz/falho/downgrade/win-back/cancelamento/pausa) verde local e no CI.

**TASK-4.7.4 — Validação financeira/jurídica + copy + revisão de Sato (Mariana + Eduardo + Alexandre + Sato).**
Eduardo valida estados/preços/downgrade vs. unit economics (payback ≤3 meses, LTV/CAC ≥3). Alexandre valida contratos/CDC/reembolso/LGPD/retenção fiscal. Toda a copy (sequência, win-back, cancelamento, checkout) passa pelo filtro de guardrails (Sofia §13). Sato registra a **revisão de segurança de pagamento consolidada** (webhook, idempotência, PCI-boundary, secrets).
**Conclusão:** Eduardo e Alexandre validam por escrito; copy nos guardrails; revisão de Sato registrada.

### Definição de Pronto (US-4.7 "validada")

- [ ] Tasks 4.7.1–4.7.4 concluídas.
- [ ] Segurança de webhook (forjado/replay/idempotência) e PCI-boundary bloqueantes; estados do ciclo de vida e isolamento verdes; integração (feliz/falho/downgrade/win-back/cancelamento/pausa) verde.
- [ ] Cobertura ≥80%; gates integrados ao CI.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de pagamento de Sato registrada** + validações de Eduardo (unit economics) e Alexandre (contratos/CDC/LGPD) + CI verde.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-4.1 | SubscriptionModule + PaymentGatewayService confinado (mock em dev) | **Leonardo** | Eduardo (preços/estados), Alexandre (contrato) | **Eduardo** (unit economics) + **Alexandre** (contrato/base legal) + Mariana |
| US-4.2 | Checkout hospedado + webhooks (HMAC/idempotência) | **Leonardo** | Henrique (secrets/IP/obs.), Sato (segurança) | **Sato (segurança de pagamento)** + Mariana |
| US-4.3 | ConversionSequenceWorker (dias 7/10/13/14) | **Leonardo** | Helena (funil/copy), Sofia (tom) | Review + copy + idempotência (Mariana) |
| US-4.4 | Downgrade + win-back pós-trial | **Leonardo** | Helena (objeções), Eduardo (economics do downgrade) | **Eduardo** (unit economics) + copy + Mariana |
| US-4.5 | Cancelamento self-service + offboarding-pausa | **Leonardo** | Sofia (Peak-End/UX ref.) | **Alexandre** (CDC/reembolso) + copy + Mariana |
| US-4.6 | Frontend: checkout + portal de gestão | **Felipe** | Leonardo (endpoints), Sofia (UX ref.) | Review + copy + IDOR + E2E (Mariana) |
| US-4.7 | QA + segurança de pagamento + validação financeira/jurídica | **Mariana** | Sato, Eduardo, Alexandre, Leonardo | Mariana + **Sato** + **Eduardo** + **Alexandre** + gate no CI |

> **Leonardo carrega o backend inteiro da sprint** (US-4.1 a US-4.5) — a monetização é predominantemente lógica de servidor + integração de gateway. **Sato** é o validador de segurança crítico (webhook de pagamento é o vetor de fraude nº 1). **Eduardo** entra como validador de negócio (preços/estados/downgrade vs. unit economics) — **é a primeira sprint em que o CFO valida código**. **Alexandre** valida contratos de assinatura, CDC e retenção fiscal. **Henrique** tem participação em infra (secrets do gateway, allowlist, observabilidade de pagamento). **Felipe** entrega o checkout/portal (carga média). **Victor não participa** — esta sprint não tem componente de IA (a copy é template pré-aprovado, não geração).

## Critério de conclusão da Sprint 4 (aceite do Épico 5)

A Sprint 4 é **entregue** quando as 7 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. O **`SubscriptionModule` + `PaymentGatewayService`** modela planos por período e um ciclo de vida governado por eventos do gateway; SDK do gateway confinado; mock em dev; contrato/CDC/base legal refletidos.
2. O **checkout é hospedado** (0 dado de cartão no backend) com plano pré-selecionado; o **webhook de pagamento** verifica assinatura + resiste a replay + **ativa de forma idempotente**; o estado sincroniza com o gateway; o acesso deriva da assinatura.
3. O **`ConversionSequenceWorker`** dispara a sequência 7/10/13/14, ancorada no tempo, idempotente, que para para convertidos, com link de checkout pré-preenchido e copy pré-aprovada nos guardrails.
4. O **downgrade** (plano mais barato no dia 14) e o **win-back** (3 dias pós-trial, registra motivo) recuperam conversão sem dark patterns; unit economics preservado.
5. O **cancelamento self-service** é fácil e oferece **pausa** (offboarding-pausa/Peak-End); sincroniza com o gateway; CDC/reembolso/retenção fiscal respeitados.
6. A **página de checkout + portal de gestão** (mobile-first, WCAG 2.2 AA, garantia visível, respaldo CREF, guardrails) redireciona ao checkout hospedado e expõe cancelar/pausar.
7. **Quality gate de pagamento** bloqueante: webhook forjado/replay/idempotência, PCI-boundary, estados do ciclo de vida e isolamento por titular verdes; integração ponta a ponta verde.
8. CI verde; cobertura ≥80%; toda entrega via PR + 6 checks (`main` protegida); revisão de segurança de pagamento de Sato + validações de Eduardo/Alexandre registradas.

### Pré-requisitos / bloqueadores a resolver no início da sprint

- **[Decisão de produto — fundador/Eduardo] Escolha do gateway (Stripe vs. Asaas) para o MVP** e confirmação dos planos ofertados (Mensal + Trimestral no MVP; Anual dark-launched?). O código abstrai ambos, mas o adaptador real e a copy precisam saber qual sai primeiro. **Não bloqueia dev** (mock), bloqueia o lançamento.
- **[Segredos — Henrique/Alexandre] Conta do gateway + chaves + webhook secret + DPA/LGPD do processador de pagamento.** Chaves via Docker/GitHub Secrets, nunca `environment:`. Em dev roda com mock/chaves de teste; **conta real + DPA são bloqueadores de lançamento, não de dev** (consistente com a memória do projeto).
- **[Conteúdo — Helena/Sofia/Alexandre] Templates aprovados da sequência (7/10/13/14), win-back, downgrade e cancelamento/pausa**, dentro dos guardrails, com garantia de cancelamento e respaldo CREF — precisam existir aprovados antes do lançamento.
- **[Jurídico — Alexandre] Contrato/Termos de assinatura + política de reembolso + arrependimento CDC (7 dias)** refletidos no checkout e no fluxo. Não bloqueia dev; bloqueia o lançamento cobrando de usuário real.
- **[Marca] Go-live com usuário real permanece condicionado à liberação INPI (MOVIVO × VIVO)** — trava herdada. Construir e testar a cobrança é liberado; **cobrar de usuário real** depende do parecer de PI (não bloqueia esta sprint de desenvolvimento).

### Handoff para a Sprint 5

Concluída a Sprint 4, o produto **converte e cobra**. A Sprint 5 recebe: a monetização pronta (assinatura, checkout, webhooks, sequência, cancelamento/pausa) e uma base de **usuários pagantes reais para reter**. **Recomendo que a Sprint 5 seja o par Épico 6 (Check-in Semanal) + Épico 7 (Dashboard CREF)**, porque:
- O **Check-in Semanal** (`CheckinWeeklyWorker` + cron/`repeat`, 3 quick replies, **ajuste de protocolo reusando geração+validação da Sprint 2**, loop visível, reengajamento de inativos) é o mecanismo que sustenta a **North Star (treinos concluídos/30 dias)** e a retenção dos pagantes que a Sprint 4 acabou de criar. A fila `checkin-weekly` já está registrada.
- O **Dashboard CREF** deixou de ser adiável: a dívida de supervisão se acumulou por três sprints — protocolos `PENDING_REVIEW` (Sprint 2), `handoff_alerts`/`BLOCKED_PENDING_CLEARANCE` (Sprint 3), e agora o check-in gerará **novos** protocolos ajustados que podem cair em `PENDING_REVIEW`. Sem a interface humana que os acione, um segmento de usuários (PAR-Q de risco) fica **permanentemente bloqueado**, e a supervisão CREF — a defensabilidade jurídica do produto — não tem onde acontecer. É requisito de compliance, não conveniência.

Este documento cobre **apenas** a Sprint 4; o planejamento da Sprint 5 será feito por Lucas depois, com o aprendizado desta.

---

*Documento de planejamento operacional da Sprint 4 — Lucas Monteiro (PM/PO). Escopo: Épico 5 de `08-relatorio-lucas.md` (Conversão Trial→Assinatura). Modelo de negócio (plano único por período, trial 7 dias sem cartão, unit economics) de `07-relatorio-eduardo.md`. Segurança de webhook de pagamento de `11-relatorio-sato.md` §6.4/T-15 (reusa o padrão HMAC/anti-replay da US-3.1). Contratos/CDC/LGPD de `06-relatorio-alexandre.md`. Funil/copy de conversão de `05-relatorio-helena.md`. Persona MOVI, offboarding-pausa/Peak-End e termos proibidos de `09-relatorio-sofia.md`. Construído sobre a fundação das Sprints 0-3 (tabela `subscriptions` já modelada, fila `conversion-sequence` registrada, outbound WhatsApp, padrão de webhook HMAC). **Decisão de foco: Épico 5 (monetização) primeiro — é a função de sobrevivência e sensível ao tempo; Check-in (Épico 6) e Dashboard CREF (Épico 7) ficam para a Sprint 5, juntos, sobre uma base de pagantes reais e para drenar a dívida de supervisão CREF.***
