/**
 * `ProtocolModule` — geração de protocolo de treino por IA (US-2.1).
 *
 * Decisão do fundador (2026-07, revisão do plano da Sprint 2): o protocolo é **planejado
 * pela IA** (não por um motor determinístico), com autonomia para individualizar, mas
 * dentro de trilhos — a metodologia do RT CREF e a base de referência (vocabulário
 * fechado). A **garantia** de segurança migrou para o `ValidationService` (US-2.3, veta o
 * treino inteiro) + AI eval (US-2.7); não mora mais em "o motor decide".
 *
 * Consome o `AiCoachModule` (US-2.2) pelo `LlmRouter`. A persistência (`protocols`), o
 * roteamento ao painel CREF e a auto-aprovação são do Worker (US-2.4); aqui vive só a
 * geração — produzir um `ProtocolStructure` tipado e individualizado.
 *
 * # Fronteira do módulo (regra §12.5)
 * Depende do CORE (config, banco, Redis, logger) por DI global e do `AiCoachModule`
 * (camada de IA compartilhada). Não importa outro módulo de domínio.
 */
import { Module } from '@nestjs/common';

import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { ProtocolGeneratorService } from './protocol-generator.service';

@Module({
  imports: [AiCoachModule],
  providers: [ProtocolGeneratorService],
  exports: [ProtocolGeneratorService],
})
export class ProtocolModule {}
