/**
 * `ProtocolVolumeAdjustmentService` — reduz o VOLUME (séries/repetições/duração) do
 * protocolo ATIVO do aluno quando ele responde "poderiam ser um pouco mais curtos" na
 * pergunta 7 do check-in semanal (achado 2026-09-13, pedido do fundador). NUNCA troca,
 * remove ou adiciona exercício — só ajusta números de exercícios que já existem.
 *
 * Decisão do fundador: aplica DIRETO, sem staging/janela de revisão (diferente da
 * substituição de exercício) — mas com o MESMO rastro de auditoria (`protocol_versions`,
 * `generatedBy: 'AI_CHECKIN_ADJUSTMENT'`) e um `handoffAlerts` informativo pro profissional
 * CREF ver depois do fato, já que não há gate antes.
 *
 * Design deliberadamente ESTREITO (primeira chamada real de `purpose: 'CHECKIN_ADJUSTMENT'`
 * — `LlmRouter` usa o timeout CURTO pra esse propósito, não o longo de geração completa):
 * a IA devolve só uma LISTA de deltas `{dayLabel, exerciseId, sets?, reps?, durationSeconds?}`,
 * nunca o `ProtocolStructure` inteiro de novo. Isso torna impossível a IA "trocar" um
 * exercício por engano — o código só escreve os campos numéricos de um exercício que já
 * existe no `dayLabel`+`exerciseId` recebido; qualquer item que não bater com a estrutura
 * real, ou que aumente o volume em vez de reduzir, derruba o ajuste inteiro (fail-safe: nunca
 * aplica parcialmente, nunca aplica algo que não seja redução).
 *
 * Reusa `ProtocolSubstitutionRepository.loadActiveProtocol` (não é substituição, mas é
 * exatamente o mesmo "protocolo ativo + constraints de validação" que qualquer mutação de
 * protocolo precisa — evita duplicar a query e o `deriveConstraints`).
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { BiologicalSex, ProtocolExercise, ProtocolStructure } from '@movivo/shared';

import { untrustedDataEnvelope } from '../ai-coach/context/untrusted-context';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { handoffAlerts, protocolVersions, protocols } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { signatureHash } from '../protocol/protocol.repository';
import { ProtocolSubstitutionRepository } from '../protocol/protocol-substitution.repository';
import { ValidationService } from '../protocol/validation/validation.service';

function parseJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('JSON ausente');
  return JSON.parse(trimmed.slice(first, last + 1));
}

const repsSchema = z.object({
  min: z.number().int().min(1).max(100),
  max: z.number().int().min(1).max(100),
});
const adjustmentItemSchema = z.object({
  dayLabel: z.string().min(1).max(60),
  exerciseId: z.string().min(1).max(80),
  sets: z.number().int().min(1).max(12).optional(),
  reps: repsSchema.optional(),
  durationSeconds: z.number().int().min(5).max(2400).optional(),
});
const adjustmentResponseSchema = z.object({
  adjustments: z.array(adjustmentItemSchema).min(1).max(30),
  /** Resumo curto e factual em PT-BR do que mudou — reusado no comentário da IA ao aluno. */
  summary: z.string().min(1).max(300),
});
type AdjustmentItem = z.infer<typeof adjustmentItemSchema>;

export interface VolumeAdjustmentParams {
  userId: string;
  user: ScrubUser;
  biologicalSex: BiologicalSex | null;
  checkinId: string;
}

export type VolumeAdjustmentResult =
  | { applied: true; summary: string; protocolId: string; version: number }
  | { applied: false; reason: string };

function findExercise(
  structure: ProtocolStructure,
  item: AdjustmentItem,
): { exercise: ProtocolExercise } | null {
  for (const session of structure.sessions) {
    if (session.dayLabel !== item.dayLabel) continue;
    const exercise = session.exercises.find((e) => e.exerciseId === item.exerciseId);
    if (exercise) return { exercise };
  }
  return null;
}

/** `true` se o item pedir MAIS volume do que o exercício já tem — nunca aceito aqui. */
function increasesVolume(exercise: ProtocolExercise, item: AdjustmentItem): boolean {
  if (item.sets !== undefined && item.sets > exercise.sets) return true;
  if (item.reps !== undefined && exercise.reps && item.reps.max > exercise.reps.max) return true;
  if (
    item.durationSeconds !== undefined &&
    exercise.durationSeconds !== undefined &&
    item.durationSeconds > exercise.durationSeconds
  ) {
    return true;
  }
  return false;
}

