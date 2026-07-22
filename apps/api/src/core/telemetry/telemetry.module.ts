/**
 * `TelemetryModule` — **stub registrado** (TASK-0.3.5).
 *
 * Casca vazia, de propósito. A instrumentação real (OpenTelemetry → Prometheus/Grafana,
 * Sentry) é escopo da Sprint 6 (`ARQUITETURA.md` §10). O módulo existe agora para que
 * essa sprint não precise reestruturar a árvore de módulos nem mexer no `AppModule`.
 *
 * Quando for implementado:
 *  - O SDK do OpenTelemetry precisa ser inicializado **antes** do `NestFactory.create`
 *    (a auto-instrumentação faz monkey-patch de `http`/`pg`/`ioredis` no require).
 *  - Atributo de span **nunca** carrega PII — a mesma regra de `redaction.util.ts`
 *    vale para telemetria (SECURITY.md §1: "segredo/PII em span" é proibição explícita).
 *  - O `correlationId` do `LoggerModule` deve virar o `trace_id`, para casar log e trace.
 */
import { Module } from '@nestjs/common';

@Module({})
export class TelemetryModule {}
