/**
 * Atualização de registros pelo WhatsApp: o aluno diz, com clareza, que um dado dele está errado
 * ou mudou ("marquei errado a última série do supino, foram 40 kg", "não gosto de peixe", "meu
 * peso é 82") e a MOVIVO corrige o registro.
 *
 *   retrato dos registros editáveis (código) → agente propõe operações → validadores conferem
 *   alvo e valores → o código grava e responde em texto fixo, mostrando o antes e o depois.
 *
 * O agente nunca grava nada: ele só aponta para registros que o código mostrou. Gostos e
 * restrições alimentares passam pelo motor de políticas (viram contexto do aluno e valem para as
 * próximas sugestões e planos); séries, check-in, peso e cadastro são correções do próprio
 * registro do aluno. Dado de saúde nunca é alterado aqui.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { sessionLoad, type CoachingProposal, type StudentPreference } from '@movivo/shared';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  bodyMeasurements,
  dailyCheckIns,
  executionSets,
  planSessions,
  sessionExecutions,
  studentPreferences,
  studentProfiles,
  trainingPlans,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { fold } from '../planning/tasks/common';
import { StudentStateReader } from '../student-state/student-state.reader';
import { saveDailyCheckIn } from '../training/daily-check-in';
import { DomainCommands } from './domain-commands.service';
import {
  recordUpdateTask,
  type RecordOperation,
  type RecordUpdateInput,
} from './record-update-task';

const WORKOUT_WINDOW_DAYS = 14;
const MAX_WORKOUTS = 8;

export interface RecordUpdateResult {
  status: 'EXECUTED' | 'ASKED' | 'INFORMED';
  reply: string;
  /** O que o aluno pediu e o chat não altera: quem chama passa para a equipe. */
  unsupported: string | null;
}

export const RECORD_UPDATE_UNCLEAR_MESSAGE =
  'Quero corrigir isso para você, mas não consegui identificar exatamente o quê. Me diga qual registro (o treino e o exercício, o check-in ou o dado do cadastro) e o valor certo, em números.';

export function unsupportedMessage(what: string): string {
  return `Sobre ${what}: isso eu não consigo alterar direto por aqui. Já passei o seu pedido para a equipe da MOVIVO, que ajusta e te avisa.`;
}

const num = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** "30 kg × 10" (o que estiver registrado). */
export function setLabel(set: { reps: number | null; loadKg: number | null }): string {
  const load = set.loadKg !== null ? `${num(set.loadKg)} kg` : null;
  const reps = set.reps !== null ? `${num(set.reps)} repetições` : null;
  return [load, reps].filter(Boolean).join(' × ') || 'sem registro';
}

const CHECKIN_LABELS = {
  energy: 'disposição',
  sleep: 'sono',
  soreness: 'corpo',
  mood: 'ânimo',
  stress: 'estresse',
} as const;
const NUTRITION_LABELS = { ON_TRACK: 'dentro do plano', PARTIAL: 'em parte', OFF: 'fora do plano' };
const RESTRICTION_LABELS: Record<string, string> = {
  VEGETARIAN: 'alimentação vegetariana',
  VEGAN: 'alimentação vegana',
  LACTOSE_FREE: 'sem lactose',
  GLUTEN_FREE: 'sem glúten',
  HALAL: 'halal',
  KOSHER: 'kosher',
  OTHER: 'restrição alimentar',
};
const COOKING_LABELS = { NONE: 'não cozinha', BASIC: 'cozinha o básico', GOOD: 'cozinha bem' };

/** Chave estável da preferência de comida: `food:peixe`, `food:pao_integral`. */
export function foodPreferenceKey(food: string): string {
  const slug = fold(food)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `food:${slug}`;
}

const proposal = (action: CoachingProposal['action'], rationale: string): CoachingProposal => ({
  action,
  rationale: [rationale],
  evidence: [],
  assumptions: [],
  uncertainty: 'LOW',
  expectedOutcome: 'O registro do aluno reflete o que ele informou.',
});

interface Snapshot {
  input: Omit<RecordUpdateInput, 'message'>;
  executionIds: Map<string, string>;
  weightIds: Map<string, string>;
}

