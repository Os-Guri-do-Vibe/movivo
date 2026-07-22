/**
 * `WhatsappModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo WHATSAPP do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 3) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `WebhookController`
 *  - `MessageService`
 *  - `TemplateService`
 *  - `RateLimiter`
 *
 * Regras que já valem para quem implementar:
 *  - Webhook da AraraHQ: verificação de assinatura HMAC obrigatória + janela anti-replay de ±5 min (§12.15). Assinatura inválida ⇒ 401, sem processar.
 *  - Entrega é assíncrona via BullMQ com DLQ — o handler do webhook responde 200 rápido e enfileira.
 *  - Corpo de mensagem contém PII e conteúdo de saúde: nunca logar payload em claro (`redactPii`).
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

@Module({})
export class WhatsappModule {}
