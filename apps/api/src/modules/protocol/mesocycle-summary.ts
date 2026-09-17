/**
 * `computeMesocycleSummary` — ficha de periodização + digest de execução de UM mesociclo
 * fechado (ADR-008, `docs/arquitetura/decisoes/adr-008-memoria-longitudinal-*.md`).
 *
 * Chamado exatamente uma vez por protocolo, no instante em que ele é `SUPERSEDED`
 * (`supersedePreviousActiveProtocols`) — write-once, read-many. Agregação **determinística
 * em SQL**, sem LLM: elimina custo de token, alucinação de sumarização e o erro composto
 * de "resumo de resumo" (Victor, ADR-008 §"Resumo é computado, nunca gerado").
 *
 * Bipartição obrigatória (Rafael, ADR-008 §3.3): `workout_sessions.feedback_cipher` é
 * `bytea` de `pgp_sym_encrypt` — texto livre não é agregável em SQL. Os agregados
 * numéricos/categóricos vão em `mesocycleSummary` (JSONB); qualquer texto livre é
 * destilado na aplicação e recifrado em `mesocycleNotesCipher`, nunca em claro no JSONB.
 *
 * Idempotente por natureza do chamador: o `UPDATE` só escreve quando `mesocycleSummary`
 * ainda é `NULL` (ver `persistMesocycleSummary`). Um retry de fila ou uma segunda chamada
 * (worker de renovação computando sob demanda um resumo ausente) nunca recomputa.
 */
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import type { ProtocolStructure, TrainingPhase } from '@movivo/shared';
import { PROTOCOL_RENEWAL_STEP_SCHEMAS } from '@movivo/shared';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  checkins,
  protocolRenewalSessions,
  protocols,
  workoutSessions,
  workoutSetEntries,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';

/** Sessão com dor relatada OU esforço quase máximo — só daí vem texto livre destilado. */
const HIGH_RPE_THRESHOLD = 9;
/** Teto de comentários destilados por mesociclo (Victor, ADR-008 §Camada 2). */
const MAX_DISTILLED_NOTES = 5;
/** Exercícios cobertos no digest, ordenados por volume (nº de séries registradas). */
const MAX_EXERCISES_IN_DIGEST = 10;
/** Últimos N mesociclos em linha completa na ficha de periodização (Victor, ADR-008 §Camada 1). */
export const PERIODIZATION_LEDGER_WINDOW = 6;

export interface MesocycleExerciseDigest {
  exerciseId: string;
  firstLoad: number | null;
  lastLoad: number | null;
  loadUnit: string | null;
  repMin: number | null;
  repMax: number | null;
  sessionsCompleted: number;
  sessionsPrescribed: number;
}

export interface MesocycleSummary {
  /** Linha de tamanho fixo pronta pro prompt — ver `formatLedgerLine`. */
  ledgerLine: string;
  mesocycleNumber: number;
  phase: TrainingPhase;
  phaseDurationWeeks: number;
  splitType?: string;
  weeklyFrequency: number;
  adherence: { completedSessions: number; plannedSessions: number; ratio: number };
  rpe: { first: number | null; last: number | null; avg: number | null };
  painSessionCount: number;
  /** Peso ao FIM deste mesociclo, vindo do Bloco 4 da renovação que o encerrou (se houve). */
  weightKg: number | null;
  checkinsCompleted: number;
  exercises: MesocycleExerciseDigest[];
}