@Injectable()
export class RecordUpdateService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly executor: DecisionExecutor,
    private readonly commands: DomainCommands,
    private readonly catalog: ExerciseCatalogProvider,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RecordUpdateService.name);
  }

  async handle(userId: string, text: string, now: Date = new Date()): Promise<RecordUpdateResult> {
    const snapshot = await this.snapshot(userId, now);
    let output;
    try {
      output = (
        await this.runner.run(
          recordUpdateTask,
          { message: text, ...snapshot.input },
          {
            userId,
            sources: {
              methodology: (domains) => this.methodology.render(domains),
              state: (slices) => this.state.read(userId, slices, now),
            },
          },
        )
      ).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'pedido de atualização sem saída válida');
      return { status: 'ASKED', reply: RECORD_UPDATE_UNCLEAR_MESSAGE, unsupported: null };
    }

    const lines: string[] = [];
    let contextChanged = false;
    for (const operation of output.operations) {
      const line = await this.apply(userId, operation, snapshot);
      if (!line) continue;
      lines.push(line);
      if (operation.type === 'FOOD_PREFERENCE' || operation.type === 'DIETARY_RESTRICTION') {
        contextChanged = true;
      }
    }
    this.logger.info(
      {
        userId,
        event: 'records_updated_by_chat',
        operations: output.operations.map((o) => o.type),
        applied: lines.length,
      },
      'registros atualizados a pedido do aluno',
    );

    const blocks: string[] = [];
    if (lines.length > 0) {
      blocks.push(`Pronto, atualizei:\n${lines.map((line) => `- ${line}`).join('\n')}`);
      if (contextChanged) {
        blocks.push(
          'Isso já vale para as próximas sugestões e para o seu próximo plano alimentar. Se quiser trocar algo do cardápio atual, é só me pedir.',
        );
      }
    }
    if (output.clarification) blocks.push(output.clarification);
    if (output.unsupported) blocks.push(unsupportedMessage(output.unsupported));
    if (blocks.length === 0) blocks.push(RECORD_UPDATE_UNCLEAR_MESSAGE);
    return {
      status: lines.length > 0 ? 'EXECUTED' : output.unsupported ? 'INFORMED' : 'ASKED',
      reply: blocks.join('\n---\n'),
      unsupported: output.unsupported,
    };
  }

  // --- Retrato do que pode ser alterado ----------------------------------------------------

  private async snapshot(userId: string, now: Date): Promise<Snapshot> {
    const identity = (await this.state.read(userId, ['identity'], now)).slices.identity as
      { timezone?: string | null } | undefined;
    const today = todayIn(identity?.timezone ?? null, now);
    const since = addDays(today, -WORKOUT_WINDOW_DAYS);
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const executions = await tx
        .select({
          id: sessionExecutions.id,
          date: sessionExecutions.performedOn,
          modality: sessionExecutions.modality,
          rpe: sessionExecutions.rpe,
          durationMinutes: sessionExecutions.durationMinutes,
          title: planSessions.title,
        })
        .from(sessionExecutions)
        .leftJoin(planSessions, eq(planSessions.id, sessionExecutions.planSessionId))
        .where(and(eq(sessionExecutions.userId, userId), gte(sessionExecutions.performedOn, since)))
        .orderBy(desc(sessionExecutions.performedOn), desc(sessionExecutions.createdAt))
        .limit(MAX_WORKOUTS);
      const sets =
        executions.length > 0
          ? await tx
              .select()
              .from(executionSets)
              .where(
                and(
                  eq(executionSets.userId, userId),
                  inArray(
                    executionSets.executionId,
                    executions.map((e) => e.id),
                  ),
                ),
              )
          : [];
      const nameOf = (exerciseId: string) => this.catalog.getById(exerciseId)?.name ?? exerciseId;
      const executionIds = new Map<string, string>();
      const workouts = executions.map((execution, index) => {
        const ref = `T${index + 1}`;
        executionIds.set(ref, execution.id);
        const byExercise = new Map<string, typeof sets>();
        for (const row of sets.filter((s) => s.executionId === execution.id && s.setNumber >= 1)) {
          byExercise.set(row.exerciseId, [...(byExercise.get(row.exerciseId) ?? []), row]);
        }
        return {
          ref,
          date: execution.date,
          title: execution.title,
          modality: execution.modality,
          rpe: execution.rpe,
          durationMinutes: execution.durationMinutes,
          exercises: [...byExercise.entries()].slice(0, 24).map(([exerciseId, rows]) => ({
            exerciseId,
            name: nameOf(exerciseId),
            sets: rows
              .sort((a, b) => a.setNumber - b.setNumber)
              .slice(0, 24)
              .map((row) => ({
                setNumber: row.setNumber,
                reps: row.reps,
                loadKg: row.loadKg,
                rir: row.rir,
              })),
          })),
        };
      });

      const checkIns = await tx
        .select()
        .from(dailyCheckIns)
        .where(and(eq(dailyCheckIns.userId, userId), gte(dailyCheckIns.onDate, addDays(today, -7))))
        .orderBy(desc(dailyCheckIns.onDate))
        .limit(10);

      const weightRows = await tx
        .select({
          id: bodyMeasurements.id,
          date: bodyMeasurements.measuredOn,
          kg: bodyMeasurements.value,
        })
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, 'WEIGHT')))
        .orderBy(desc(bodyMeasurements.measuredOn), desc(bodyMeasurements.createdAt))
        .limit(4);
      const weightIds = new Map<string, string>();
      const weights = weightRows.map((row, index) => {
        const ref = `P${index + 1}`;
        weightIds.set(ref, row.id);
        return { ref, date: row.date, kg: row.kg };
      });

      const [profileRow] = await tx
        .select({ profile: studentProfiles.profile })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, userId));
      const life = profileRow?.profile.lifeContext;

      const preferences = await tx
        .select({ key: studentPreferences.key, value: studentPreferences.value })
        .from(studentPreferences)
        .where(
          and(
            eq(studentPreferences.userId, userId),
            eq(studentPreferences.domain, 'FOOD'),
            isNull(studentPreferences.supersededAt),
          ),
        );

      const planExercises = await tx
        .select({ content: planSessions.content })
        .from(planSessions)
        .innerJoin(trainingPlans, eq(trainingPlans.id, planSessions.planId))
        .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
      const known = new Map<string, string>();
      for (const row of planExercises) {
        if (row.content.modality !== 'STRENGTH') continue;
        for (const exercise of row.content.exercises) known.set(exercise.exerciseId, exercise.name);
      }
      for (const workout of workouts) {
        for (const exercise of workout.exercises) {
          if (!known.has(exercise.exerciseId)) known.set(exercise.exerciseId, exercise.name);
        }
      }

      return {
        executionIds,
        weightIds,
        input: {
          today,
          workouts,
          dailyCheckIns: checkIns.map((row) => ({
            date: row.onDate,
            energy: row.energy,
            sleep: row.sleep,
            soreness: row.soreness,
            mood: row.mood,
            stress: row.stress,
            nutrition: row.nutrition,
          })),
          weights,
          profile: profileRow
            ? {
                heightCm: profileRow.profile.heightCm,
                cookingCapacity: life?.cookingCapacity ?? null,
                mealsOutsideHomePerWeek: life?.mealsOutsideHomePerWeek ?? null,
                foodBudgetMonthlyBrl: life?.foodBudgetMonthlyBrl ?? null,
              }
            : null,
          foodPreferences: preferences
            .filter((p) => p.value === 'LIKES' || p.value === 'DISLIKES')
            .slice(0, 40)
            .map((p) => ({
              food: p.key.replace(/^food:/, '').replaceAll('_', ' '),
              value: p.value as 'LIKES' | 'DISLIKES',
            })),
          knownExercises: [...known.entries()]
            .slice(0, 120)
            .map(([exerciseId, name]) => ({ exerciseId, name })),
        },
      };
    });
  }

  // --- Gravação ----------------------------------------------------------------------------

  /** Aplica uma operação já validada e devolve a linha da resposta (`null` = nada mudou). */
  private async apply(
    userId: string,
    operation: RecordOperation,
    snapshot: Snapshot,
  ): Promise<string | null> {
    const { input } = snapshot;
    switch (operation.type) {
      case 'WORKOUT_SET': {
        const executionId = snapshot.executionIds.get(operation.workoutRef);
        const workout = input.workouts.find((w) => w.ref === operation.workoutRef);
        const exercise = workout?.exercises.find((e) => e.exerciseId === operation.exerciseId);
        if (!executionId || !workout || !exercise) return null;
        const before = exercise.sets.find((s) => s.setNumber === operation.setNumber) ?? null;
        const after = {
          reps: operation.reps ?? before?.reps ?? null,
          loadKg: operation.loadKg ?? before?.loadKg ?? null,
          rir: operation.rir ?? before?.rir ?? null,
        };
        await this.db.runAsUser(userId, 'USER', (tx) =>
          tx
            .insert(executionSets)
            .values({
              userId,
              executionId,
              exerciseId: operation.exerciseId,
              setNumber: operation.setNumber,
              ...after,
              completed: true,
            })
            .onConflictDoUpdate({
              target: [
                executionSets.executionId,
                executionSets.exerciseId,
                executionSets.setNumber,
              ],
              set: { ...after, updatedAt: new Date() },
            }),
        );
        const where = `${exercise.name}, série ${operation.setNumber} do treino de ${ddmm(workout.date)}`;
        return before
          ? `${where}: de ${setLabel(before)} para ${setLabel(after)}`
          : `${where}: registrei ${setLabel(after)}`;
      }
      case 'WORKOUT_SUMMARY': {
        const executionId = snapshot.executionIds.get(operation.workoutRef);
        const workout = input.workouts.find((w) => w.ref === operation.workoutRef);
        if (!executionId || !workout) return null;
        const rpe = operation.rpe ?? workout.rpe;
        const durationMinutes = operation.durationMinutes ?? workout.durationMinutes;
        await this.db.runAsUser(userId, 'USER', (tx) =>
          tx
            .update(sessionExecutions)
            .set({
              rpe,
              durationMinutes,
              // A carga interna (esforço × minutos) acompanha a correção.
              ...(rpe !== null && durationMinutes !== null
                ? { load: sessionLoad(rpe, durationMinutes) }
                : {}),
            })
            .where(
              and(eq(sessionExecutions.id, executionId), eq(sessionExecutions.userId, userId)),
            ),
        );
        const parts = [
          operation.rpe !== null && operation.rpe !== undefined
            ? `esforço ${workout.rpe !== null ? `de ${num(workout.rpe)} para ` : ''}${num(operation.rpe)}`
            : null,
          operation.durationMinutes !== null && operation.durationMinutes !== undefined
            ? `duração ${workout.durationMinutes !== null ? `de ${workout.durationMinutes} para ` : ''}${operation.durationMinutes} min`
            : null,
        ].filter(Boolean);
        return `Treino de ${ddmm(workout.date)}: ${parts.join(' e ')}`;
      }
      case 'DAILY_CHECKIN': {
        const { type: _type, date, ...answers } = operation;
        await this.db.runAsUser(userId, 'USER', (tx) =>
          saveDailyCheckIn(tx, userId, date, answers, 'DAILY'),
        );
        const parts = (Object.keys(CHECKIN_LABELS) as (keyof typeof CHECKIN_LABELS)[])
          .filter((key) => typeof answers[key] === 'number')
          .map((key) => `${CHECKIN_LABELS[key]} ${answers[key]}`);
        if (answers.nutrition) parts.push(`alimentação ${NUTRITION_LABELS[answers.nutrition]}`);
        return `Check-in de ${ddmm(date)}: ${parts.join(', ')}`;
      }
      case 'WEIGHT': {
        const id = operation.weightRef ? snapshot.weightIds.get(operation.weightRef) : undefined;
        const before = input.weights.find((w) => w.ref === operation.weightRef);
        if (id && before) {
          await this.db.runAsUser(userId, 'USER', (tx) =>
            tx
              .update(bodyMeasurements)
              .set({ value: operation.kg })
              .where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, userId))),
          );
          return `Peso de ${ddmm(before.date)}: de ${num(before.kg)} kg para ${num(operation.kg)} kg`;
        }
        await this.db.runAsUser(userId, 'USER', (tx) =>
          tx.insert(bodyMeasurements).values({
            userId,
            kind: 'WEIGHT',
            value: operation.kg,
            method: 'SCALE',
            measuredOn: input.today,
          }),
        );
        return `Peso de hoje: ${num(operation.kg)} kg`;
      }
      case 'FOOD_PREFERENCE': {
        const recorded = await this.recordPreference(userId, {
          domain: 'FOOD',
          key: foodPreferenceKey(operation.food),
          value: operation.value,
          strength: 'STRONG',
          origin: 'DECLARED',
          confidence: 95,
        });
        if (!recorded) return null;
        return operation.value === 'DISLIKES'
          ? `Anotei que você não gosta de ${operation.food}`
          : `Anotei que você gosta de ${operation.food}`;
      }
      case 'EXERCISE_PREFERENCE': {
        const name = input.knownExercises.find((e) => e.exerciseId === operation.exerciseId)?.name;
        const recorded = await this.recordPreference(userId, {
          domain: 'EXERCISE',
          key: `exercise:${operation.exerciseId}`,
          value: operation.value,
          strength: 'STRONG',
          origin: 'DECLARED',
          confidence: 95,
        });
        if (!recorded || !name) return null;
        return operation.value === 'DISLIKES'
          ? `Anotei que você não gosta de ${name}`
          : `Anotei que você gosta de ${name}`;
      }
      case 'DIETARY_RESTRICTION': {
        const action = {
          type: 'RECORD_CONSTRAINT' as const,
          constraint: {
            kind: 'DIETARY_RESTRICTION' as const,
            restriction: operation.restriction,
            ...(operation.description ? { description: operation.description } : {}),
          },
        };
        const outcome = await this.executor.decideAndRun(
          userId,
          recordUpdateTask.id,
          proposal(action, 'O aluno informou uma restrição alimentar pelo WhatsApp.'),
          (tx) => this.commands.recordConstraint(tx, userId, action, input.today),
        );
        if (outcome.verdict !== 'EXECUTE') return null;
        const label = RESTRICTION_LABELS[operation.restriction] ?? 'restrição alimentar';
        return `Registrei a sua restrição: ${operation.description ?? label}`;
      }
      case 'PROFILE': {
        const changed = await this.db.runAsUser(userId, 'USER', async (tx) => {
          const [row] = await tx
            .select()
            .from(studentProfiles)
            .where(eq(studentProfiles.userId, userId))
            .for('update');
          if (!row) return null;
          const profile = {
            ...row.profile,
            ...(operation.heightCm ? { heightCm: operation.heightCm } : {}),
            lifeContext: {
              ...row.profile.lifeContext,
              ...(operation.cookingCapacity ? { cookingCapacity: operation.cookingCapacity } : {}),
              ...(typeof operation.mealsOutsideHomePerWeek === 'number'
                ? { mealsOutsideHomePerWeek: operation.mealsOutsideHomePerWeek }
                : {}),
              ...(typeof operation.foodBudgetMonthlyBrl === 'number'
                ? { foodBudgetMonthlyBrl: operation.foodBudgetMonthlyBrl }
                : {}),
            },
          };
          await tx
            .update(studentProfiles)
            .set({ profile, version: row.version + 1 })
            .where(eq(studentProfiles.id, row.id));
          return row.profile;
        });
        if (!changed) return null;
        const parts = [
          operation.heightCm ? `altura ${operation.heightCm} cm` : null,
          operation.cookingCapacity ? COOKING_LABELS[operation.cookingCapacity] : null,
          typeof operation.mealsOutsideHomePerWeek === 'number'
            ? `${operation.mealsOutsideHomePerWeek} refeições fora de casa por semana`
            : null,
          typeof operation.foodBudgetMonthlyBrl === 'number'
            ? `orçamento de alimentação de R$ ${num(operation.foodBudgetMonthlyBrl)} por mês`
            : null,
        ].filter(Boolean);
        return `Seu cadastro: ${parts.join(', ')}`;
      }
    }
  }

  /** Preferência declarada pelo aluno: passa pelo motor de políticas e substitui a anterior. */
  private async recordPreference(userId: string, preference: StudentPreference): Promise<boolean> {
    const outcome = await this.executor.decideAndRun(
      userId,
      recordUpdateTask.id,
      proposal(
        { type: 'RECORD_PREFERENCE', preference },
        'O aluno declarou esta preferência pelo WhatsApp.',
      ),
      (tx) => this.commands.recordPreference(tx, userId, preference, ['whatsapp']),
    );
    return outcome.verdict === 'EXECUTE';
  }
}
