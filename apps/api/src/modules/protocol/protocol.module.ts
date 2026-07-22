/**
 * `ProtocolModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo PROTOCOL do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 2-3) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `MotorDeterministico`
 *  - `ProtocolGenerator`
 *  - `VersioningService`
 *  - `SignatureService`
 *
 * Regras que já valem para quem implementar:
 *  - Regra inegociável: o protocolo é gerado pelo **Motor Determinístico**, com o LLM apenas redigindo/adaptando o texto. Nunca LLM puro decidindo carga, volume ou progressão.
 *  - Cobertura de testes exigida no Motor Determinístico: **100%** (Rafael §17 / Sato) — vira gate bloqueante quando o código nascer (Mariana, US-0.8).
 *  - Toda versão de protocolo é imutável e assinada pelo profissional CREF; o histórico é auditável.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

@Module({})
export class ProtocolModule {}
