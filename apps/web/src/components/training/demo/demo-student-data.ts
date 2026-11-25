/**
 * Alimentação e evolução em memória, para a demonstração local: registrar refeição (texto ou foto),
 * conferir porções, apagar, e registrar medidas funcionam como no app, com dados de exemplo.
 */
import {
  studentProgressOf,
  type FoodDay,
  type FoodLogDraft,
  type FoodLogItem,
  type HyroxStation,
  type MealSlot,
  type MeasurementKind,
  type ProgressInput,
  type StudentProgress,
} from '@movivo/shared';

import type { EvolutionView } from '@/lib/checkin-api';

import type { TrainingApi } from '../training-api-context';
import { addDays, mondayOf } from './demo-api';

const uuid = () => crypto.randomUUID();
const wait = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

/** Valores por 100 g de alguns alimentos comuns (aproximados, só para a demonstração). */
const PER_100G: ReadonlyArray<{
  match: RegExp;
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  grams: number;
}> = [
  {
    match: /arroz/,
    name: 'Arroz branco cozido',
    kcal: 128,
    protein: 2.5,
    carbs: 28,
    fat: 0.2,
    fiber: 1.6,
    grams: 150,
  },
  {
    match: /feij/,
    name: 'Feijão carioca cozido',
    kcal: 76,
    protein: 4.8,
    carbs: 13.6,
    fat: 0.5,
    fiber: 8.5,
    grams: 100,
  },
  {
    match: /frango/,
    name: 'Peito de frango grelhado',
    kcal: 159,
    protein: 32,
    carbs: 0,
    fat: 2.5,
    fiber: 0,
    grams: 120,
  },
  {
    match: /salada|alface|tomate/,
    name: 'Salada de folhas e tomate',
    kcal: 15,
    protein: 1.1,
    carbs: 2.9,
    fat: 0.2,
    fiber: 1.9,
    grams: 80,
  },
  {
    match: /ovo/,
    name: 'Ovo cozido',
    kcal: 146,
    protein: 13.3,
    carbs: 0.6,
    fat: 9.5,
    fiber: 0,
    grams: 100,
  },
  {
    match: /p[ãa]o/,
    name: 'Pão integral',
    kcal: 253,
    protein: 9.4,
    carbs: 49.9,
    fat: 3.7,
    fiber: 6.9,
    grams: 50,
  },
  {
    match: /banana/,
    name: 'Banana prata',
    kcal: 98,
    protein: 1.3,
    carbs: 26,
    fat: 0.1,
    fiber: 2,
    grams: 90,
  },
  {
    match: /iogurte/,
    name: 'Iogurte natural',
    kcal: 51,
    protein: 4.1,
    carbs: 1.9,
    fat: 3,
    fiber: 0,
    grams: 170,
  },
  {
    match: /aveia/,
    name: 'Aveia em flocos',
    kcal: 394,
    protein: 13.9,
    carbs: 66.6,
    fat: 8.5,
    fiber: 9.1,
    grams: 30,
  },
  {
    match: /carne|patinho|bife/,
    name: 'Patinho grelhado',
    kcal: 219,
    protein: 35.9,
    carbs: 0,
    fat: 7.3,
    fiber: 0,
    grams: 120,
  },
];

const nutrientsOf = (label: string) =>
  PER_100G.find((food) => food.match.test(label.toLowerCase())) ?? {
    name: label,
    kcal: 120,
    protein: 5,
    carbs: 15,
    fat: 4,
    fiber: 1,
    grams: 100,
  };

const round1 = (n: number) => Math.round(n * 10) / 10;

function totalsOf(items: readonly FoodLogItem[]) {
  const sum = (pick: (n: ReturnType<typeof nutrientsOf>) => number) =>
    round1(
      items.reduce((total, item) => total + (pick(nutrientsOf(item.label)) * item.grams) / 100, 0),
    );
  return {
    energyKcal: Math.round(sum((n) => n.kcal)),
    proteinG: sum((n) => n.protein),
    carbsG: sum((n) => n.carbs),
    fatG: sum((n) => n.fat),
    fiberG: sum((n) => n.fiber),
    micros: {},
    unmatchedItems: 0,
  };
}

const item = (label: string, grams?: number): FoodLogItem => ({
  foodItemId: uuid(),
  label: nutrientsOf(label).name,
  grams: grams ?? nutrientsOf(label).grams,
  portionSource: 'ESTIMATED',
});

function mealNow(now = new Date()): MealSlot {
  const hour = now.getHours();
  if (hour < 10) return 'BREAKFAST';
  if (hour < 12) return 'MORNING_SNACK';
  if (hour < 15) return 'LUNCH';
  if (hour < 19) return 'AFTERNOON_SNACK';
  return 'DINNER';
}

