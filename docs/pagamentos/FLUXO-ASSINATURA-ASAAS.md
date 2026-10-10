# Fluxo de assinatura, pagamento e cancelamento (Asaas)

**Escopo:** Sandbox (local) e produção (conta real). Substitui, no que diz respeito ao cartão, a parte
"checkout transparente" de [MIGRACAO-ASAAS-SANDBOX.md](MIGRACAO-ASAAS-SANDBOX.md).

## Princípios

1. **O cartão nunca passa pela MOVIVO**, nem no Sandbox. O número é digitado só na página do Checkout
   hospedado do Asaas. A MOVIVO não tem escopo PCI além de redirecionar para essa página.
2. **Quem libera o acesso é o webhook autenticado**, nunca o retorno do navegador.
3. **Cada link é do titular.** Token individual (256 bits, guardado só como hash), com finalidade fixa,
   validade e revogação. Nenhuma resposta pública revela se um telefone é cliente.
4. **Plano e preço vêm do banco**, nunca do navegador.

## Jornada do aluno

| Etapa | O que acontece |
|---|---|
| Fim do teste (7 dias) ou fim de um plano | Mensagem no WhatsApp com `/checkout/<código>` e `/cancelar/<código>` (textos em `subscription-messages.ts`) |
| `/assinar/<token>` | Tela única: plano, "Seus dados", abas **Cartão** e **Pix à vista**, aceite dos Termos |
| Pix | QR Code e código "copia e cola" na própria página; confirmação por atualização automática a cada 3 s |
| Cartão | Redireciona (mesma aba) ao Checkout do Asaas, que já abre com identificação e endereço completos; volta para a mesma página em `?retorno=sucesso\|cancelado\|expirado` |
| Confirmação | Webhook `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` → assinatura `ACTIVE` → WhatsApp de confirmação com link de cancelamento |
| Renovação (só mensal no cartão) | O Asaas cobra sozinho; cada cobrança paga estende o período em um mês |
| Falha | 1ª cobrança: segue pendente e o aluno recebe link novo. Renovação: `PAST_DUE` com 3 dias de carência e aviso no WhatsApp |

### Planos e meios

| Plano | Pix à vista | Cartão |
|---|---|---|
| Mensal | uma cobrança | **assinatura recorrente** (cobra todo mês até cancelar) |
| Trimestral / Semestral / Anual | valor total | valor total em até 3 / 6 / 12 parcelas, **sem renovação automática** |

Pix Automático está desligado (indisponível na conta). O código existe, mas o serviço o recusa.

## Cancelamento e arrependimento

| Situação | Efeito no Asaas | Acesso |
|---|---|---|
| Mensal no cartão | assinatura removida | até o fim do período pago |
| Parcelado / Pix à vista | nada a interromper | até o fim do período |
| Pagamento pendente | cobrança ou sessão do Checkout cancelada | não havia acesso pago |
| **Até 7 dias da contratação** (botão "Pedir estorno") | cancela a cobrança futura e **estorna** (`/payments/{id}/refund` ou `/installments/{id}/refund`) | termina na hora |

- Um Checkout que já não está ativo (expirado, cancelado, pago) responde **HTTP 400** ao cancelamento; o
  gateway trata como sucesso.
- Estorno recusado pelo Asaas (por exemplo, **Pix recém-recebido sem saldo na conta**) vira
  `cancelReason = 'ARREPENDIMENTO_ESTORNO_PENDENTE'` e log `refund_manual_required` (nível error). O
  cancelamento vale; a equipe estorna manualmente no painel do Asaas. Consulta:
  `SELECT user_id, canceled_at FROM subscriptions WHERE cancel_reason = 'ARREPENDIMENTO_ESTORNO_PENDENTE';`
- **Recompra:** quem cancelou só assina de novo depois do fim do acesso pago; o contrato novo não herda o
  período antigo (`CANCELED → PENDING_PAYMENT`).

## Como o aluno chega ao cancelamento sem decorar token

1. Link na mensagem de confirmação e em toda renovação (`/cancelar/<código>`, válido 365 dias).
2. **WhatsApp:** "quero cancelar minha assinatura" (ou parecido) → resposta automática, antes da IA, com link novo.
   Intenção em `subscription-access.ts`; vale mesmo sem consentimento de saúde (é assunto de cobrança).
