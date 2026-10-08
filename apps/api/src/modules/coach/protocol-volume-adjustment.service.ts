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

import {
  UNTRUSTED_CONTEXT_POLICY,
  untrustedDataEnvelope,
} from '../ai-coach/context/untrusted-context';
import { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import { handoffAlerts, protocolVersions, protocols } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { signatureHash } from '../protocol/protocol.repository';
import { ProtocolSubstitutionRepository } from '../protocol/protocol-substitution.repository';
import { safePromptFact } from '../protocol/validation/prompt-injection';
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
  /**
   * Aceito por compatibilidade com o contrato do prompt, mas IGNORADO: o resumo mostrado ao
   * aluno (e promovido a texto do system prompt do comentário do check-in) é montado a partir
   * do que foi de fato alterado (`describeAdjustments`), nunca de texto escrito pelo modelo —
   * que pode descrever uma mudança que não ocorreu ou carregar instrução.
   */
  summary: z.string().max(300).optional(),
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

/**
 * Visão MÍNIMA do protocolo enviada ao modelo: só o que o ajuste precisa para decidir o que
 * encurtar (dia, id, nome, números e estratégia de carga). `notes`, `generalNotes` e `focus`
 * ficam de fora de propósito: são texto livre escrito por modelo na geração e não ajudam a
 * reduzir volume — só serviriam de canal para injeção de segunda ordem.
 */
function adjustableView(structure: ProtocolStructure): unknown {
  return {
    sessions: structure.sessions.map((session) => ({
      dayLabel: session.dayLabel,
      exercises: session.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        name: safePromptFact(exercise.name, 80) ?? exercise.exerciseId,
        sets: exercise.sets,
        reps: exercise.reps,
        durationSeconds: exercise.durationSeconds,
        loadStrategy: exercise.loadStrategy,
      })),
    })),
  };
}

/**
 * Fração mínima do volume original que um ajuste pode manter. O pedido do aluno é "um pouco
 * mais curtos" (pergunta 7 do check-in): reduzir mais da metade de séries, repetições ou
 * duração de um exercício não é encurtar o treino, é desmontá-lo — e o limite precisa viver
 * no código porque o modelo é um componente não confiável para decidir quanto cortar.
 */
const MIN_RETAINED_FRACTION = 0.5;

const retained = (current: number): number =>
  Math.max(1, Math.ceil(current * MIN_RETAINED_FRACTION));

/**
 * Motivo de rejeição de um item, ou `null` se ele é uma redução bem-formada de um exercício
 * que existe. Tudo é checado contra o protocolo REAL do titular — o que o modelo disse que
 * o exercício é não conta.
 */
function rejectionReason(exercise: ProtocolExercise, item: AdjustmentItem): string | null {
  if (increasesVolume(exercise, item)) return 'VOLUME_INCREASED';
  // reps XOR duração, e só o campo que o exercício já usa: o ajuste nunca muda a natureza
  // da prescrição (repetições viram tempo ou o contrário).
  if (item.reps !== undefined && item.durationSeconds !== undefined) return 'INVALID_SHAPE';
  if (item.reps !== undefined && !exercise.reps) return 'INVALID_SHAPE';
  if (item.durationSeconds !== undefined && exercise.durationSeconds === undefined) {
    return 'INVALID_SHAPE';
  }
  if (item.reps !== undefined && exercise.reps) {
    if (item.reps.min > item.reps.max || item.reps.min > exercise.reps.min) return 'INVALID_SHAPE';
    if (item.reps.max < retained(exercise.reps.max)) return 'REDUCTION_TOO_LARGE';
  }
  if (item.sets !== undefined && item.sets < retained(exercise.sets)) {
    return 'REDUCTION_TOO_LARGE';
  }
  if (
    item.durationSeconds !== undefined &&
    exercise.durationSeconds !== undefined &&
    item.durationSeconds < retained(exercise.durationSeconds)
  ) {
    return 'REDUCTION_TOO_LARGE';
  }
  return null;
}

/** `true` se aplicar o item muda algum número do exercício. */
function changesSomething(exercise: ProtocolExercise, item: AdjustmentItem): boolean {
  return (
    (item.sets !== undefined && item.sets !== exercise.sets) ||
    (item.reps !== undefined &&
      (item.reps.min !== exercise.reps?.min || item.reps.max !== exercise.reps?.max)) ||
    (item.durationSeconds !== undefined && item.durationSeconds !== exercise.durationSeconds)
  );
}

/** Resumo factual do que MUDOU, montado do antes/depois — nunca de texto do modelo. */
function describeAdjustment(before: ProtocolExercise, item: AdjustmentItem): string {
  const parts: string[] = [];
  if (item.sets !== undefined && item.sets !== before.sets) {
    parts.push(`séries ${before.sets} para ${item.sets}`);
  }
  if (item.reps !== undefined && before.reps) {
    parts.push(
      `repetições ${before.reps.min}-${before.reps.max} para ${item.reps.min}-${item.reps.max}`,
    );
  }
  if (item.durationSeconds !== undefined && before.durationSeconds !== undefined) {
    parts.push(`duração ${before.durationSeconds}s para ${item.durationSeconds}s`);
  }
  const name = safePromptFact(before.name, 60) ?? 'um exercício';
  return `${name} (${parts.join(', ')})`;
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
          '"durationSeconds"?:N}]}. ' +
          'Cada item usa SOMENTE os campos que fazem sentido para aquele exercício (reps XOR ' +
          'durationSeconds, nunca os dois). Nunca reduza séries, repetições ou duração para menos ' +
          'da metade do valor atual, e nunca altere um campo que o exercício não tenha. ' +
          `${UNTRUSTED_CONTEXT_POLICY}`,
        messages: [
          {
            role: 'user',
            content: untrustedDataEnvelope('PROTOCOLO_ATIVO', adjustableView(active.content)),
          },
        ],
      });

      const parsed = adjustmentResponseSchema.parse(parseJson(result.text));
      const proposed = structuredClone(active.content);
      const seen = new Set<string>();
      const described: string[] = [];
      for (const item of parsed.adjustments) {
        const found = findExercise(proposed, item);
        if (!found) {
          this.logger.warn(
            { userId: params.userId, item },
            'ajuste de volume ignorado — exercício não existe no protocolo real',
          );
          return { applied: false, reason: 'UNKNOWN_EXERCISE' };
        }
        const key = `${item.dayLabel}\u0000${item.exerciseId}`;
        if (seen.has(key)) return { applied: false, reason: 'DUPLICATE_ITEM' };
        seen.add(key);

        const reason = rejectionReason(found.exercise, item);
        if (reason) {
          this.logger.warn(
            { userId: params.userId, item, reason },
            'ajuste de volume rejeitado — fora dos limites determinísticos',
          );
          return { applied: false, reason };
        }
        if (!changesSomething(found.exercise, item)) continue;
        described.push(describeAdjustment(found.exercise, item));
        if (item.sets !== undefined) found.exercise.sets = item.sets;
        if (item.reps !== undefined) found.exercise.reps = item.reps;
        if (item.durationSeconds !== undefined)
          found.exercise.durationSeconds = item.durationSeconds;
      }
      if (described.length === 0) return { applied: false, reason: 'NO_CHANGE' };

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
        summary: `reduziu o volume em ${described.join('; ')}`.slice(0, 400),
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