/** A refeição dita no texto ("jantei", "no almoço"...), senão a da hora. */
function mealOf(text: string): MealSlot {
  const said = text.toLowerCase();
  if (/jant/.test(said)) return 'DINNER';
  if (/almo/.test(said)) return 'LUNCH';
  if (/caf[ée] da manh|desjejum/.test(said)) return 'BREAKFAST';
  if (/lanch/.test(said)) return 'AFTERNOON_SNACK';
  if (/ceia/.test(said)) return 'SUPPER';
  return mealNow();
}

/**
 * Oito semanas de treino de exemplo: força (seg e qua) subindo carga, corrida (ter e qui)
 * ganhando ritmo, HYROX a cada 15 dias, uma falta há três semanas e o treino de hoje em aberto.
 */
export function demoProgress(today: string): StudentProgress {
  const monday = mondayOf(today);
  const start = addDays(monday, -7 * 7);
  const scheduled: { date: string; status: string }[] = [];
  const executions: ProgressInput['executions'][number][] = [];
  const sets: ProgressInput['sets'][number][] = [];
  const lifts = [
    { id: 'supino_reto_barra', base: 60, step: 1.25, reps: 9 },
    { id: 'agachamento_livre', base: 80, step: 2.5, reps: 8 },
    { id: 'desenvolvimento_halteres', base: 16, step: 0.5, reps: 10 },
    { id: 'stiff', base: 50, step: 1.25, reps: 10 },
  ];
  const missed = addDays(monday, -18);
  for (let week = 0; week < 8; week += 1) {
    const ws = addDays(start, week * 7);
    const plan: [number, string][] = [
      [0, 'STRENGTH'],
      [1, 'RUNNING'],
      [2, 'STRENGTH'],
      [3, 'RUNNING'],
      ...(week % 2 === 1 ? ([[5, 'HYROX']] as [number, string][]) : []),
    ];
    for (const [offset, modality] of plan) {
      const date = addDays(ws, offset);
      if (date > today) continue;
      if (date === today) {
        scheduled.push({ date, status: 'PLANNED' });
        continue;
      }
      if (date === missed) {
        scheduled.push({ date, status: 'MISSED' });
        continue;
      }
      scheduled.push({ date, status: 'DONE' });
      const id = `${date}-${modality}`;
      const t = week + offset / 7;
      if (modality === 'STRENGTH') {
        executions.push({
          id,
          date,
          status: 'COMPLETED',
          modality,
          durationMinutes: 55,
          metrics: null,
        });
        for (const lift of lifts) {
          const load = Math.round((lift.base + lift.step * t) * 2) / 2;
          for (let set = 0; set < 3; set += 1) {
            sets.push({
              executionId: id,
              date,
              exerciseId: lift.id,
              reps: lift.reps - set,
              loadKg: load,
            });
          }
        }
      } else if (modality === 'RUNNING') {
        const km = Math.round((5 + 0.4 * t + (offset === 3 ? 1.5 : 0)) * 10) / 10;
        const pace = Math.round(370 - 4.5 * t);
        executions.push({
          id,
          date,
          status: 'COMPLETED',
          modality,
          durationMinutes: Math.round((km * pace) / 60),
          metrics: {
            distanceMeters: km * 1000,
            movingSeconds: Math.round(km * pace),
            avgPaceSecondsPerKm: pace,
            avgHeartRate: Math.round(160 - 1.4 * t),
          },
        });
      } else {
        const stations: { station: HyroxStation; durationSeconds: number }[] = [
          { station: 'SKIERG', durationSeconds: Math.round(300 - 4 * t) },
          { station: 'SLED_PUSH', durationSeconds: Math.round(235 - 5 * t) },
          { station: 'WALL_BALLS', durationSeconds: Math.round(345 - 5 * t) },
        ];
        executions.push({
          id,
          date,
          status: 'COMPLETED',
          modality,
          durationMinutes: null,
          metrics: { movingSeconds: Math.round(4_320 - 70 * t), stations },
        });
      }
    }
  }
  return studentProgressOf({
    today,
    scheduled,
    executions,
    sets,
    exerciseNames: new Map([
      ['supino_reto_barra', 'Supino reto com barra'],
      ['agachamento_livre', 'Agachamento livre'],
      ['desenvolvimento_halteres', 'Desenvolvimento com halteres'],
      ['stiff', 'Stiff com barra'],
    ]),
  });
}

type FoodApi = Pick<
  TrainingApi,
  | 'getFoodDay'
  | 'draftFromText'
  | 'draftFromPhoto'
  | 'confirmFoodLog'
  | 'removeFoodLog'
  | 'updateFoodLog'
>;
type EvolutionApi = Pick<TrainingApi, 'getEvolution' | 'addMeasurements'>;

