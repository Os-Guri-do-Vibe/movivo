import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import {
  anamnesisStructuredSchema,
  mapWorkoutMuscles,
  protocolStructureSchema,
  type FinishWorkoutInput,
  type ProtocolSession,
  type WorkoutJournal,
  type WorkoutPreferencesInput,
  type WorkoutSetInput,
  type WorkoutShareCardData,
} from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  anamnesisSessions,
  exerciseCatalogEntries,
  handoffAlerts,
  protocols,
  protocolVersions,
  subscriptions,
  users,
  workoutInsights,
  workoutSessions,
  workoutSetEntries,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { FollowupService } from '../followup/followup.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { EXERCISE_BY_ID } from '../catalog/exercises/exercise-catalog';
import { ShareCardRenderer, type ShareCardImage } from './share-card/share-card-renderer.service';
import { WorkoutCompletionService } from './workout-completion.service';
import {
  effectiveSessionForDate,
  LATE_LOG_WINDOW_DAYS,
  type ScheduleOverrides,
} from './schedule-planner';
import { WorkoutScheduleService } from './workout-schedule.service';
import { durationInsightButtons, durationInsightMessage } from './workout-messages';

/**
 * Cardio contínuo (bike, esteira) não tem reps/carga pra registrar — só "fez ou
 * não fez" (achado 2026-09-04). Calculado do catálogo aqui, na leitura, e nunca
 * persistido: protocolos já gerados (sem este dado) passam a ter o sinal certo
 * sem precisar de backfill.
 */
function withCardioFlag(session: ProtocolSession): ProtocolSession {
  return {
    ...session,
    exercises: session.exercises.map((exercise) => ({
      ...exercise,
      isCardio: EXERCISE_BY_ID.get(exercise.exerciseId)?.pattern === 'CARDIO',
    })),
  };
}

const WEEKDAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
/** Quantos dias para trás `recentMissStreak` olha ao contar a sequência (descanso incluso). */
const MAX_STREAK_SCAN_DAYS = 14;
const DURATION_CEILING: Readonly<Record<string, number>> = {
  LT_30: 30,
  M30_TO_45: 45,
  M45_TO_60: 60,
  M60_TO_90: 90,
  GT_90: 90,
};

/** JSON com chaves ordenadas: `jsonb` não preserva a ordem, então comparar prescrições exige isto. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function dateAtNoon(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const value = dateAtNoon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function localDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function weekStart(date: string): string {
  return addDays(date, -dateAtNoon(date).getUTCDay());
}

function prescribedSession(
  date: string,
  structure: ReturnType<typeof protocolStructureSchema.parse>,
  overrides?: ScheduleOverrides,
) {
  // Mesmo calendário do link diário e do Coach: o padrão do protocolo (`sessionForWeekday`) mais
  // os ajustes que o aluno pediu ao Coach (`workout_schedule_adjustments`).
  return effectiveSessionForDate(date, structure, overrides) ?? undefined;
}

function expectedSets(session: ProtocolSession): WorkoutSetInput[] {
  return session.exercises.flatMap((exercise) => {
    const loadUnit =
      exercise.loadStrategy === 'BODYWEIGHT' ? ('BODYWEIGHT' as const) : ('KG' as const);
    const warmupCount = (exercise.warmupBlocks ?? []).reduce((sum, block) => sum + block.sets, 0);
    // Aquecimento numerado em ordem crescente terminando em 0, logo antes da série 1.
    const warmupSets = Array.from({ length: warmupCount }, (_, index) => ({
      exerciseId: exercise.exerciseId,
      setNumber: index - warmupCount + 1,
      reps: null,
      loadValue: null,
      loadUnit,
      durationSeconds: null,
      completed: false,
      skipped: false,
    }));
    const workingSets = Array.from({ length: exercise.sets }, (_, index) => ({
      exerciseId: exercise.exerciseId,
      setNumber: index + 1,
      reps: null,
      loadValue: null,
      loadUnit,
      durationSeconds: null,
      completed: false,
      skipped: false,
    }));
    return [...warmupSets, ...workingSets];
  });
}

interface ProtocolVersionRow {
  version: number;
  content: unknown;
  createdAt: Date;
}

/** A versão do protocolo vigente no dia local `date` (nunca a vigente agora). */
function pickVersion(
  versions: readonly ProtocolVersionRow[],
  timezone: string,
  date: string,
): { structure: ReturnType<typeof protocolStructureSchema.parse>; version: number } {
  let chosen = versions[0];
  for (const candidate of versions) {
    if (localDate(candidate.createdAt, timezone) > date) break;
    chosen = candidate;
  }
  if (!chosen) throw new NotFoundException('Nenhuma versao de protocolo encontrada.');
  return { structure: protocolStructureSchema.parse(chosen.content), version: chosen.version };
}

interface ExistingDaySession {
  id: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';
  sessionKey: string;
  prescription: ProtocolSession;
}

/**
 * A única regra de "faltou" do sistema. `prescription` é a sessão prevista para o dia pela
 * estrutura vigente NAQUELA data (já resolvida por quem chama); uma sessão já criada vale mais
 * que ela, porque guarda o snapshot exato do que foi prescrito.
 */