export interface ComputedMesocycleSummary {
  summary: MesocycleSummary;
  notesCipher: Buffer | null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function loadTrendPercent(exercises: MesocycleExerciseDigest[]): number | null {
  const pct: number[] = [];
  for (const e of exercises) {
    if (e.firstLoad === null || e.lastLoad === null || e.firstLoad <= 0) continue;
    pct.push(((e.lastLoad - e.firstLoad) / e.firstLoad) * 100);
  }
  return pct.length === 0 ? null : average(pct);
}

function formatLedgerLine(
  summary: Omit<MesocycleSummary, 'ledgerLine'>,
  weightBefore: number | null,
): string {
  const adherencePct = Math.round(summary.adherence.ratio * 100);
  const loadPct = loadTrendPercent(summary.exercises);
  const loadLabel = loadPct === null ? 'n/d' : `${loadPct >= 0 ? '+' : ''}${Math.round(loadPct)}%`;
  const rpeLabel = summary.rpe.avg === null ? 'n/d' : summary.rpe.avg.toFixed(1);
  const splitLabel = summary.splitType ? `${summary.splitType} ` : '';
  const weightLabel =
    summary.weightKg === null
      ? null
      : weightBefore !== null && weightBefore !== summary.weightKg
        ? `${weightBefore}→${summary.weightKg}kg`
        : `${summary.weightKg}kg`;

  const parts = [
    `M${summary.mesocycleNumber}`,
    `${summary.phase} ${summary.phaseDurationWeeks}sem`,
    `${splitLabel}${summary.weeklyFrequency}x/sem`,
    `aderência ${adherencePct}%`,
    `carga ${loadLabel}`,
    `RPE méd ${rpeLabel}`,
    `dor ${summary.painSessionCount}`,
    ...(weightLabel ? [weightLabel] : []),
  ];
  return parts.join(' | ');
}

/**
 * Computa (sem persistir) o resumo do mesociclo `protocolId`. Roda sob a MESMA
 * `TenantTransaction` já aberta por `runAsUser`/`runAsSystem` no chamador — RLS por
 * titular continua valendo para as leituras de `workout_*`/`checkins`. A decifra de
 * `feedback_cipher` usa `HealthCipherService`, que opera na conexão própria do core
 * (fora desta transação, mesmo padrão já usado em `control-center.service.ts`).
 */
export async function computeMesocycleSummary(
  tx: TenantTransaction,
  cipher: HealthCipherService,
  userId: string,
  protocolId: string,
): Promise<ComputedMesocycleSummary | null> {
  const [protocol] = await tx
    .select({
      mesocycleNumber: protocols.mesocycleNumber,
      totalWeeks: protocols.totalWeeks,
      content: protocols.content,
    })
    .from(protocols)
    .where(and(eq(protocols.id, protocolId), eq(protocols.userId, userId)))
    .limit(1);
  if (!protocol) return null;

  const content = protocol.content as ProtocolStructure;

  const sessions = await tx
    .select({
      id: workoutSessions.id,
      scheduledDate: workoutSessions.scheduledDate,
      status: workoutSessions.status,
      perceivedEffort: workoutSessions.perceivedEffort,
      painReported: workoutSessions.painReported,
      feedbackCipher: workoutSessions.feedbackCipher,
    })
    .from(workoutSessions)
    .where(eq(workoutSessions.protocolId, protocolId))
    .orderBy(workoutSessions.scheduledDate);

  const plannedSessions = sessions.length;
  const completedSessions = sessions.filter((s) => s.status === 'COMPLETED').length;
  const rpeValues = sessions
    .map((s) => s.perceivedEffort)
    .filter((v): v is number => v !== null && v !== undefined);
  const painSessionCount = sessions.filter((s) => s.painReported).length;

  const exercises = await computeExerciseDigest(
    tx,
    sessions.map((s) => s.id),
  );

  const completedCheckins = await tx
    .select({ id: checkins.id })
    .from(checkins)
    .where(and(eq(checkins.protocolId, protocolId), eq(checkins.status, 'SUBMITTED')));
  const checkinsCompleted = completedCheckins.length;

  const weightKg = await weightAtClose(tx, protocolId);

  const summaryWithoutLedger: Omit<MesocycleSummary, 'ledgerLine'> = {
    mesocycleNumber: protocol.mesocycleNumber,
    phase: content.phase,
    phaseDurationWeeks: content.phaseDurationWeeks,
    ...(content.splitType ? { splitType: content.splitType } : {}),
    weeklyFrequency: content.weeklyFrequency,
    adherence: {
      completedSessions,
      plannedSessions,
      ratio: plannedSessions > 0 ? completedSessions / plannedSessions : 0,
    },
    rpe: {
      first: rpeValues[0] ?? null,
      last: rpeValues[rpeValues.length - 1] ?? null,
      avg: average(rpeValues),
    },
    painSessionCount,
    weightKg,
    checkinsCompleted,
    exercises,
  };

  const weightBefore = await previousMesocycleWeight(tx, userId, protocol.mesocycleNumber);
  const summary: MesocycleSummary = {
    ledgerLine: formatLedgerLine(summaryWithoutLedger, weightBefore),
    ...summaryWithoutLedger,
  };

  const notes = await distillNotes(tx, cipher, sessions);
  const notesCipher = notes.length ? await cipher.encryptHealth(JSON.stringify(notes)) : null;

  return { summary, notesCipher };
}

async function computeExerciseDigest(
  tx: TenantTransaction,
  sessionIds: string[],
): Promise<MesocycleExerciseDigest[]> {
  if (sessionIds.length === 0) return [];

  const entries = await tx
    .select({
      workoutSessionId: workoutSetEntries.workoutSessionId,
      exerciseId: workoutSetEntries.exerciseId,
      reps: workoutSetEntries.reps,
      loadValue: workoutSetEntries.loadValue,
      loadUnit: workoutSetEntries.loadUnit,
      completed: workoutSetEntries.completed,
    })
    .from(workoutSetEntries)
    .where(inArray(workoutSetEntries.workoutSessionId, sessionIds));

  type Agg = {
    loads: { value: number; sessionId: string }[];
    reps: number[];
    loadUnit: string | null;
    setCount: number;
    completedSessions: Set<string>;
    prescribedSessions: Set<string>;
  };
  const byExercise = new Map<string, Agg>();

  for (const entry of entries) {
    let agg = byExercise.get(entry.exerciseId);
    if (!agg) {
      agg = {
        loads: [],
        reps: [],
        loadUnit: null,
        setCount: 0,
        completedSessions: new Set(),
        prescribedSessions: new Set(),
      };
      byExercise.set(entry.exerciseId, agg);
    }
    agg.setCount += 1;
    agg.prescribedSessions.add(entry.workoutSessionId);
    if (entry.completed) {
      agg.completedSessions.add(entry.workoutSessionId);
      if (
        entry.loadValue !== null &&
        entry.loadUnit !== 'BODYWEIGHT' &&
        entry.loadUnit !== 'NONE'
      ) {
        agg.loads.push({ value: Number(entry.loadValue), sessionId: entry.workoutSessionId });
        agg.loadUnit = entry.loadUnit;
      }
      if (entry.reps !== null) agg.reps.push(entry.reps);
    }
  }

  const digests: MesocycleExerciseDigest[] = [...byExercise.entries()]
    .sort((a, b) => b[1].setCount - a[1].setCount)
    .slice(0, MAX_EXERCISES_IN_DIGEST)
    .map(([exerciseId, agg]) => ({
      exerciseId,
      firstLoad: agg.loads[0]?.value ?? null,
      lastLoad: agg.loads[agg.loads.length - 1]?.value ?? null,
      loadUnit: agg.loadUnit,
      repMin: agg.reps.length ? Math.min(...agg.reps) : null,
      repMax: agg.reps.length ? Math.max(...agg.reps) : null,
      sessionsCompleted: agg.completedSessions.size,
      sessionsPrescribed: agg.prescribedSessions.size,
    }));
  return digests;
}

/**
 * Texto livre destilado (Victor, ADR-008 §Camada 2): só sessões com dor relatada ou
 * esforço quase máximo, no máximo 5, mais recentes primeiro. Decifra pontual — no pior
 * caso 5 chamadas ao `pgp_sym_decrypt`, uma vez por fechamento de mesociclo.
 */
async function distillNotes(
  _tx: TenantTransaction,
  cipher: HealthCipherService,
  sessions: {
    scheduledDate: string;
    perceivedEffort: number | null;
    painReported: boolean;
    feedbackCipher: Buffer | null;
  }[],
): Promise<string[]> {
  const qualifying = sessions
    .filter(
      (s): s is typeof s & { feedbackCipher: Buffer } =>
        s.feedbackCipher !== null &&
        (s.painReported || (s.perceivedEffort ?? 0) >= HIGH_RPE_THRESHOLD),
    )
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1))
    .slice(0, MAX_DISTILLED_NOTES);

  const notes: string[] = [];
  for (const session of qualifying) {
    const text = (await cipher.decryptHealth(session.feedbackCipher)).trim();
    if (text) notes.push(text);
  }
  return [...new Set(notes)];
}