3. **Página pública `/conta`:** digita o celular → recebe o link no WhatsApp **cadastrado**. Resposta idêntica
   exista ou não cliente; casamento exato do telefone (sem variante de 9º dígito); 5 pedidos/hora por titular.
4. **Link vencido:** `/cancelar/…` e `/checkout/…` expirados caem em `/link-expirado`, que reenvia um novo ao
   dono do link antigo. A abertura da página **não** envia nada (o WhatsApp pré-carrega links).

## Termos de Assinatura (sem trava)

Por decisão do fundador (2026-10-10), **não há mais trava de Termos**: o checkout abre para todos, em qualquer
ambiente. O aceite grava `SUBSCRIPTION_TERMS_VERSION` e a tela mostra os links dos Termos de Uso e da Política de
Privacidade vigentes. A pendência jurídica de publicar o texto integral das condições de assinatura continua
registrada em [`docs/juridico/pendencias-publicacao-termos-privacidade.md`](../juridico/pendencias-publicacao-termos-privacidade.md).

## Estorno manual (arrependimento que o Asaas recusou)

1. Liste os pendentes (`psql` do banco de produção):
   `SELECT user_id, canceled_at FROM subscriptions WHERE cancel_reason = 'ARREPENDIMENTO_ESTORNO_PENDENTE' ORDER BY canceled_at;`
   (o log `refund_manual_required`, nível error, traz o mesmo caso).
2. No painel do Asaas: **Cobranças** → busque pelo CPF/nome do cliente ou pela referência
   `movivo:<user_id>:<PLANO>:…` → abra a cobrança → **Estornar** (valor integral).
   Pix recém-recebido pode exigir saldo na conta; cartão leva até 10 dias úteis na fatura.
3. Nada mais a fazer na MOVIVO: o webhook `PAYMENT_REFUNDED` chega, baixa a pendência
   (`cancel_reason` vira `ARREPENDIMENTO`) e o acesso já estava encerrado.

## Rodar local no Asaas Sandbox

1. `PAYMENT_PROVIDER=ASAAS`, `ASAAS_API_KEY_FILE` e `ASAAS_WEBHOOK_SECRET_FILE` (chaves de **Sandbox**).
2. **Abra o site por `http://127.0.0.1:<porta>`**: o Asaas recusa `localhost` como URL de retorno (o gateway
   troca `localhost` por `127.0.0.1` sozinho). Inclua `http://127.0.0.1:<porta>` em `API_CORS_ORIGINS`;
   o `next.config.ts` já libera essa origem em `next dev`.
3. Cartão de teste: <https://docs.asaas.com/docs/cartoes-para-teste>.
4. O webhook do Sandbox só alcança sua máquina por túnel HTTPS; sem túnel, simule o evento com o token
   (`asaas-access-token`) contra `POST /api/v1/webhook/payment`.

## Pré-requisitos da conta de produção (confirmar no painel do Asaas)

- Conta aprovada para receber cartão e **chave Pix cadastrada**.
- Webhook de produção apontando para `https://api.movivo.com.br/api/v1/webhook/payment`, com o mesmo
  Auth Token do arquivo `asaas_webhook_secret` da VPS, e estes eventos ligados:
  `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_RECEIVED_IN_CASH`, `PAYMENT_OVERDUE`,
  `PAYMENT_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_CHARGEBACK_REQUESTED`,
  `PAYMENT_REPROVED_BY_RISK_ANALYSIS` e `SUBSCRIPTION_DELETED`.
- Corte: workflow `activate-asaas-production.yml` (ver [deploy-producao.md](../operacoes/deploy-producao.md)).

## Achados verificados no Sandbox (2026-10-10)

- `customerData` exige endereço completo; com `customer` (cliente já cadastrado com CEP + número) a página abre
  só com o cartão por preencher.
- `nextDueDate` da assinatura recorrente é a **data da primeira cobrança** (a página exibe "Primeira cobrança");
  enviamos a data de hoje (Brasília).
- O QR Pix do Asaas vale por até um ano; exibimos só até o fim do dia de vencimento.
- Cancelar Checkout inativo → HTTP 400 "não está ativo" (tratado).
- Estornar cobrança `RECEIVED_IN_CASH` é recusado; a simulação de pagamento de Pix exige permissão que a chave
  de Sandbox não tem. O estorno de cobrança paga de verdade deve ser conferido manualmente.