function classifyDay(
  date: string,
  existing: ExistingDaySession | undefined,
  prescription: ProtocolSession | undefined,
  protocolId: string,
): WorkoutDayStatus {
  if (existing?.status === 'COMPLETED') return { kind: 'DONE' };
  if (existing?.status === 'IN_PROGRESS') return { kind: 'IN_PROGRESS' };
  const planned = existing?.prescription ?? prescription;
  if (!planned) return { kind: 'REST' };
  return {
    kind: 'MISSED',
    dayLabel: planned.dayLabel,
    focus: planned.focus,
    sessionKey: existing?.sessionKey ?? planned.dayLabel,
    workoutSessionId: existing?.id ?? null,
    protocolId,
    weekdayName: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(
      dateAtNoon(date),
    ),
  };
}

export type WorkoutDayStatus =
  | { kind: 'BEFORE_START' | 'REST' | 'DONE' | 'IN_PROGRESS' }
  | {
      kind: 'MISSED';
      dayLabel: string;
      focus: string;
      sessionKey: string;
      workoutSessionId: string | null;
      protocolId: string;
      /** Nome do dia da semana em pt-BR ("segunda-feira"), para a copy falar de "segunda". */
      weekdayName: string;
    };

@Injectable()
export class WorkoutJournalService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly completions: WorkoutCompletionService,
    private readonly queues: QueueManager,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly shareCards: ShareCardRenderer,
    private readonly followups: FollowupService,
    private readonly schedule: WorkoutScheduleService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutJournalService.name);
  }

  async journal(userId: string, requestedDate?: string, now = new Date()): Promise<WorkoutJournal> {
    const owner = await this.ownerAndProtocol(userId);
    const today = localDate(now, owner.timezone);
    const selectedDate = requestedDate ?? today;
    if (selectedDate > today) throw new BadRequestException('Nao e possivel abrir um dia futuro.');
    // Achado 2026-10-12: o histórico começa no dia em que o PRIMEIRO protocolo do aluno foi
    // entregue. Dias anteriores nunca tiveram treino prescrito — não são "perdidos" nem
    // "descanso", e não podem gerar sessão. Usa o primeiro protocolo (qualquer status), não
    // o ativo, pra um protocolo novo não apagar o histórico já vivido.
    const firstProtocolDate = localDate(owner.firstStartDate ?? owner.startDate, owner.timezone);
    // Usada só pra classificar PLANNED/REST da semana exibida (achado abaixo não se aplica
    // aqui: o padrão de dias/frequência é metadado do protocolo, não algo que uma
    // substituição de exercício altera).
    const structure = protocolStructureSchema.parse(owner.content);
    const overrides = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.schedule.loadOverrides(tx, userId, owner.protocolId, now),
    );
    const weekNumber = Math.max(
      1,
      Math.min(
        owner.totalWeeks,
        Math.floor((dateAtNoon(selectedDate).getTime() - owner.startDate.getTime()) / 604_800_000) +
          1,
      ),
    );

    const workout = await this.db.runAsUser(userId, 'USER', async (tx) => {
      if (selectedDate < firstProtocolDate) return undefined;
      const [existing] = await tx
        .select()
        .from(workoutSessions)
        .where(
          and(eq(workoutSessions.userId, userId), eq(workoutSessions.scheduledDate, selectedDate)),
        )
        .orderBy(desc(workoutSessions.createdAt))
        .limit(1);
      if (existing) return existing;

      /**
       * Achado 2026-09-10 (pedido do fundador): a substituição de exercício só pode valer
       * da data de aprovação em diante. Um dia PASSADO nunca visitado antes de hoje não
       * pode "herdar" o exercício novo só porque este era o primeiro toque nele — resolve
       * qual versão de `protocol_versions` estava de fato vigente no dia local
       * `selectedDate`, nunca a versão vigente AGORA (`owner.content`/`owner.protocolVersion`).
       * Pra "hoje" isso sempre resolve pra a versão vigente mesmo (nenhuma versão futura
       * existe ainda) — não precisa de caminho especial.
       */
      const { structure: historicalStructure, version: historicalVersion } =
        await this.structureAsOf(tx, owner.protocolId, owner.timezone, selectedDate);
      const prescription = prescribedSession(selectedDate, historicalStructure, overrides);
      if (!prescription) return undefined;

      await tx
        .insert(workoutSessions)
        .values({
          userId,
          protocolId: owner.protocolId,
          protocolVersion: historicalVersion,
          weekNumber,
          sessionKey: prescription.dayLabel,
          scheduledDate: selectedDate,
          prescription,
        })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(workoutSessions)
        .where(
          and(eq(workoutSessions.userId, userId), eq(workoutSessions.scheduledDate, selectedDate)),
        )
        .orderBy(desc(workoutSessions.createdAt))
        .limit(1);
      return row;
    });

    const start = weekStart(selectedDate);
    const end = addDays(start, 6);
    const weekRows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ date: workoutSessions.scheduledDate, status: workoutSessions.status })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            gte(workoutSessions.scheduledDate, start),
            lte(workoutSessions.scheduledDate, end),
          ),
        ),
    );
    const rowByDate = new Map(weekRows.map((row) => [row.date, row.status]));
    const week = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      const row = rowByDate.get(date);
      const planned = Boolean(prescribedSession(date, structure, overrides));
      const state =
        date > today
          ? 'FUTURE'
          : date < firstProtocolDate
            ? 'BEFORE_START'
            : row === 'COMPLETED'
              ? 'COMPLETED'
              : row === 'IN_PROGRESS'
                ? 'IN_PROGRESS'
                : !planned
                  ? 'REST'
                  : date < today
                    ? 'MISSED'
                    : 'PLANNED';
      return { date, weekday: WEEKDAY[index] ?? 'SUN', state } as const;
    });

    let workoutView: WorkoutJournal['workout'] = null;
    if (workout) {
      const entries = await this.db.runAsUser(userId, 'USER', async (tx) => {
        const current = await tx
          .select()
          .from(workoutSetEntries)
          .where(eq(workoutSetEntries.workoutSessionId, workout.id))
          .orderBy(asc(workoutSetEntries.exerciseId), asc(workoutSetEntries.setNumber));
        // Placeholder do "treino passado": a última sessão CONCLUÍDA em que cada série do
        // exercício foi de fato realizada (reps/tempo > 0). Sessão em que o exercício foi
        // pulado ou ficou vazio é ignorada — vale a anterior mais recente com dado.
        const exerciseIds = workout.prescription.exercises.map((exercise) => exercise.exerciseId);
        const previous = exerciseIds.length
          ? await tx
              .select({
                exerciseId: workoutSetEntries.exerciseId,
                setNumber: workoutSetEntries.setNumber,
                reps: workoutSetEntries.reps,
                loadValue: workoutSetEntries.loadValue,
                loadUnit: workoutSetEntries.loadUnit,
                durationSeconds: workoutSetEntries.durationSeconds,
                date: workoutSessions.scheduledDate,
                sessionKey: workoutSessions.sessionKey,
              })
              .from(workoutSetEntries)
              .innerJoin(
                workoutSessions,
                eq(workoutSessions.id, workoutSetEntries.workoutSessionId),
              )
              .where(
                and(
                  eq(workoutSessions.userId, userId),
                  eq(workoutSessions.status, 'COMPLETED'),
                  lt(workoutSessions.scheduledDate, selectedDate),
                  inArray(workoutSetEntries.exerciseId, exerciseIds),
                  eq(workoutSetEntries.completed, true),
                  eq(workoutSetEntries.skipped, false),
                  or(gt(workoutSetEntries.reps, 0), gt(workoutSetEntries.durationSeconds, 0)),
                ),
              )
              .orderBy(desc(workoutSessions.scheduledDate), desc(workoutSetEntries.updatedAt))
              .limit(500)
          : [];
        return { current, previous };
      });
      const currentByKey = new Map(
        entries.current.map((entry) => [`${entry.exerciseId}:${entry.setNumber}`, entry]),
      );
      // Ordenado do mais recente ao mais antigo. Vale a última vez que o aluno fez ESTA sessão
      // (seja em que dia da semana for: o treino pode ter sido remarcado); sem registro dela, a
      // última vez que fez o exercício em qualquer sessão.
      const previousByKey = new Map<string, (typeof entries.previous)[number]>();
      for (const entry of entries.previous) {
        const key = `${entry.exerciseId}:${entry.setNumber}`;
        const current = previousByKey.get(key);
        const sameSession = entry.sessionKey === workout.sessionKey;
        if (!current || (sameSession && current.sessionKey !== workout.sessionKey)) {
          previousByKey.set(key, entry);
        }
      }
      const sets = expectedSets(workout.prescription).map((expected) => {
        const key = `${expected.exerciseId}:${expected.setNumber}`;
        const current = currentByKey.get(key);
        const previous = previousByKey.get(key);
        return {
          exerciseId: expected.exerciseId,
          setNumber: expected.setNumber,
          reps: current?.reps ?? null,
          loadValue:
            current?.loadValue === null || current?.loadValue === undefined
              ? null
              : Number(current.loadValue),
          loadUnit: current?.loadUnit ?? expected.loadUnit,
          durationSeconds: current?.durationSeconds ?? null,
          completed: current?.completed ?? false,
          skipped: current?.skipped ?? false,
          previous: previous
            ? {
                date: previous.date,
                reps: previous.reps,
                loadValue: previous.loadValue === null ? null : Number(previous.loadValue),
                loadUnit: previous.loadUnit,
                durationSeconds: previous.durationSeconds,
              }
            : null,
        };
      });
      workoutView = {
        id: workout.id,
        status: workout.status,
        prescription: withCardioFlag(workout.prescription),
        startedAt: workout.startedAt?.toISOString() ?? null,
        finishedAt: workout.finishedAt?.toISOString() ?? null,
        durationSeconds: workout.durationSeconds,
        perceivedEffort: workout.perceivedEffort,
        painReported: workout.painReported,
        sets,
        loggedLate: workout.loggedLate,
        canLogLate:
          workout.status === 'PLANNED' &&
          selectedDate < today &&
          selectedDate >= addDays(today, -LATE_LOG_WINDOW_DAYS) &&
          selectedDate >= firstProtocolDate,
      };
      const shareCard = await this.buildShareCard(userId, workout, owner, sets);
      if (shareCard) workoutView.shareCard = shareCard;
    }

    return {
      firstName: owner.name?.trim().split(/\s+/)[0] || 'atleta',
      today,
      selectedDate,
      firstProtocolDate,
      week,
      workout: workoutView,
    };
  }

  /**
   * Situação de um dia civil do aluno quanto ao treino — a ÚNICA regra de "faltou" do sistema
   * (pergunta do Coach sobre treino sem registro, retrato do aluno). Só leitura: ao contrário
   * de `journal()`, não cria a sessão do dia.
   *
   * - `BEFORE_START`: até o dia da entrega do 1º protocolo (inclusive). Nesse dia o aluno
   *   acabou de receber o treino, não há o que cobrar.
   * - `REST`: o protocolo não prevê treino na data.
   * - `DONE`: sessão concluída.
   * - `IN_PROGRESS`: o aluno começou e ainda não finalizou. NÃO é falta: provavelmente está
   *   treinando, ou treinou e esqueceu de finalizar.
   * - `MISSED`: treino previsto sem sessão iniciada.
   *
   * Para `date` igual a hoje o dia ainda está aberto: quem chama só deve perguntar sobre dias
   * já encerrados (a pergunta do Coach avalia sempre dias anteriores a hoje).
   */
  async dayStatus(userId: string, date: string, now = new Date()): Promise<WorkoutDayStatus> {
    const owner = await this.ownerAndProtocol(userId);
    if (date > localDate(now, owner.timezone)) {
      throw new BadRequestException('Nao e possivel avaliar um dia futuro.');
    }
    if (date <= localDate(owner.firstStartDate ?? owner.startDate, owner.timezone)) {
      return { kind: 'BEFORE_START' };
    }
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [existing] = await tx
        .select({
          id: workoutSessions.id,
          status: workoutSessions.status,
          sessionKey: workoutSessions.sessionKey,
          prescription: workoutSessions.prescription,
        })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.scheduledDate, date)))
        .orderBy(desc(workoutSessions.createdAt))
        .limit(1);
      // Só carrega as versões do protocolo quando a sessão ainda não existe e é preciso saber
      // se havia treino previsto.
      const prescription = existing
        ? undefined
        : prescribedSession(
            date,
            (await this.structureAsOf(tx, owner.protocolId, owner.timezone, date)).structure,
            await this.schedule.loadOverrides(tx, userId, owner.protocolId, now),
          );
      return classifyDay(date, existing, prescription, owner.protocolId);
    });
  }

  /**
   * Situação de cada um dos `days` dias fechados anteriores a `before`, do mais antigo ao mais
   * recente, em poucas consultas (dono, sessões do intervalo, versões do protocolo) em vez de
   * uma rodada por dia. Base do alerta de frequência para o profissional CREF.
   */
  async attendanceWindow(
    userId: string,
    before: string,
    now = new Date(),
    days = 14,
  ): Promise<Array<{ date: string; status: WorkoutDayStatus }>> {
    const owner = await this.ownerAndProtocol(userId);
    if (before > addDays(localDate(now, owner.timezone), 1)) {
      throw new BadRequestException('Nao e possivel avaliar um dia futuro.');
    }
    const firstProtocolDate = localDate(owner.firstStartDate ?? owner.startDate, owner.timezone);
    const dates = Array.from({ length: days }, (_, index) => addDays(before, index - days));
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const rows = await tx
        .select({
          id: workoutSessions.id,
          date: workoutSessions.scheduledDate,
          status: workoutSessions.status,
          sessionKey: workoutSessions.sessionKey,
          prescription: workoutSessions.prescription,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            gte(workoutSessions.scheduledDate, dates[0] ?? before),
            lt(workoutSessions.scheduledDate, before),
          ),
        )
        .orderBy(desc(workoutSessions.createdAt));
      // Mais recente primeiro: a primeira linha de cada dia é a que vale.
      const byDate = new Map<string, ExistingDaySession>();
      for (const row of rows) if (!byDate.has(row.date)) byDate.set(row.date, row);
      const versions = await this.loadVersions(tx, owner.protocolId);
      const overrides = await this.schedule.loadOverrides(tx, userId, owner.protocolId, now);
      return dates.map((date) => {
        if (date <= firstProtocolDate) return { date, status: { kind: 'BEFORE_START' as const } };
        const existing = byDate.get(date);
        const prescription = existing
          ? undefined
          : prescribedSession(
              date,
              pickVersion(versions, owner.timezone, date).structure,
              overrides,
            );
        return { date, status: classifyDay(date, existing, prescription, owner.protocolId) };
      });
    });
  }

  /**
   * Última sessão PREVISTA antes de `before` (olhando até `lookbackDays` dias, pulando dias de
   * descanso) e quantas sessões previstas seguidas ficaram sem registro a partir dela.
   *
   * Serve a duas decisões do mesmo fato: (1) a pergunta do Coach junto do link de hoje só sai
   * quando a ÚLTIMA sessão prevista ficou sem registro e foi a primeira da sequência
   * (`streak === 1`: na 2ª falta seguida vai só o link); (2) o comentário pós-treino reconhece
   * a volta quando a sessão prevista anterior ficou sem registro. `streak` para em `cap`.
   * Usa `dayStatus`, a única regra de "faltou" do sistema.
   */
  async recentMissStreak(
    userId: string,
    before: string,
    now = new Date(),
    options: { lookbackDays?: number; cap?: number } = {},
  ): Promise<{ target: { date: string; status: WorkoutDayStatus } | null; streak: number }> {
    const { lookbackDays = 3, cap = 3 } = options;
    let date = addDays(before, -1);
    let target: { date: string; status: WorkoutDayStatus } | null = null;
    for (let step = 0; step < lookbackDays; step += 1) {
      const status = await this.dayStatus(userId, date, now);
      if (status.kind !== 'REST') {
        target = { date, status };
        break;
      }
      date = addDays(date, -1);
    }
    if (!target) return { target: null, streak: 0 };
    if (target.status.kind !== 'MISSED') return { target, streak: 0 };

    let streak = 1;
    let cursor = addDays(target.date, -1);
    for (let scanned = 0; streak < cap && scanned < MAX_STREAK_SCAN_DAYS; scanned += 1) {
      const status = await this.dayStatus(userId, cursor, now);
      cursor = addDays(cursor, -1);
      if (status.kind === 'REST') continue;
      if (status.kind !== 'MISSED') break;
      streak += 1;
    }
    return { target, streak };
  }

  /**
   * Atualiza, no lugar, o treino de `date` que ainda não começou quando a prescrição vigente já
   * não é a que ele guarda (troca de exercício aprovada, emenda do profissional depois do link
   * das 04:00). O snapshot é uma cópia do dia da abertura do link; sem isto o aluno abriria o
   * exercício antigo. Mantém a linha (e os links que apontam para ela) quando é a mesma sessão;
   * se a sessão do dia passou a ser outra, apaga a linha e deixa o diário recriá-la.
   *
   * Só mexe em treino `PLANNED`: nunca num treino em andamento ou concluído.
   */
  async refreshPlannedSession(
    userId: string,
    date: string,
    now = new Date(),
  ): Promise<'CHANGED' | 'UNCHANGED' | 'NONE'> {
    const owner = await this.ownerAndProtocol(userId);
    return this.db.runAsSystem(async (tx) => {
      const [existing] = await tx
        .select({
          id: workoutSessions.id,
          status: workoutSessions.status,
          sessionKey: workoutSessions.sessionKey,
          prescription: workoutSessions.prescription,
        })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.scheduledDate, date)))
        .orderBy(desc(workoutSessions.createdAt))
        .limit(1);
      if (!existing || existing.status !== 'PLANNED') return 'NONE';

      const { structure, version } = await this.structureAsOf(
        tx,
        owner.protocolId,
        owner.timezone,
        date,
      );
      const overrides = await this.schedule.loadOverrides(tx, userId, owner.protocolId, now);
      const expected = prescribedSession(date, structure, overrides);
      if (expected && stableStringify(expected) === stableStringify(existing.prescription)) {
        return 'UNCHANGED';
      }
      if (expected && expected.dayLabel === existing.sessionKey) {
        await tx
          .update(workoutSessions)
          .set({ prescription: expected, protocolVersion: version })
          .where(eq(workoutSessions.id, existing.id));
      } else {
        await this.schedule.discardPlannedSessions(tx, userId, [date]);
      }
      return 'CHANGED';
    });
  }

  /**
   * Registro tardio (agenda flexível): o aluno treinou num dos últimos `LATE_LOG_WINDOW_DAYS`
   * dias e quer registrar agora. Abre o treino daquele dia para preenchimento SEM cronômetro
   * (`started_at` vazio, `logged_late` ligado); o resto do fluxo (séries, finalizar, comentário
   * do Coach) é o de sempre. Idempotente: abrir de novo um registro tardio já aberto não muda nada.
   */
  async startLate(userId: string, id: string, now = new Date()): Promise<void> {
    const [owned] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          scheduledDate: workoutSessions.scheduledDate,
          status: workoutSessions.status,
          loggedLate: workoutSessions.loggedLate,
          timezone: users.timezone,
        })
        .from(workoutSessions)
        .innerJoin(users, eq(users.id, workoutSessions.userId))
        .where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)))
        .limit(1),
    );
    if (!owned) throw new NotFoundException();
    if (owned.status === 'IN_PROGRESS' && owned.loggedLate) return;
    if (owned.status !== 'PLANNED') throw new BadRequestException('Treino ja finalizado.');

    const today = localDate(now, owned.timezone);
    if (owned.scheduledDate >= today) {
      throw new BadRequestException('Para o treino de hoje, use "Iniciar".');
    }
    if (owned.scheduledDate < addDays(today, -LATE_LOG_WINDOW_DAYS)) {
      throw new BadRequestException(
        `So e possivel registrar treinos dos ultimos ${LATE_LOG_WINDOW_DAYS} dias.`,
      );
    }
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(workoutSessions)
        .set({ status: 'IN_PROGRESS', loggedLate: true })
        .where(
          and(
            eq(workoutSessions.id, id),
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.status, 'PLANNED'),
          ),
        ),
    );
  }

  async start(userId: string, id: string, now = new Date()): Promise<void> {
    const [owned] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ scheduledDate: workoutSessions.scheduledDate, timezone: users.timezone })
        .from(workoutSessions)
        .innerJoin(users, eq(users.id, workoutSessions.userId))
        .where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)))
        .limit(1),
    );
    if (!owned) throw new NotFoundException();
    /**
     * Achado 2026-09-10 (pedido do fundador): "Iniciar treino" só vale pro dia ATUAL — um
     * dia passado é só consulta (protocolo, carga/repetições já registradas), nunca pode
     * virar um treino em andamento retroativo. A tela já esconde o botão fora de hoje, mas
     * o endpoint nunca pode confiar só nisso (mesma defesa em profundidade do resto do
     * módulo).
     */
    if (owned.scheduledDate !== localDate(now, owned.timezone)) {
      throw new BadRequestException('So e possivel iniciar o treino do dia atual.');
    }

    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(workoutSessions)
        .set({ status: 'IN_PROGRESS', startedAt: new Date() })
        .where(
          and(
            eq(workoutSessions.id, id),
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.status, 'PLANNED'),
          ),
        )
        .returning({ id: workoutSessions.id }),
    );
    if (!row) {
      const existing = await this.ownedSession(userId, id);
      if (!existing) throw new NotFoundException();
      if (existing.status !== 'IN_PROGRESS') throw new BadRequestException('Treino ja finalizado.');
    }
  }

  /**
   * Fecha pendências de conversa sem nunca atrapalhar o registro do treino: o aluno já
   * treinou, e uma falha aqui (pendência é acessório) só deixa a expiração por tempo agir.
   */
  private async settleFollowups(userId: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (err: unknown) {
      this.logger.warn(
        { err, userId, event: 'workout_followup_settle_failed' },
        'treino registrado, mas a pendência de conversa não foi atualizada',
      );
    }
  }

  async saveSets(userId: string, id: string, entries: WorkoutSetInput[]): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      const workout = await this.ownedSession(userId, id, tx);
      if (!workout) throw new NotFoundException();
      if (workout.status !== 'IN_PROGRESS')
        throw new BadRequestException('Treino nao esta em andamento.');
      const allowed = new Set(
        expectedSets(workout.prescription).map((entry) => `${entry.exerciseId}:${entry.setNumber}`),
      );
      if (entries.some((entry) => !allowed.has(`${entry.exerciseId}:${entry.setNumber}`))) {
        throw new BadRequestException('Serie nao pertence a prescricao deste treino.');
      }
      for (const raw of entries) {
        // Fonte de verdade de "série feita": reps ou tempo > 0 e não pulada. O cliente
        // nunca decide isso sozinho, e nada é preenchido por padrão (nem pela prescrição
        // nem pelo treino passado).
        const entry = {
          ...raw,
          completed: !raw.skipped && ((raw.reps ?? 0) > 0 || (raw.durationSeconds ?? 0) > 0),
        };
        await tx
          .insert(workoutSetEntries)
          .values({
            ...entry,
            loadValue: entry.loadValue?.toString(),
            userId,
            workoutSessionId: id,
          })
          .onConflictDoUpdate({
            target: [
              workoutSetEntries.workoutSessionId,
              workoutSetEntries.exerciseId,
              workoutSetEntries.setNumber,
            ],
            set: {
              reps: entry.reps,
              loadValue: entry.loadValue?.toString(),
              loadUnit: entry.loadUnit,
              durationSeconds: entry.durationSeconds,
              completed: entry.completed,
              skipped: entry.skipped,
              updatedAt: new Date(),
            },
          });
      }
    });
  }

  async finish(userId: string, id: string, input: FinishWorkoutInput): Promise<void> {
    const workout = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const workout = await this.ownedSession(userId, id, tx);
      if (!workout) throw new NotFoundException();
      if (workout.status === 'COMPLETED') throw new BadRequestException('Treino ja finalizado.');
      // Registro tardio não tem cronômetro: `started_at` fica vazio e a duração não é inventada.
      if (workout.status !== 'IN_PROGRESS' || (!workout.startedAt && !workout.loggedLate))
        throw new BadRequestException('Inicie o treino antes de finalizar.');
      if (
        input.painExerciseIds.some(
          (painExerciseId) =>
            !workout.prescription.exercises.some(
              (exercise) => exercise.exerciseId === painExerciseId,
            ),
        )
      ) {
        throw new BadRequestException('Exercicio de dor invalido.');
      }
      const now = new Date();
      const durationSeconds = workout.startedAt
        ? Math.min(
            43_200,
            Math.max(0, Math.round((now.getTime() - workout.startedAt.getTime()) / 1000)),
          )
        : null;
      const feedbackCipher = await this.cipher.encryptHealth(
        JSON.stringify({ feelingNotes: input.feelingNotes, painNotes: input.painNotes }),
      );
      await tx
        .update(workoutSessions)
        .set({
          status: 'COMPLETED',
          finishedAt: now,
          durationSeconds,
          perceivedEffort: input.perceivedEffort,
          feedbackCipher,
          painReported: input.painReported,
          painExerciseIds: input.painExerciseIds,
        })
        .where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)));
      if (input.painReported) {
        await tx
          .insert(handoffAlerts)
          .values({
            userId,
            level: 'SAFETY',
            reason: 'DOR_APOS_TREINO',
            sourceType: 'WORKOUT',
            sourceId: id,
          })
          .onConflictDoNothing();
      }
      return workout;
    });
    const exerciseEntries = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.select().from(workoutSetEntries).where(eq(workoutSetEntries.workoutSessionId, id)),
    );
    await this.completions.record(
      userId,
      workout.protocolId,
      workout.protocolVersion,
      workout.weekNumber,
      workout.sessionKey,
      workout.scheduledDate,
      'WEB_JOURNAL',
      { exercisesDone: exerciseEntries, perceivedEffort: input.perceivedEffort },
    );
    if (input.painReported) this.queueEvents.emit('handoff');
    await this.settleFollowups(userId, () =>
      this.followups.resolveForWorkout(userId, workout.scheduledDate),
    );
    await this.evaluateDuration(userId, workout.scheduledDate);

    // Achado 2026-09-12 (pedido do fundador): o Coach passa a comentar o treino recém
    // registrado (planejado x realizado), em vez de o aluno só receber a confirmação
    // silenciosa do registro. Fila própria (`workout` não fala com `LlmRouter`/
    // `ValidationService` diretamente — fronteira §12.5); quem gera o texto é o
    // `WorkoutFeedbackWorker`, no `CoachModule`.
    await this.queues.enqueue(
      QUEUE.workoutFeedback,
      'workout-feedback',
      { userId, workoutSessionId: id },
      { jobId: `workout-feedback-${id}` },
    );
  }

  async preferences(userId: string, input: WorkoutPreferencesInput): Promise<void> {
    if (input.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format();
      } catch {
        throw new BadRequestException('Fuso horario invalido.');
      }
    }
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(users)
        .set({
          ...(input.reminderTime === undefined ? {} : { workoutReminderTime: input.reminderTime }),
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        })
        .where(eq(users.id, userId)),
    );
  }

  async respondToInsight(userId: string, insightId: string, adjust: boolean): Promise<boolean> {
    const [row] = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [updated] = await tx
        .update(workoutInsights)
        .set({ status: adjust ? 'ADJUST_REQUESTED' : 'ACKNOWLEDGED', respondedAt: new Date() })
        .where(
          and(
            eq(workoutInsights.id, insightId),
            eq(workoutInsights.userId, userId),
            eq(workoutInsights.status, 'SENT'),
          ),
        )
        .returning({ id: workoutInsights.id });
      if (updated && adjust) {
        await tx.insert(handoffAlerts).values({
          userId,
          level: 'ALERT',
          reason: 'AJUSTE_DURACAO_SOLICITADO',
          sourceType: 'WORKOUT_INSIGHT',
          sourceId: insightId,
        });
      }
      return [updated];
    });
    if (row && adjust) this.queueEvents.emit('handoff');
    return Boolean(row);
  }

  /**
   * Qual `protocol_versions.content` estava vigente no FIM do dia local `selectedDate` —
   * nunca a versão vigente agora. Compara pela DATA LOCAL de `createdAt` de cada versão
   * (mesma conversão de `localDate()`, sem aritmética de fuso nova): a última versão cuja
   * data local de criação seja `<= selectedDate` é a que valia naquele dia. Toda versão
   * (inclusive a v1 inicial) nasce em `protocol_versions` (ver `ProtocolRepository.persist`/
   * `ProtocolSubstitutionRepository.applyReleaseTail`), então sempre há pelo menos uma.
   */
  private async structureAsOf(
    tx: TenantTransaction,
    protocolId: string,
    timezone: string,
    selectedDate: string,
  ): Promise<{ structure: ReturnType<typeof protocolStructureSchema.parse>; version: number }> {
    return pickVersion(await this.loadVersions(tx, protocolId), timezone, selectedDate);
  }

  /** Todas as versões do protocolo, da mais antiga à mais recente (uma consulta). */
  private loadVersions(tx: TenantTransaction, protocolId: string): Promise<ProtocolVersionRow[]> {
    return tx
      .select({
        version: protocolVersions.version,
        content: protocolVersions.content,
        createdAt: protocolVersions.createdAt,
      })
      .from(protocolVersions)
      .where(eq(protocolVersions.protocolId, protocolId))
      .orderBy(asc(protocolVersions.version));
  }

  private async ownerAndProtocol(userId: string) {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          name: users.name,
          biologicalSex: users.biologicalSex,
          timezone: users.timezone,
          protocolId: protocols.id,
          protocolVersion: protocols.version,
          startDate: protocols.startDate,
          firstStartDate: sql<
            string | null
          >`(select to_char(min(p.start_date) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from protocols p where p.user_id = ${users.id})`.mapWith(
            (value: string | null) => (value ? new Date(value) : null),
          ),
          totalWeeks: protocols.totalWeeks,
          content: protocols.content,
        })
        .from(users)
        .innerJoin(protocols, eq(protocols.userId, users.id))
        .innerJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(
          and(
            eq(users.id, userId),
            eq(protocols.status, 'ACTIVE'),
            inArray(subscriptions.status, ['ACTIVE', 'TRIALING']),
          ),
        )
        .orderBy(desc(protocols.createdAt))
        .limit(1),
    );
    if (!row) throw new NotFoundException('Nenhum protocolo ativo encontrado.');
    return row;
  }

  /**
   * Dados do card de um treino concluído (`undefined` enquanto não há o que mostrar).
   * Fonte única: o diário os devolve ao front e o PNG é desenhado a partir deles.
   */
  private async buildShareCard(
    userId: string,
    workout: typeof workoutSessions.$inferSelect,
    owner: { name: string | null; biologicalSex: 'MALE' | 'FEMALE' | null },
    sets: ReadonlyArray<{
      exerciseId: string;
      setNumber: number;
      completed: boolean;
      skipped: boolean;
    }>,
  ): Promise<WorkoutShareCardData | undefined> {
    const finishedAt = workout.finishedAt;
    // O card mostra o tempo de treino: sem cronômetro (registro tardio) não há o que mostrar.
    if (workout.loggedLate) return undefined;
    if (workout.status !== 'COMPLETED' || !finishedAt || !owner.biologicalSex) return undefined;
    const completedIds = workout.prescription.exercises
      .filter((exercise) =>
        sets.some(
          (entry) =>
            entry.exerciseId === exercise.exerciseId &&
            entry.setNumber > 0 &&
            entry.completed &&
            !entry.skipped,
        ),
      )
      .map((exercise) => exercise.exerciseId);
    // O catálogo é versionado: uma edição posterior não muda os músculos de um
    // treino passado. IDs vêm da prescrição salva, nunca do protocolo atual.
    const catalog = completedIds.length
      ? await this.db.runAsUser(userId, 'USER', (tx) =>
          tx
            .selectDistinctOn([exerciseCatalogEntries.exerciseKey], {
              id: exerciseCatalogEntries.exerciseKey,
              muscleGroups: exerciseCatalogEntries.muscleGroups,
            })
            .from(exerciseCatalogEntries)
            .where(
              and(
                inArray(exerciseCatalogEntries.exerciseKey, completedIds),
                lte(exerciseCatalogEntries.createdAt, finishedAt),
              ),
            )
            .orderBy(exerciseCatalogEntries.exerciseKey, desc(exerciseCatalogEntries.version)),
        )
      : [];
    const byId = new Map(catalog.map((entry) => [entry.id, entry.muscleGroups]));
    const muscles = completedIds.flatMap(
      (id) => byId.get(id) ?? EXERCISE_BY_ID.get(id)?.muscleGroups ?? [],
    );
    return {
      user: {
        name: owner.name?.trim().split(/\s+/)[0] || 'atleta',
        gender: owner.biologicalSex === 'FEMALE' ? 'female' : 'male',
      },
      workout: {
        name: workout.prescription.dayLabel,
        durationSeconds: workout.durationSeconds ?? 0,
        completedAt: finishedAt.toISOString(),
        ...mapWorkoutMuscles(muscles),
      },
    };
  }

  /**
   * PNG do card de Story. O desenho é feito aqui (e cacheado por conteúdo), nunca no
   * aparelho do aluno: `finish` já o pré-aquece, então o `GET` costuma ser um cache hit.
   */
  async shareCardImage(userId: string, id: string): Promise<ShareCardImage> {
    const workout = await this.ownedSession(userId, id);
    if (!workout) throw new NotFoundException();
    const { owner, sets } = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({ name: users.name, biologicalSex: users.biologicalSex })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const entries = await tx
        .select({
          exerciseId: workoutSetEntries.exerciseId,
          setNumber: workoutSetEntries.setNumber,
          completed: workoutSetEntries.completed,
          skipped: workoutSetEntries.skipped,
        })
        .from(workoutSetEntries)
        .where(eq(workoutSetEntries.workoutSessionId, id));
      return { owner: row, sets: entries };
    });
    const data = owner && (await this.buildShareCard(userId, workout, owner, sets));
    if (!data) throw new NotFoundException('O card deste treino ainda não está disponível.');
    return this.shareCards.render({
      gender: data.user.gender,
      groups: data.workout.muscleGroupsForHighlighter,
      durationSeconds: data.workout.durationSeconds,
    });
  }

  private async ownedSession(userId: string, id: string, lockedTx?: TenantTransaction) {
    const query = (tx: TenantTransaction) =>
      tx
        .select()
        .from(workoutSessions)
        .where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)))
        .limit(1);
    const [row] = lockedTx
      ? await query(lockedTx).for('update')
      : await this.db.runAsUser(userId, 'USER', query);
    return row;
  }

  private async evaluateDuration(userId: string, completedDate: string): Promise<void> {
    const start = addDays(completedDate, -6);
    const data = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const durations = await tx
        .select({ duration: workoutSessions.durationSeconds })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.status, 'COMPLETED'),
            gte(workoutSessions.scheduledDate, start),
            lte(workoutSessions.scheduledDate, completedDate),
          ),
        );
      const [anamnesis] = await tx
        .select({ data: anamnesisSessions.dataBlock3 })
        .from(anamnesisSessions)
        .where(eq(anamnesisSessions.userId, userId))
        .orderBy(desc(anamnesisSessions.createdAt))
        .limit(1);
      return { durations, anamnesis };
    });
    const parsed = anamnesisStructuredSchema.safeParse(data.anamnesis?.data);
    const values = data.durations.flatMap((row) => (row.duration ? [row.duration] : []));
    if (!parsed.success || values.length < 2) return;
    const expected = DURATION_CEILING[parsed.data.sessionDuration];
    if (!expected) return;
    const observed = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 60);
    if (observed <= Math.max(expected + 10, Math.round(expected * 1.15))) return;
    const windowStartedAt = weekStart(completedDate);
    const [insight] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(workoutInsights)
        .values({
          userId,
          kind: 'DURATION_OVER_PREFERENCE',
          windowStartedAt,
          observedValue: observed,
          expectedValue: expected,
        })
        .onConflictDoNothing()
        .returning({ id: workoutInsights.id }),
    );
    if (!insight) return;
    const outbound: WhatsappOutboundJob = {
      userId,
      type: 'WORKOUT_INSIGHT',
      dedupeId: insight.id,
      text: durationInsightMessage(observed, expected),
      buttons: durationInsightButtons(insight.id),
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-duration-insight', outbound, {
      jobId: `wa-workout-insight-${insight.id}`,
    });
  }
}