/** Peso relatado no Bloco 4 da renovação que fechou este protocolo (se já houve renovação). */
async function weightAtClose(tx: TenantTransaction, protocolId: string): Promise<number | null> {
  const [row] = await tx
    .select({ dataBlock4: protocolRenewalSessions.dataBlock4 })
    .from(protocolRenewalSessions)
    .where(
      and(
        eq(protocolRenewalSessions.previousProtocolId, protocolId),
        eq(protocolRenewalSessions.status, 'SUBMITTED'),
      ),
    )
    .limit(1);
  if (!row?.dataBlock4) return null;
  const block4 = PROTOCOL_RENEWAL_STEP_SCHEMAS[4].safeParse(row.dataBlock4);
  return block4.success ? block4.data.currentWeightKg : null;
}

/** Peso ao fim do mesociclo ANTERIOR (já resumido), para a seta "82→81kg" da ficha. */
async function previousMesocycleWeight(
  tx: TenantTransaction,
  userId: string,
  mesocycleNumber: number,
): Promise<number | null> {
  if (mesocycleNumber <= 1) return null;
  const [row] = await tx
    .select({ mesocycleSummary: protocols.mesocycleSummary })
    .from(protocols)
    .where(
      and(
        eq(protocols.userId, userId),
        eq(protocols.mesocycleNumber, mesocycleNumber - 1),
        isNotNull(protocols.mesocycleSummary),
      ),
    )
    .orderBy(desc(protocols.version))
    .limit(1);
  const summary = row?.mesocycleSummary as MesocycleSummary | undefined;
  return summary?.weightKg ?? null;
}