export function createDemoStudentData(today: string): FoodApi & EvolutionApi {
  type Log = FoodDay['logs'][number];
  const logs: Log[] = [
    { meal: 'BREAKFAST', items: [item('pão', 50), item('ovo', 100), item('banana', 90)] },
    { meal: 'LUNCH', items: [item('arroz'), item('feijão'), item('frango'), item('salada')] },
  ].map((log) => ({
    id: uuid(),
    meal: log.meal as MealSlot,
    items: log.items,
    totals: totalsOf(log.items),
    confirmed: true,
  }));
  const drafts = new Map<string, FoodLogDraft>();

  const draftOf = (items: FoodLogItem[], meal: MealSlot): FoodLogDraft => {
    const draft: FoodLogDraft = {
      logId: uuid(),
      meal,
      items: items.map((i) => ({ ...i, matchedName: i.label })),
      totals: totalsOf(items),
      needsClarification: null,
    };
    drafts.set(draft.logId, draft);
    return draft;
  };

  const measurements: Record<string, { on: string; value: number }[]> = {
    WEIGHT: [
      { on: addDays(today, -56), value: 84.6 },
      { on: addDays(today, -28), value: 83.4 },
      { on: addDays(today, -3), value: 82.7 },
    ],
    WAIST: [
      { on: addDays(today, -56), value: 92 },
      { on: addDays(today, -3), value: 89.5 },
    ],
  };
  const sessionsPerWeek = [4, 5, 4, 5, 3, 5, 4, 5];

  return {
    async getFoodDay() {
      await wait(120);
      const confirmed = logs.filter((log) => log.confirmed);
      const sum = (pick: (log: Log) => number) =>
        round1(confirmed.reduce((t, log) => t + pick(log), 0));
      return structuredClone({
        firstName: 'Rodrigo',
        today,
        date: today,
        dayType: 'TRAINING' as const,
        targets: {
          energyKcal: { min: 2_200, max: 2_500 },
          proteinG: 160,
          carbsG: 270,
          fatG: 70,
          fiberG: 30,
          waterMl: 3_000,
        },
        logs,
        totals: {
          energyKcal: Math.round(sum((log) => log.totals.energyKcal)),
          proteinG: sum((log) => log.totals.proteinG),
          carbsG: sum((log) => log.totals.carbsG),
          fatG: sum((log) => log.totals.fatG),
          fiberG: sum((log) => log.totals.fiberG),
        },
        hasPlan: true,
      });
    },

    async draftFromText({ text, meal }) {
      await wait(700);
      const parts = text
        .split(/,|\be\b|\bcom\b|\+/i)
        .map((part) => part.replace(/^(comi|almocei|jantei|tomei|lanchei)\s+/i, '').trim())
        .filter((part) => part.length > 1);
      if (parts.length === 0) throw new Error('Não identificamos comida. Tente descrever de novo.');
      return draftOf(
        parts.slice(0, 8).map((part) => item(part)),
        meal ?? mealOf(text),
      );
    },

    async draftFromPhoto(_file, meal) {
      await wait(1_200);
      return draftOf(
        [item('arroz'), item('feijão'), item('carne'), item('salada')],
        meal ?? mealNow(),
      );
    },

    async confirmFoodLog(logId, body) {
      await wait();
      drafts.delete(logId);
      logs.push({
        id: logId,
        meal: body.meal,
        items: body.items,
        totals: totalsOf(body.items),
        confirmed: true,
      });
    },

    async removeFoodLog(logId) {
      await wait(80);
      drafts.delete(logId);
      const at = logs.findIndex((log) => log.id === logId);
      if (at >= 0) logs.splice(at, 1);
    },

    async updateFoodLog(logId, body) {
      await wait();
      const log = logs.find((item) => item.id === logId);
      if (!log) throw new Error('Refeição não encontrada.');
      log.meal = body.meal;
      log.items = body.items;
      log.totals = totalsOf(body.items);
    },

    async getEvolution(): Promise<EvolutionView> {
      await wait(120);
      const monday = mondayOf(today);
      return structuredClone({
        firstName: 'Rodrigo',
        strategyTitle: 'Recomposição corporal com base aeróbia',
        milestones: [
          {
            milestone: { description: 'Cintura 3 cm menor' },
            dueOn: addDays(today, 30),
            status: 'IN_PROGRESS',
          },
          {
            milestone: { description: 'Correr 10 km abaixo de 55 minutos' },
            dueOn: addDays(today, 60),
            status: 'IN_PROGRESS',
          },
        ],
        tasks: [
          {
            title: 'Treinar 4 vezes nesta semana',
            target: 4,
            progress: 2,
            windowEnd: addDays(monday, 6),
            status: 'OPEN',
          },
          {
            title: 'Bater a meta de proteína 5 dias',
            target: 5,
            progress: 3,
            windowEnd: addDays(monday, 6),
            status: 'OPEN',
          },
        ],
        measurements,
        weeks: sessionsPerWeek.map((sessions, index) => ({
          weekStart: addDays(monday, (index - sessionsPerWeek.length + 1) * 7),
          sessions,
          load: sessions * 320,
        })),
        progress: demoProgress(today),
      });
    },

    async addMeasurements(input) {
      await wait();
      for (const m of input) {
        const kind: MeasurementKind = m.kind;
        (measurements[kind] ??= []).push({ on: m.measuredOn, value: m.value });
      }
    },
  };
}