@Injectable()
export class ProtocolVolumeAdjustmentService {
  constructor(
    private readonly llm: LlmRouter,
    private readonly validation: ValidationService,
    private readonly substitutionRepo: ProtocolSubstitutionRepository,
    private readonly db: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProtocolVolumeAdjustmentService.name);
  }

  async adjust(params: VolumeAdjustmentParams): Promise<VolumeAdjustmentResult> {
    try {
      const active = await this.substitutionRepo.loadActiveProtocol(params.userId);
      if (!active) return { applied: false, reason: 'NO_ACTIVE_PROTOCOL' };

      const result = await this.llm.complete({
        purpose: 'CHECKIN_ADJUSTMENT',
        userId: params.userId,
        user: params.user,
        personaSlot: params.biologicalSex,
        dataClass: 'HEALTH',
        temperature: 0,
        json: true,
        maxTokens: 900,
        intent: 'checkin_volume_adjustment',
        system:
          'Você ajusta um protocolo de treino de resistência para ficar MAIS CURTO em duração ' +
          'total, respeitando a metodologia do profissional CREF responsável. Reduza séries ' +
          'e/ou repetições e/ou duração de exercícios existentes — NUNCA aumente volume, NUNCA ' +
          'troque, remova ou adicione um exercício, NUNCA invente um dayLabel ou exerciseId que ' +
          'não esteja na lista recebida. Priorize reduzir séries acessórias antes de séries de ' +
          'exercícios compostos/principais. Retorne somente JSON estrito: ' +
          '{"adjustments":[{"dayLabel":"...","exerciseId":"...","sets"?:N,"reps"?:{"min":N,"max":N},' +
          '"durationSeconds"?:N}],"summary":"frase curta em PT-BR do que mudou, para o aluno"}. ' +
          'Cada item usa SOMENTE os campos que fazem sentido para aquele exercício (reps XOR ' +
          'durationSeconds, nunca os dois).',
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('PROTOCOLO_ATIVO', active.content),
          },
        ],
      });

      const parsed = adjustmentResponseSchema.parse(parseJson(result.text));
      const proposed = structuredClone(active.content);
      for (const item of parsed.adjustments) {
        const found = findExercise(proposed, item);
        if (!found) {
          this.logger.warn(
            { userId: params.userId, item },
            'ajuste de volume ignorado — exercício não existe no protocolo real',
          );
          return { applied: false, reason: 'UNKNOWN_EXERCISE' };
        }
        if (increasesVolume(found.exercise, item)) {
          this.logger.warn(
            { userId: params.userId, item },
            'ajuste de volume rejeitado — IA tentou aumentar volume em vez de reduzir',
          );
          return { applied: false, reason: 'VOLUME_INCREASED' };
        }
        if (item.sets !== undefined) found.exercise.sets = item.sets;
        if (item.reps !== undefined) found.exercise.reps = item.reps;
        if (item.durationSeconds !== undefined)
          found.exercise.durationSeconds = item.durationSeconds;
      }

      const verdict = this.validation.validate({
        structure: proposed,
        constraints: active.validationConstraints,
        parqFlags: active.parQFlags,
      });
      if (verdict.action === 'BLOCK_FALLBACK') {
        this.logger.warn(
          { userId: params.userId, violations: verdict.violations },
          'ajuste de volume reprovado na validação — descartado',
        );
        return { applied: false, reason: 'VALIDATION_BLOCKED' };
      }

      const applied = await this.db.runAsUser(params.userId, 'USER', async (tx) => {
        const nextVersion = active.version + 1;
        await tx
          .update(protocols)
          .set({ version: nextVersion, content: proposed })
          .where(eq(protocols.id, active.protocolId));
        await tx.insert(protocolVersions).values({
          protocolId: active.protocolId,
          userId: params.userId,
          version: nextVersion,
          status: 'ACTIVE',
          content: proposed,
          diff: { type: 'VOLUME_ADJUSTMENT', adjustments: parsed.adjustments },
          changeReason: `Ajuste de volume solicitado no check-in semanal (${params.checkinId})`,
          generatedBy: 'AI_CHECKIN_ADJUSTMENT',
          signatureHash: signatureHash(proposed),
          signedAt: new Date(),
        });
        await tx
          .insert(handoffAlerts)
          .values({
            userId: params.userId,
            level: 'ALERT',
            reason: 'CHECKIN_AJUSTE_VOLUME_APLICADO',
            sourceType: 'CHECKIN',
            sourceId: params.checkinId,
          })
          .onConflictDoNothing();
        return nextVersion;
      });

      this.logger.info(
        { userId: params.userId, protocolId: active.protocolId, version: applied },
        'ajuste de volume aplicado a partir do check-in semanal',
      );
      return {
        applied: true,
        summary: parsed.summary,
        protocolId: active.protocolId,
        version: applied,
      };
    } catch (error) {
      this.logger.warn(
        { userId: params.userId, err: error instanceof Error ? error.message : String(error) },
        'ajuste de volume falhou — protocolo não tocado',
      );
      return { applied: false, reason: 'ERROR' };
    }
  }
}
