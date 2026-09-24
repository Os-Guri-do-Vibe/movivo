# Migração de pagamentos — Asaas Sandbox

**Data:** 23/09/2026  
**Estado:** implementado em código e homologado localmente; chamadas financeiras reais no Sandbox pendentes de credencial.  
**Produção:** bloqueada por desenho.

## Resumo executivo

A integração operacional com Stripe foi removida. O único adaptador real aceito pela aplicação é o Asaas, fixado em `https://api-sandbox.asaas.com/v3`; `MOCK` continua disponível apenas para desenvolvimento e CI. O enum `STRIPE` e os IDs históricos do banco foram preservados para auditoria fiscal e rollback, sem cancelamento ou alteração automática de contratos antigos.

O checkout agora permanece no domínio MOVIVO, recebe um token opaco AES-256-GCM com validade de 72 horas e resolve usuário, plano e preço exclusivamente no servidor. Cartão, Pix à vista e Pix Automático usam os endpoints oficiais confirmados pelo MCP do Asaas. Apple Pay e Google Pay não são exibidos porque não foi encontrado suporte oficial confirmado para checkout transparente neste cenário.

## Verificação do MCP e documentação oficial

O MCP oficial foi instalado com:

```text
codex mcp add asaas --url https://docs.asaas.com/mcp
```

O handshake respondeu como `Asaas - Documentação API`, protocolo MCP `2025-06-18`. Foram consultados no MCP os contratos oficiais de:

- clientes: `GET/POST /v3/customers`;
- assinaturas: `GET/POST/DELETE /v3/subscriptions`;
- cobranças e QR Pix: `POST /v3/payments` e `GET /v3/payments/{id}/pixQrCode`;
- parcelamentos: `POST /v3/installments` e cancelamento de cobranças pendentes;
- Pix Automático: `POST/GET/DELETE /v3/pix/automatic/authorizations` com `paymentCreationMode=SUBSCRIPTION`;
- webhooks e o header `asaas-access-token`;
- tokenização de cartão e requisitos de checkout transparente.

