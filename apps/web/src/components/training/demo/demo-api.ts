/**
 * API do diário em memória, para a página de demonstração local: começa, salva, fecha e monta o
 * cartão como o servidor faria, mas tudo some ao trocar de cenário. Só o desenho do PNG vai ao
 * servidor (rota de prévia, desligada fora do ambiente local).
 */
import {
  shareCardDataOf,
  shareCardLayoutsFor,
  type ExecutionView,
  type ScheduledSessionStatus,
  type TrainingDay,
  type TrainingDaySession,
} from '@movivo/shared';

import { previewShareCardImage, TrainingApiError } from '@/lib/training-api';

import type { TrainingApi } from '../training-api-context';
import {
  DEMO_MUSCLES,
  DEMO_WEEK_TEMPLATE,
  HYROX_METRICS,
  RUN_METRICS,
  strengthSets,
  type DemoScenario,
  type DemoSessionSeed,
} from './demo-scenarios';

export type DemoBody = 'MALE' | 'FEMALE' | null;

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Hoje no fuso de quem abre a página. */
export function localToday(now = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function mondayOf(date: string): string {
  const day = weekdayOf(date);
  return addDays(date, day === 0 ? -6 : 1 - day);
}

const uuid = () => crypto.randomUUID();
const wait = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

/** Quantas semanas para trás as setas alcançam na demonstração. */
export const DEMO_HISTORY_DAYS = 21;

/** A parte do treino da API (alimentação e evolução vêm de `demo-student-data`). */
export type DemoTrainingApi = Pick<
  TrainingApi,
  | 'getTrainingDay'
  | 'startSession'
  | 'saveSets'
  | 'saveMetrics'
  | 'uploadActivityFile'
  | 'uploadScreenshot'
  | 'finishExecution'
  | 'logExternal'
  | 'saveCheckIn'
  | 'getShareCard'
  | 'getShareCardImage'
>;

export function createDemoApi(
  scenario: DemoScenario,
  options: { body: DemoBody; today?: string } = { body: 'MALE' },
): DemoTrainingApi {
  let checkedInToday = !scenario.pendingCheckIn;
  const today = options.today ?? localToday();
  // O plano começa numa segunda: a semana mais antiga abre cheia, sem dias vazios antes.
  const firstScheduledOn = scenario.noPlan ? null : mondayOf(addDays(today, -DEMO_HISTORY_DAYS));
  const byDate = new Map<string, TrainingDaySession[]>();

  const sessionOf = (seed: DemoSessionSeed, on: string, status: ScheduledSessionStatus) => {
    const executionId = uuid();
    const session: TrainingDaySession = {
      scheduledSessionId: uuid(),
      planSessionKey: seed.key,
      title: seed.title,
      purpose: seed.purpose,
      modality: seed.modality,
      priority: seed.priority,
      estimatedMinutes: seed.estimatedMinutes,
      estimatedRpe: 6,
      scheduledOn: on,
      slot: 'ANY',
      status: seed.status ?? status,
      content: seed.content,
      execution: seed.execution ? seed.execution(executionId) : null,
    };
    return session;
  };

  /** Um treino passado já fechado, para o histórico ter cartão também. */
  const pastSession = (seed: DemoSessionSeed, on: string, missed: boolean) => {
    const session = sessionOf(seed, on, missed ? 'MISSED' : 'DONE');
    if (missed) return session;
    const base = {
      id: uuid(),
      source: 'LINK' as const,
      metrics: null,
      metricsConfirmed: false,
      rpe: 7,
      durationMinutes: seed.estimatedMinutes,
      enjoyment: null,
      startedAt: `${on}T07:00:00.000Z`,
      feedback: null,
    };
    session.execution = {
      ...base,
      status: 'COMPLETED',
      sets: strengthSets(seed.content),
      ...(seed.modality === 'RUNNING' ? { metrics: RUN_METRICS, metricsConfirmed: true } : {}),
      ...(seed.modality === 'HYROX' ? { metrics: HYROX_METRICS, metricsConfirmed: true } : {}),
    };
    return session;
  };

  if (!scenario.noPlan && firstScheduledOn) {
    const sunday = addDays(mondayOf(today), 6);
    for (let on = firstScheduledOn; on <= sunday; on = addDays(on, 1)) {
      if (on === today) continue;
      const seeds = DEMO_WEEK_TEMPLATE[weekdayOf(on)] ?? [];
      if (seeds.length === 0) continue;
      // Um treino perdido no histórico, para a semana passada mostrar os dois estados.
      const missed = on < today && weekdayOf(on) === 4 && on < addDays(today, -7);
      byDate.set(
        on,
        seeds.map((seed) =>
          on < today ? pastSession(seed, on, missed) : sessionOf(seed, on, 'PLANNED'),
        ),
      );
    }
    byDate.set(
      today,
      scenario.today.map((seed) => sessionOf(seed, today, 'PLANNED')),
    );
  }

  const all = () => [...byDate.values()].flat();
  const sessionById = (id: string) => {
    const found = all().find((s) => s.scheduledSessionId === id);
    if (!found) throw new TrainingApiError(404, 'Treino não encontrado.');
    return found;
  };
  const sessionByExecution = (executionId: string) => {
    const found = all().find((s) => s.execution?.id === executionId);
    if (!found?.execution) throw new TrainingApiError(404, 'Registro não encontrado.');
    return found as TrainingDaySession & { execution: ExecutionView };
  };
  const update = (executionId: string, change: Partial<ExecutionView>) => {
    const session = sessionByExecution(executionId);
    session.execution = { ...session.execution, ...change };
    return structuredClone(session.execution);
  };

  const shareCardData = (executionId: string) => {
    const session = sessionByExecution(executionId);
    const { execution } = session;
    if (execution.status !== 'COMPLETED' && execution.status !== 'PARTIAL') {
      throw new TrainingApiError(409, 'O cartão sai depois de fechar o treino.');
    }
    return shareCardDataOf({
      modality: session.modality,
      title: session.title,
      content: session.content,
      rpe: execution.rpe,
      durationMinutes: execution.durationMinutes,
      sets: execution.sets,
      metrics: execution.metricsConfirmed ? execution.metrics : null,
      biologicalSex: options.body,
      muscleGroupsOf: (id) => [...(DEMO_MUSCLES[id] ?? [])],
    });
  };

  return {
    async getTrainingDay(date?: string): Promise<TrainingDay> {
      await wait(120);
      const target = date ?? today;
      const monday = mondayOf(target);
      const week = Array.from({ length: 7 }, (_, i) => {
        const on = addDays(monday, i);
        return {
          date: on,
          sessions: (byDate.get(on) ?? []).map((s) => ({
            scheduledSessionId: s.scheduledSessionId,
            title: s.title,
            modality: s.modality,
            status: s.status,
          })),
        };
      });
      return structuredClone({
        firstName: 'Rodrigo',
        today,
        date: target,
        week,
        selected: byDate.get(target) ?? [],
        hasPlan: !scenario.noPlan,
        firstScheduledOn,
        checkedInToday,
      });
    },

    async startSession(scheduledSessionId) {
      await wait();
      const session = sessionById(scheduledSessionId);
      session.execution ??= {
        id: uuid(),
        status: 'IN_PROGRESS',
        source: 'LINK',
        sets: [],
        metrics: null,
        metricsConfirmed: false,
        rpe: null,
        durationMinutes: null,
        enjoyment: null,
        startedAt: new Date().toISOString(),
        feedback: null,
      };
      return structuredClone(session.execution);
    },

    async saveSets(executionId, body) {
      await wait(80);
      const current = sessionByExecution(executionId).execution.sets;
      const key = (s: { exerciseId: string; setNumber: number }) =>
        `${s.exerciseId}#${s.setNumber}`;
      const merged = new Map(current.map((s) => [key(s), s]));
      for (const set of body.sets) merged.set(key(set), set);
      return update(executionId, { sets: [...merged.values()] });
    },

    async saveMetrics(executionId, body) {
      await wait();
      return update(executionId, { metrics: body.metrics, metricsConfirmed: body.confirmed });
    },

    async uploadActivityFile(executionId) {
      await wait(600);
      const { modality } = sessionByExecution(executionId);
      return update(executionId, {
        source: 'FIT_FILE',
        metrics: modality === 'HYROX' ? HYROX_METRICS : RUN_METRICS,
        metricsConfirmed: false,
      });
    },

    async uploadScreenshot(executionId) {
      await wait(900);
      const { modality } = sessionByExecution(executionId);
      return update(executionId, {
        source: 'WHATSAPP_SCREENSHOT',
        metrics: modality === 'HYROX' ? HYROX_METRICS : RUN_METRICS,
        metricsConfirmed: false,
      });
    },

    async finishExecution(executionId, body) {
      await wait();
      const session = sessionByExecution(executionId);
      session.status =
        body.status === 'COMPLETED' ? 'DONE' : body.status === 'PARTIAL' ? 'PARTIAL' : 'SKIPPED';
      return update(executionId, {
        status: body.status,
        rpe: body.rpe,
        durationMinutes: body.durationMinutes,
        enjoyment: body.enjoyment,
        feedback: body.feedback ?? null,
      });
    },

    async logExternal(body) {
      await wait();
      const session = body.scheduledSessionId ? sessionById(body.scheduledSessionId) : null;
      const execution: ExecutionView = {
        id: uuid(),
        status: 'COMPLETED',
        source: 'LINK',
        sets: [],
        metrics: body.metrics ?? null,
        metricsConfirmed: Boolean(body.metrics),
        rpe: body.rpe,
        durationMinutes: body.durationMinutes,
        enjoyment: null,
        startedAt: new Date().toISOString(),
        feedback: null,
      };
      if (session) {
        session.execution = execution;
        session.status = 'DONE';
      }
      return structuredClone(execution);
    },

    async saveCheckIn() {
      await wait();
      checkedInToday = true;
    },

    async getShareCard(executionId) {
      await wait(80);
      const data = shareCardData(executionId);
      return { layouts: shareCardLayoutsFor(data), data };
    },

    async getShareCardImage(executionId, layout, signal) {
      return previewShareCardImage(shareCardData(executionId), layout, signal);
    },
  };
}
