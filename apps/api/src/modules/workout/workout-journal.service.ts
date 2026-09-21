import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  anamnesisStructuredSchema,
  mapWorkoutMuscles,
  protocolStructureSchema,
  type FinishWorkoutInput,
  type ProtocolSession,
  type WorkoutJournal,
  type WorkoutPreferencesInput,
  type WorkoutSetInput,
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
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { EXERCISE_BY_ID } from '../protocol/exercise-catalog';
import { WorkoutCompletionService } from './workout-completion.service';
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
const DURATION_CEILING: Readonly<Record<string, number>> = {
  LT_30: 30,
  M30_TO_45: 45,
  M45_TO_60: 60,
  M60_TO_90: 90,
  GT_90: 90,
};

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
) {
  const day = dateAtNoon(date).getUTCDay();
  const explicit = structure.sessions.find((session) => session.weekday === WEEKDAY[day]);
  if (explicit) return explicit;
  const fallbackDays: Readonly<Record<number, readonly number[]>> = {
    1: [3],
    2: [2, 5],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  const position = (fallbackDays[structure.weeklyFrequency] ?? []).indexOf(day);
  return position < 0 ? undefined : structure.sessions[position % structure.sessions.length];
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

@Injectable()
export class WorkoutJournalService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly completions: WorkoutCompletionService,
    private readonly queues: QueueManager,
    private readonly queueEvents: DashboardQueueEventsService,
  ) {}

  async journal(userId: string, requestedDate?: string, now = new Date()): Promise<WorkoutJournal> {
    const owner = await this.ownerAndProtocol(userId);
    const today = localDate(now, owner.timezone);
    const selectedDate = requestedDate ?? today;
    if (selectedDate > today) throw new BadRequestException('Nao e possivel abrir um dia futuro.');
    // Usada só pra classificar PLANNED/REST da semana exibida (achado abaixo não se aplica
    // aqui: o padrão de dias/frequência é metadado do protocolo, não algo que uma
    // substituição de exercício altera).
    const structure = protocolStructureSchema.parse(owner.content);
    const weekNumber = Math.max(
      1,
      Math.min(
        owner.totalWeeks,
        Math.floor((dateAtNoon(selectedDate).getTime() - owner.startDate.getTime()) / 604_800_000) +
          1,
      ),
    );

    const workout = await this.db.runAsUser(userId, 'USER', async (tx) => {
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
      const prescription = prescribedSession(selectedDate, historicalStructure);
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
      const planned = Boolean(prescribedSession(date, structure));
      const state =
        date > today
          ? 'FUTURE'
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
      const previousDate = addDays(selectedDate, -7);
      const entries = await this.db.runAsUser(userId, 'USER', async (tx) => {
        const current = await tx
          .select()
          .from(workoutSetEntries)
          .where(eq(workoutSetEntries.workoutSessionId, workout.id))
          .orderBy(asc(workoutSetEntries.exerciseId), asc(workoutSetEntries.setNumber));
        const [previousSession] = await tx
          .select({ id: workoutSessions.id })
          .from(workoutSessions)
          .where(
            and(
              eq(workoutSessions.userId, userId),
              eq(workoutSessions.scheduledDate, previousDate),
              eq(workoutSessions.sessionKey, workout.sessionKey),
              eq(workoutSessions.status, 'COMPLETED'),
            ),
          )
          .limit(1);
        const previous = previousSession
          ? await tx
              .select()
              .from(workoutSetEntries)
              .where(eq(workoutSetEntries.workoutSessionId, previousSession.id))
          : [];
        return { current, previous };
      });
      const currentByKey = new Map(
        entries.current.map((entry) => [`${entry.exerciseId}:${entry.setNumber}`, entry]),
      );
      const previousByKey = new Map(
        entries.previous.map((entry) => [`${entry.exerciseId}:${entry.setNumber}`, entry]),
      );
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
                date: previousDate,
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
      };
      const finishedAt = workout.finishedAt;
      if (workout.status === 'COMPLETED' && finishedAt && owner.biologicalSex) {
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
        workoutView.shareCard = {
          user: {
            name: owner.name?.trim().split(/\s+/)[0] || 'atleta',
            gender: owner.biologicalSex === 'FEMALE' ? 'female' : 'male',
          },
          workout: {
            name: workout.prescription.dayLabel,
            durationMinutes: (workout.durationSeconds ?? 0) / 60,
            completedAt: finishedAt.toISOString(),
            ...mapWorkoutMuscles(muscles),
          },
        };
      }
    }

    return {
      firstName: owner.name?.trim().split(/\s+/)[0] || 'atleta',
      today,
      selectedDate,
      week,
      workout: workoutView,
    };
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
    if (!row && !(await this.ownedSession(userId, id))) throw new NotFoundException();
  }

  async saveSets(userId: string, id: string, entries: WorkoutSetInput[]): Promise<void> {
    const workout = await this.ownedSession(userId, id);
    if (!workout) throw new NotFoundException();
    if (workout.status === 'COMPLETED') throw new BadRequestException('Treino ja finalizado.');
    const allowed = new Set(
      expectedSets(workout.prescription).map((entry) => `${entry.exerciseId}:${entry.setNumber}`),
    );
    if (entries.some((entry) => !allowed.has(`${entry.exerciseId}:${entry.setNumber}`))) {
      throw new BadRequestException('Serie nao pertence a prescricao deste treino.');
    }
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      for (const entry of entries) {
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
    const workout = await this.ownedSession(userId, id);
    if (!workout) throw new NotFoundException();
    if (!workout.startedAt) throw new BadRequestException('Inicie o treino antes de finalizar.');
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
    const durationSeconds = Math.min(
      43_200,
      Math.max(0, Math.round((now.getTime() - workout.startedAt.getTime()) / 1000)),
    );
    const feedbackCipher = await this.cipher.encryptHealth(
      JSON.stringify({ feelingNotes: input.feelingNotes, painNotes: input.painNotes }),
    );
    await this.db.runAsUser(userId, 'USER', async (tx) => {
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
          ...(input.reminderEnabled === undefined
            ? {}
            : { workoutReminderEnabled: input.reminderEnabled }),
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
    const versions = await tx
      .select({
        version: protocolVersions.version,
        content: protocolVersions.content,
        createdAt: protocolVersions.createdAt,
      })
      .from(protocolVersions)
      .where(eq(protocolVersions.protocolId, protocolId))
      .orderBy(asc(protocolVersions.version));
    let chosen = versions[0];
    for (const candidate of versions) {
      if (localDate(candidate.createdAt, timezone) > selectedDate) break;
      chosen = candidate;
    }
    if (!chosen) throw new NotFoundException('Nenhuma versao de protocolo encontrada.');
    return { structure: protocolStructureSchema.parse(chosen.content), version: chosen.version };
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

  private async ownedSession(userId: string, id: string) {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(workoutSessions)
        .where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)))
        .limit(1),
    );
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