/**
 * Persiste o resumo computado — write-once. `mesocycleSummary IS NULL` no `WHERE` é a
 * idempotência real: uma segunda chamada (retry, ou cálculo sob demanda do worker de
 * renovação) nunca sobrescreve um resumo já gravado.
 */
export async function persistMesocycleSummary(
  tx: TenantTransaction,
  protocolId: string,
  computed: ComputedMesocycleSummary,
): Promise<void> {
  await tx
    .update(protocols)
    .set({ mesocycleSummary: computed.summary, mesocycleNotesCipher: computed.notesCipher })
    .where(and(eq(protocols.id, protocolId), isNull(protocols.mesocycleSummary)));
}

/**
 * Decifra os comentários destilados de um mesociclo (`mesocycleNotesCipher`), se houver.
 * Mesmo racional de `decryptHealth` em qualquer outro ponto de leitura: fora da
 * transação, na conexão própria do `HealthCipherService`.
 */
export async function readMesocycleNotes(
  cipher: HealthCipherService,
  notesCipher: Buffer | null,
): Promise<string[]> {
  if (!notesCipher) return [];
  const parsed = JSON.parse(await cipher.decryptHealth(notesCipher)) as unknown;
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * ADR-008 Camada 2 — renderiza o digest de execução de UM mesociclo (o que acabou de
 * fechar) para o prompt. Só números/categorias determinísticas + os comentários já
 * destilados — nunca decide nada aqui, só formata (Victor: "resumo é computado, nunca
 * gerado").
 */
export function formatExecutionDigest(summary: MesocycleSummary, notes: string[]): string {
  const lines: string[] = [
    `Aderência real: ${summary.adherence.completedSessions}/${summary.adherence.plannedSessions} sessões concluídas (${Math.round(summary.adherence.ratio * 100)}%).`,
  ];
  if (summary.rpe.avg !== null) {
    lines.push(
      `RPE real ao longo do ciclo: ${summary.rpe.first ?? 'n/d'} → ${summary.rpe.last ?? 'n/d'} (média ${summary.rpe.avg.toFixed(1)}).`,
    );
  }
  lines.push(`Sessões com dor relatada: ${summary.painSessionCount}.`);
  lines.push(`Check-ins semanais respondidos: ${summary.checkinsCompleted}.`);
  for (const ex of summary.exercises) {
    const loadPart =
      ex.firstLoad !== null && ex.lastLoad !== null
        ? `${ex.firstLoad}→${ex.lastLoad}${(ex.loadUnit ?? '').toLowerCase()}`
        : 'sem carga registrada';
    const repsPart =
      ex.repMin !== null && ex.repMax !== null ? `, ${ex.repMin}-${ex.repMax} reps` : '';
    lines.push(
      `${ex.exerciseId}: ${loadPart}${repsPart}, ${ex.sessionsCompleted}/${ex.sessionsPrescribed} sessões concluídas.`,
    );
  }
  if (notes.length) {
    lines.push('Comentários do aluno em sessões com dor relatada ou esforço quase máximo:');
    for (const note of notes) lines.push(`- ${note}`);
  }
  return lines.join('\n');
}

/**
 * ADR-008 Camada 1 — junta a janela recente (linhas completas) com a linha agregada de
 * carreira. Tamanho fixo no prompt: sempre no máximo `PERIODIZATION_LEDGER_WINDOW` linhas
 * completas + 1 linha de carreira, não importa quantos mesociclos o titular tenha.
 */
export function formatPeriodizationLedger(
  recentLedgerLines: string[],
  careerDigestLine: string | null,
): string {
  const lines = careerDigestLine ? [careerDigestLine, ...recentLedgerLines] : recentLedgerLines;
  return lines.join('\n');
}

/**
 * Agrega os mesociclos que ficaram FORA da janela recente numa única linha de tamanho
 * fixo — total de ciclos, fases já cumpridas e aderência média. `null` quando não há
 * mesociclo além da janela (titular ainda recente).
 */
export function buildCareerDigestLine(olderSummaries: MesocycleSummary[]): string | null {
  if (olderSummaries.length === 0) return null;
  const phaseCounts = new Map<string, number>();
  let totalPainSessions = 0;
  for (const s of olderSummaries) {
    phaseCounts.set(s.phase, (phaseCounts.get(s.phase) ?? 0) + 1);
    totalPainSessions += s.painSessionCount;
  }
  const phaseSummary = [...phaseCounts.entries()]
    .map(([phase, count]) => `${count}x ${phase}`)
    .join(', ');
  const avgAdherence = average(olderSummaries.map((s) => s.adherence.ratio)) ?? 0;
  return (
    `Carreira (${olderSummaries.length} mesociclo(s) mais antigos, resumidos): fases ${phaseSummary} | ` +
    `aderência média ${Math.round(avgAdherence * 100)}% | sessões com dor no total: ${totalPainSessions}.`
  );
}
