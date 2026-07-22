/**
 * `SubscriptionModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo SUBSCRIPTION do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 5) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `TrialService`
 *  - `ConversionSequence`
 *  - `StripeService`
 *  - `AsaasService`
 *  - `WebhookHandlers`
 *
 * Regras que já valem para quem implementar:
 *  - Plano único por período (Eduardo, `07-relatorio-eduardo.md`): Mensal R$39 / Trimestral R$99 / Anual R$349. Trial de **7 dias sem cartão**.
 *  - Webhooks de pagamento são **idempotentes** por `event_id` e verificados por assinatura. Reprocessar não pode cobrar duas vezes.
 *  - Dado de cartão nunca toca a nossa infraestrutura — tokenização no provedor.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

@Module({})
export class SubscriptionModule {}
