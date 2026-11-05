import { z } from 'zod';

import { weekdaySchema } from '../anamnesis.schema';
import { measurementInputSchema } from '../body/body.schema';
import { daySlotSchema } from '../training/plan.schema';

const scale = z.number().int().min(1).max(5);
const note = (max: number) => z.string().trim().max(max);

/**
 * Reavaliação de fim de ciclo: o que o aluno conta depois de uma fase inteira de protocolo. Os
 * agentes cruzam estas respostas com o começo (anamnese, medidas) e com os registros do ciclo
 * (treinos, carga, check-ins) para montar o próximo ciclo.
 */
export const cycleReassessmentAnswersSchema = z.object({
  /** Medidas de agora (peso, cintura…); comparadas com as do início. */
  measurements: z.array(measurementInputSchema).max(12),
  phase: z.object({
    /** Nota geral da fase, 1 = muito ruim, 5 = excelente. */
    overall: scale,
    trainingLoad: z.enum(['TOO_EASY', 'ADEQUATE', 'TOO_HARD']),
    /** O quanto o plano alimentar coube na rotina, 1 a 5. */
    foodPlanFit: scale,
    energy: scale,
    sleep: scale,
    stress: scale,
    recovery: scale,
  }),
  whatWorked: note(600),
  whatDidNot: note(600),
  routine: z.object({
    changed: z.boolean(),
    daysPerWeek: z.number().int().min(1).max(7).nullable(),
    sessionMinutes: z.number().int().min(10).max(240).nullable(),
    notes: note(400),
    /** Dias da semana em que ele consegue treinar agora; vazio = não informou os dias. */
    weekdays: z.array(weekdaySchema).max(7).default([]),
    /** Período do dia em que costuma treinar; `null` = varia ou não informou. */
    slot: daySlotSchema.nullable().default(null),
  }),
  goals: z.object({
    stillTheSame: z.boolean(),
    notes: note(400),
  }),
  health: z.object({
    newPainOrInjury: z.boolean(),
    newCondition: z.boolean(),
    notes: note(500),
  }),
  nutrition: z.object({
    difficulties: note(500),
    newRestrictions: note(300),
  }),
  freeText: note(800),
});
export type CycleReassessmentAnswers = z.infer<typeof cycleReassessmentAnswersSchema>;

/** O que a página de reavaliação mostra antes do formulário. */
export const cycleReassessmentViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(['SENT', 'SUBMITTED', 'ANALYZED', 'PLANNED', 'FAILED']),
  /** Dia em que o ciclo terminou. */
  cycleEndedOn: z.iso.date(),
  firstName: z.string().nullable(),
  /** Medidas já registradas (a mais recente de cada tipo) para o aluno ver de onde partiu. */
  /** Fotos: se o aluno autorizou o uso e quais posições já foram enviadas. */
  photos: z.object({
    allowed: z.boolean(),
    angles: z.array(z.enum(['FRONT', 'RIGHT', 'BACK', 'LEFT'])),
  }),
  latestMeasurements: z.array(
    z.object({ kind: z.string(), value: z.number(), measuredOn: z.iso.date() }),
  ),
});
export type CycleReassessmentView = z.infer<typeof cycleReassessmentViewSchema>;