Fontes oficiais: [MCP Asaas](https://docs.asaas.com/mcp), [referência da API](https://docs.asaas.com/reference), [llms.txt](https://docs.asaas.com/llms.txt).

## Auditoria do fluxo anterior

Fluxo confirmado no repositório:

1. landing grava o plano escolhido;
2. onboarding/anamnese preserva o plano no job `trial-start`;
3. `SubscriptionService.startTrial` persiste o snapshot e abre sete dias sem cartão;
4. `ConversionSequenceWorker` agenda dias 7, 10, 13 e 14;
5. o worker envia, pela infraestrutura WhatsApp existente, um link individual `/assinar/{token}`;
6. o checkout lê o contrato no backend, cria a operação Asaas e passa a `PENDING_PAYMENT`;
7. somente webhook autenticado altera a assinatura para `ACTIVE`;
8. o frontend consulta o resumo periodicamente e reflete a confirmação sem recarregar;
9. a fila WhatsApp existente envia uma confirmação idempotente ao aluno.

Dependências Stripe operacionais removidas: adaptador HTTP, seleção por configuração, variáveis `STRIPE_*` dos exemplos, Price IDs, Checkout Session e textos/telas que prometiam Apple Pay ou Google Pay. Não havia SDK Stripe instalado.

### Assinaturas Stripe encontradas

Na base local auditada em 23/09/2026:

| Provedor | Estado | Quantidade |
|---|---:|---:|
| sem provedor | TRIALING | 4 |
| STRIPE | qualquer | 0 |

As quatro linhas são trials locais/fixtures, têm snapshots completos e nenhuma referência externa.
Isto não prova o estado de uma base externa ou de produção. Antes de qualquer ativação futura, a operação deve repetir a consulta na base-alvo e comparar com o painel Stripe. Nenhum cancelamento, importação de token ou chamada ao Stripe foi executado.

## Catálogo comercial autoritativo

`packages/shared/src/schemas/subscription.schema.ts` é a fonte única; o backend persiste um snapshot por contrato.

| Plano | Mensalidade equivalente | Meses | Total | Cartão |
|---|---:|---:|---:|---|
| Mensal | R$ 79,90 | 1 | R$ 79,90 | recorrência mensal |
| Trimestral | R$ 75,90 | 3 | R$ 227,70 | compra do total em até 3x |
| Semestral | R$ 71,90 | 6 | R$ 431,40 | compra do total em até 6x |
| Anual | R$ 67,90 | 12 | R$ 814,80 | compra do total em até 12x |

Os planos longos no cartão não renovam automaticamente. Uma nova compra exige nova autorização. Pix à vista cobra o total do contrato. Pix Automático autoriza exatamente 1, 3, 6 ou 12 débitos mensais e grava `finishDate`; não é uma geração mensal de Pix manual.

## Mapeamento Asaas

| MOVIVO | Asaas | Persistência |
|---|---|---|
| usuário | customer | `external_customer_id` |
| mensal + cartão | subscription | `external_subscription_id` |
| plano longo + cartão | installment | `external_installment_id` |
| Pix à vista | payment | `external_payment_id` |
| Pix Automático | recurring authorization/subscription | `external_authorization_id` e `external_subscription_id` |

Clientes e contratos são pesquisados por `externalReference` (e, nas cobranças, também por `billingType`) antes da criação. Um lock Redis `SET NX PX`, com liberação compare-and-delete, serializa tentativas do mesmo contrato entre instâncias. IDs externos têm índices únicos.

Somente a retentativa do **mesmo** contrato pendente (mesmo método, sem regenerar) reaproveita a referência. Pix regenerado, troca de método ou nova compra depois de `EXPIRED` abrem contrato novo: o backend primeiro desvincula os IDs antigos da linha e avança `payment_attempt`, depois cancela o contrato anterior no Asaas quando ele ainda pode cobrar. Se o cancelamento falhar, o vínculo é restaurado e nenhuma cobrança nova é aberta.

## Webhooks e estados

Endpoint: `POST /api/v1/webhook/payment`.

O controller lê o corpo bruto e o header oficial `asaas-access-token`. O adaptador compara o token em tempo constante. Eventos aceitos são normalizados e deduplicados por ID no Redis; a conciliação financeira continua protegida pela chave única `(gateway, gateway_event_id)` no Postgres.

**Respostas:** `401` somente quando a origem não foi provada (token ausente/incorreto, corpo malformado). Todo evento autenticado responde `200`, inclusive os que a MOVIVO não usa (`PAYMENT_CREATED`, `..._AUTHORIZATION_CREATED` etc.). O Asaas trata qualquer resposta diferente de 200 como falha e, no envio sequencial, segura os eventos seguintes até pausar a fila após 15 falhas.

Mapeamentos principais:

- `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_RECEIVED_IN_CASH` → `ACTIVE`; em contrato recorrente já ativo, estende `current_period_end` pela competência (`dueDate` + 1 mês);
- autorização Pix Automático `ACTIVATED` → `ACTIVE`;
- vencimento/reprovação/chargeback solicitado e débito do Pix Automático recusado (`PAYMENT_INSTRUCTION_REFUSED`) → `PAST_DUE`, se já houve pagamento; na **primeira** cobrança a assinatura segue `PENDING_PAYMENT`, sem carência, e o aluno recebe um novo link;
- QR do Pix Automático expirado (`AUTHORIZATION_REFUSED`) → falha do primeiro pagamento (mesma regra acima);
- estorno → `CANCELED` com o período pago encerrado na hora;
- autorização revogada (`AUTHORIZATION_CANCELLED`) ou `SUBSCRIPTION_DELETED` → `CANCELED`, com acesso até o fim do período já pago;
- ignorados de propósito: `PAYMENT_DELETED` (remover uma cobrança pendente não encerra o contrato) e `AUTHORIZATION_EXPIRED` (fim natural em `finishDate`; quem encerra o acesso é a varredura de fim de período).

Evento negativo (falha, cancelamento, estorno) só altera a assinatura se citar um ID do contrato vigente. Evento de contrato substituído é conciliado financeiramente, mas não mexe no acesso. Confirmação de pagamento sempre ativa: quem pagou o QR antigo pagou de verdade.

O frontend nunca ativa acesso. Gerar cobrança ou QR Code produz apenas `PENDING_PAYMENT`.
Uma falha entregue com `dateCreated` anterior ao `updated_at` do contrato não rebaixa o acesso;
o evento ainda entra na fila de conciliação financeira para auditoria. As datas do Asaas vêm sem fuso e são lidas como horário de Brasília (UTC−3).

## Período pago e expiração

- Cartão parcelado e Pix à vista pagam o período inteiro (`periodDays` do plano) na ativação.
- Cartão mensal e Pix Automático pagam um mês por cobrança, contado do vencimento; confirmação tardia de mês já coberto não estende o período.
- A varredura horária `subscription-period-scan` leva `ACTIVE → EXPIRED` quando o período acaba: cobrança única no instante exato; recorrente só depois da janela de graça (`PAST_DUE_GRACE_DAYS`), para dar tempo ao webhook da renovação.
- Em `EXPIRED` o aluno pode comprar de novo (referência nova).

## Conciliação

`gateway_event_id` guarda, para liquidação e estorno, a chave da **cobrança** (`SETTLED:<paymentId>`, `REFUNDED:<paymentId>`). No cartão, `PAYMENT_CONFIRMED` (captura) e `PAYMENT_RECEIVED` (repasse, D+30) viram uma linha só, assim como `PAYMENT_REFUND_IN_PROGRESS` e `PAYMENT_REFUNDED`. Falhas continuam uma linha por evento, com valor zero. O vínculo com a assinatura aceita qualquer ID do contrato (assinatura, cobrança, parcelamento ou autorização).

## Operações administrativas deliberadamente não automatizadas

O adaptador cancela autorizações, assinaturas, parcelamentos pendentes e cobranças pendentes,
sempre pela referência exata da forma de pagamento; referência já inexistente no Asaas (404)
conta como cancelada. No cancelamento self-service, o Asaas só é chamado quando ainda há o que
cobrar (cobrança pendente, cartão mensal, Pix Automático). Parcelado no cartão e Pix à vista já
pagos só encerram a relação, e o aluno mantém o acesso até o fim do período pago.
Estorno de valor já liquidado não é disparado pelo cancelamento self-service: é uma operação
financeira irreversível que exige conferência administrativa, motivo e política de reembolso.
Os webhooks de estorno são ingeridos e conciliados como lançamentos negativos.

Mudança de plano também não é oferecida pelo token do checkout. O token prova apenas o contrato
já escolhido; uma troca futura precisa de sessão autenticada, novo snapshot, consentimento e
reconciliação do contrato anterior antes de emitir cobrança.

## Configuração

```dotenv
PAYMENT_PROVIDER=ASAAS
ASAAS_API_URL=https://api-sandbox.asaas.com/v3
ASAAS_API_KEY_FILE=/run/secrets/asaas_api_key
ASAAS_WEBHOOK_SECRET_FILE=/run/secrets/asaas_webhook_secret
ASAAS_TIMEOUT_MS=10000
```

O `authToken` configurado no webhook do painel Asaas deve ter entre 32 e 255 caracteres e ser idêntico ao conteúdo de `ASAAS_WEBHOOK_SECRET_FILE`. A URL de API aceita pelo schema é literalmente a do Sandbox; uma URL de produção faz o boot falhar.

## Segurança, PCI e LGPD

- PAN/CVV/validade não entram em banco, resposta, analytics ou logs.
- CPF e endereço são enviados ao Asaas somente no request; não são adicionados à assinatura.
- token do checkout é opaco, autenticado, expira em 72h e pode ser regenerado;
- limite específico: cinco inícios de pagamento por minuto;
- preço, plano, usuário e quantidade máxima de parcelas vêm do snapshot do servidor;
- logs usam apenas IDs internos, tipo de evento e correlation ID.

### Gate PCI de produção

No mecanismo transparente confirmado, os dados de cartão atravessam o backend MOVIVO antes de chegar ao Asaas. A tokenização posterior não elimina esse primeiro trânsito. Portanto, a implementação fica **restrita ao Sandbox** até que um QSA/assessor PCI determine o escopo, controles e SAQ aplicável, ou que o Asaas disponibilize um componente client-side homologado que mantenha PAN/CVV fora da infraestrutura MOVIVO.

Apple Pay e Google Pay também permanecem bloqueados: o MCP e a documentação consultada não confirmaram suporte direto seguro para este checkout transparente. Não há botões simulados.

## Migrations e preservação histórica

- `0056_spicy_slipstream.sql`: adiciona `PENDING_PAYMENT`, snapshots comerciais, método, IDs Asaas, parcelas, limite Pix Automático, tentativa e próxima cobrança; faz backfill não destrutivo usando o preço histórico.
- `0057_conscious_monster_badoon.sql`: adiciona constraints de valores, métodos, parcelas, débitos autorizados e tentativa.
- `0058_powerful_kinsey_walden.sql`: fecha os três snapshots comerciais como `NOT NULL`, com novo backfill defensivo para rolling deploy.
- a tabela append-only `payments` e o enum `payment_provider` mantêm `STRIPE` para registros anteriores;
- nenhuma migration apaga coluna, registro financeiro ou valor do enum.

## Rollback

1. manter `PAYMENT_PROVIDER=MOCK` para impedir novas operações enquanto se investiga;
2. desabilitar o webhook Asaas no painel, sem excluir eventos ou contratos;
3. reverter o código da aplicação; não reverter migrations destrutivamente;
4. conservar os novos campos e IDs para conciliação/auditoria;
5. se houver contratos Stripe legados em outra base, mantê-los no fluxo antigo até migração individual oficialmente suportada e consentida.

## Matriz de homologação

| Cenário | Resultado | Evidência/limite |
|---|---|---|
| preços dos quatro planos | PASSOU | testes shared/model, aritmética inteira |
| trial de 7 dias sem cobrança | PASSOU | unitário + integração do worker |
| link opaco, expirável e adulteração | PASSOU | `checkout-token.service.spec.ts` |
| cartão mensal recorrente | PASSOU (contrato) | payload unitário conforme MCP; sem chamada real |
| cartão 3x/6x/12x | PASSOU (contrato) | limites backend e payload de parcelamento |
| Pix à vista + QR + expiração | PASSOU (contrato/UI) | gateway e componente testados |
| regeneração Pix sem duplicação | PASSOU (código) | cancelamento anterior + attempt + lock |
| Pix Automático SUBSCRIPTION | PASSOU (contrato) | frequência, valor e `finishDate` testados |
| webhook válido, forjado e duplicado | PASSOU | unitário + integração local |
| evento autenticado não mapeado → 200 (fila não pausa) | PASSOU (contrato) | unitário; confirmar no log de webhooks do Sandbox |
| Pix regenerado / troca de método não derrubam o contrato novo | PASSOU (código) | unitário: desvínculo antes do cancelamento + evento de contrato substituído ignorado |
| primeira cobrança vencida sem carência | PASSOU | unitário + integração local |
| captura + repasse do cartão = 1 liquidação | PASSOU | integração local (UNIQUE do banco) |
| renovação mensal estende o período pela competência | PASSOU (código) | unitário; confirmar com a 2ª cobrança real |
| fim do período pago → `EXPIRED` | PASSOU | unitário + integração local |
| débito recusado do Pix Automático → `PAST_DUE` | PASSOU (contrato) | payload conforme doc; sem chamada real |
| datas do Asaas em horário de Brasília | PASSOU (contrato) | unitário; confirmar com payload real |
| estado assíncrono sem reload | PASSOU | polling do backend a cada 3s |
| confirmação pelo WhatsApp | PASSOU | fila existente + `dedupeId` derivado do evento |
| cancelamento (acesso até o fim do período pago) | PASSOU | unitário + integração local |
| migration e RLS | PASSOU | migrations aplicadas no Postgres local |
| mudança de plano | NÃO TESTADO | não exposta no token; requer fluxo autenticado futuro |
| estorno iniciado pela MOVIVO | NÃO TESTADO | deliberadamente administrativo e irreversível |
| Apple Pay / Google Pay | NÃO TESTADO | suporte oficial não confirmado; não implementado |
| chamadas reais Asaas Sandbox | NÃO TESTADO | `ASAAS_API_KEY` e token de webhook não provisionados |
| recusa/chargeback real do Sandbox | NÃO TESTADO | depende de credencial/casos de teste do painel |
| suíte de integração global | FALHOU | testes antigos acionaram EvolutionAPI/LLMs reais: erros 400, saldo e timeout; suíte de pagamento passou 16/16 |
| produção | NÃO TESTADO | bloqueada por URL literal de Sandbox e gate PCI |

## Pendências para produção

1. provisionar conta e credenciais exclusivamente Sandbox; cadastrar o webhook e executar a matriz real;
2. aprovar Termos de Assinatura e Política de Privacidade — a versão atual no código é provisória;
3. concluir avaliação PCI/QSA e escolher mecanismo que não exponha PAN/CVV à infraestrutura, se disponível;
4. repetir auditoria de assinaturas Stripe na base e painel efetivamente usados em produção;
5. configurar alertas de falha/replay, runbook de conciliação e rotação do webhook token;
6. somente depois criar uma decisão arquitetural separada para URL/chaves de produção.
