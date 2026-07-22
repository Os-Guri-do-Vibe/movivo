/**
 * `CheckinModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo CHECKIN do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 5) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `CheckinService`
 *  - `AdjustService`
 *  - `Scheduler`
 *
 * Regras que já valem para quem implementar:
 *  - Check-in semanal disparado segunda-feira 08–10h no fuso **America/Sao_Paulo** — o agendamento precisa ser correto no horário de verão e em mudanças de fuso (teste dedicado, Mariana US-0.8).
 *  - O ajuste de protocolo resultante passa pelo Motor Determinístico do `ProtocolModule`, via evento — nunca por import direto entre módulos de domínio.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

@Module({})
export class CheckinModule {}
