import { z } from 'zod';

import { hyroxStationSchema } from './endurance.schema';
import { rpeSchema, sessionModalitySchema } from './modality.schema';

/** De onde veio o registro da execução. */
export const executionSourceSchema = z.enum([
  'LINK',
  'WHATSAPP_TEXT',
  'WHATSAPP_SCREENSHOT',
  'FIT_FILE',
  'GPX_FILE',
  'STAFF',
]);
export type ExecutionSource = z.infer<typeof executionSourceSchema>;

export const executionStatusSchema = z.enum(['IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'ABANDONED']);
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;

/** Uma série de força registrada. */
export const executionSetSchema = z.object({
  exerciseId: z.string().trim().min(1).max(80),
  /** >= 1: série válida; <= 0: aquecimento (numerado até 0, logo antes da série 1). */
  setNumber: z.number().int().min(-12).max(20),
  reps: z.number().int().min(0).max(300).nullable(),
  loadKg: z.number().min(0).max(1_000).nullable(),
  durationSeconds: z.number().int().min(0).max(14_400).nullable(),
  rir: z.number().int().min(0).max(10).nullable(),
  completed: z.boolean(),
});
export type ExecutionSet = z.infer<typeof executionSetSchema>;

/** Parcial (volta) de corrida/HYROX. */
export const lapSchema = z.object({
  distanceMeters: z.number().min(0).max(100_000),
  durationSeconds: z.number().min(0).max(86_400),
  avgHeartRate: z.number().int().min(30).max(240).optional(),
});
export type Lap = z.infer<typeof lapSchema>;

export const stationResultSchema = z.object({
  station: hyroxStationSchema,
  durationSeconds: z.number().min(0).max(7_200),
  loadKg: z.number().min(0).max(400).optional(),
});
export type StationResult = z.infer<typeof stationResultSchema>;

/** Métricas de endurance (corrida e HYROX). Todas opcionais: cada fonte traz o que tem. */
export const enduranceMetricsSchema = z.object({
  distanceMeters: z.number().min(0).max(300_000).optional(),
  movingSeconds: z.number().min(0).max(86_400).optional(),
  elapsedSeconds: z.number().min(0).max(86_400).optional(),
  avgPaceSecondsPerKm: z.number().min(100).max(1_800).optional(),
  avgHeartRate: z.number().int().min(30).max(240).optional(),
  maxHeartRate: z.number().int().min(30).max(240).optional(),
  elevationGainMeters: z.number().min(0).max(10_000).optional(),
  cadenceSpm: z.number().int().min(60).max(260).optional(),
  laps: z.array(lapSchema).max(200).optional(),
  stations: z.array(stationResultSchema).max(16).optional(),
});
export type EnduranceMetrics = z.infer<typeof enduranceMetricsSchema>;

/** Relato de dor durante/depois da sessão — sempre vira sinal para a sentinela. */
export const painReportSchema = z.object({
  region: z.string().trim().min(1).max(40),
  /** 0–10. */
  intensity: z.number().int().min(0).max(10),
  during: z.enum(['DURING', 'AFTER', 'NEXT_DAY']),
});
export type PainReport = z.infer<typeof painReportSchema>;

/** Fechamento de uma sessão executada (o que o aluno informa ao terminar). */
export const executionSummarySchema = z.object({
  modality: sessionModalitySchema,
  status: executionStatusSchema,
  rpe: rpeSchema.nullable(),
  durationMinutes: z.number().int().min(1).max(600).nullable(),
  painReports: z.array(painReportSchema).max(6),
  /** Como o aluno se sentiu com a sessão (aceitação), não o esforço. 1–5. */
  enjoyment: z.number().int().min(1).max(5).nullable(),
});
export type ExecutionSummary = z.infer<typeof executionSummarySchema>;

/** Carga interna da sessão (Foster): PSE × minutos. Mesma unidade para qualquer modalidade. */
export function sessionLoad(rpe: number, minutes: number): number {
  return Math.round(rpe * minutes);
}
