import { describe, expect, it } from 'vitest';

import type { MethodologyParameters, PlanSession } from '@movivo/shared';

import type { ValidationContext, Violation } from '../../../core/agents/agent-task';
import { devMethodologyParameters } from '../../../core/database/seed-methodology';
import { hybridValidators, type HybridInput } from './hybrid';
import { hyroxValidators, type HyroxInput } from './hyrox';
import type { FoodCandidate } from '../calc/menu';
import {
  finalizeNutrition,
  nutritionValidators,
  type NutritionInput,
  type NutritionOutput,
} from './nutrition';
import { runningValidators, type RunningInput } from './running';
import { strategyValidators, type StrategyInput, type StrategyOutput } from './strategy';
import { strengthValidators, type StrengthCandidate, type StrengthInput } from './strength';
import type { BlockOutput } from './blocks';
import { at } from '../calc/util';

const params = (domain: string): MethodologyParameters => devMethodologyParameters(domain);

const context = (
  state: Record<string, unknown> = {},
  domains: string[] = [],
): ValidationContext => ({
  state,
  methodology: Object.fromEntries(domains.map((d) => [d, params(d)])) as never,
});

async function run<I, O>(
  validators: readonly ((i: I, o: O, c: ValidationContext) => Violation[] | Promise<Violation[]>)[],
  input: I,
  output: O,
  ctx: ValidationContext,
): Promise<string[]> {
  const found: Violation[] = [];
  for (const validator of validators) found.push(...(await validator(input, output, ctx)));
  return found.map((v) => `${v.path}: ${v.message}`);
}

// --- Estratégia ----------------------------------------------------------------------------

const strategyInput = (
  over: Partial<StrategyInput['derived']> = {},
  declared = {},
): StrategyInput => ({
  declared: {
    primary: 'HYPERTROPHY',
    secondary: [],
    emphasis: 'AESTHETICS',
    ...declared,
  },
  modalities: [{ modality: 'STRENGTH', level: 'INTERMEDIATE', wantsToStart: false }],
  derived: {
    adiposity: 'MODERATE',
    bmi: 24,
    weeksToEvent: null,
    hasExternalSport: false,
    sessionsPerWeekAvailable: 4,
    ...over,
  },
});

const strategyOutput = (energy: StrategyOutput['strategy']['energyStrategy']): StrategyOutput => ({
  strategy: {
    title: 'Ganho de massa',
    rationale: ['Objetivo declarado e disponibilidade permitem foco em força.'],
    energyStrategy: energy,
    modalityFocus: ['STRENGTH'],
    indicators: [
      { key: 'waist', label: 'Cintura', source: 'BODY', direction: 'DECREASE', unit: 'cm' },
      { key: 'sessions', label: 'Sessões concluídas', source: 'ADHERENCE', direction: 'INCREASE' },
    ],
    reviewAfterWeeks: 6,
    openQuestions: [],
  },
  milestones: [
    {
      indicatorKey: 'sessions',
      description: 'Concluir 3 sessões por semana por 4 semanas.',
      condition: { kind: 'AT_LEAST', value: 12 },
      dueInWeeks: 4,
    },
  ],
  tasks: [{ kind: 'COMPLETE_SESSIONS', title: 'Treinar 3 vezes', cadence: 'WEEKLY', target: 3 }],
  studentMessage: 'Vamos construir força de forma consistente, no seu ritmo.',
  professionalNote: 'Sem observações.',
});

describe('goals.define_strategy', () => {
  it('hipertrofia com adiposidade alta exige recomposição', async () => {
    const input = strategyInput({ adiposity: 'HIGH' });
    expect(await run(strategyValidators, input, strategyOutput('SURPLUS'), context())).toEqual([
      expect.stringContaining('RECOMPOSITION'),
    ]);
    expect(
      await run(strategyValidators, input, strategyOutput('RECOMPOSITION'), context()),
    ).toEqual([]);
  });

  it('transtorno alimentar bloqueia qualquer restrição de energia', async () => {
    const state = {
      safety: { activeSignals: [{ kind: 'EATING_DISORDER_SIGNS' }], healthRecords: [] },
    };
    const input = strategyInput({ adiposity: 'HIGH' }, { primary: 'FAT_LOSS' });
    const found = await run(strategyValidators, input, strategyOutput('DEFICIT'), context(state));
    expect(found.join(' ')).toContain('transtorno alimentar');
    expect(
      await run(strategyValidators, input, strategyOutput('MAINTENANCE'), context(state)),
    ).toEqual([]);
  });

  it('IMC baixo, perda de gordura com superávit e déficit perto da prova são recusados', async () => {
    const low = await run(
      strategyValidators,
      strategyInput({ bmi: 17.5 }, { primary: 'FAT_LOSS' }),
      strategyOutput('DEFICIT'),
      context(),
    );
    expect(low.join(' ')).toContain('IMC');
    const surplus = await run(
      strategyValidators,
      strategyInput({}, { primary: 'FAT_LOSS' }),
      strategyOutput('SURPLUS'),
      context(),
    );
    expect(surplus.join(' ')).toContain('superávit');
    const near = await run(
      strategyValidators,
      strategyInput({ weeksToEvent: 3 }, { primary: 'FAT_LOSS' }),
      strategyOutput('DEFICIT'),
      context(),
    );
    expect(near.join(' ')).toContain('4 semanas');
  });

  it('o foco precisa cobrir o que o objetivo exige e vir do que o aluno pratica', async () => {
    const output = strategyOutput('PERFORMANCE_FUELING');
    const input = strategyInput({}, { primary: 'HYROX_PREPARATION' });
    const found = await run(strategyValidators, input, output, context());
    expect(found.join(' ')).toContain('HYROX');
  });

  it('marco aponta para indicador inexistente e passa da prova', async () => {
    const output = strategyOutput('MAINTENANCE');
    at(output.milestones, 0).indicatorKey = 'inexistente';
    at(output.milestones, 0).dueInWeeks = 20;
    const found = await run(
      strategyValidators,
      strategyInput({ weeksToEvent: 8 }),
      output,
      context(),
    );
    expect(found.join(' ')).toContain('inexistente');
    expect(found.join(' ')).toContain('depois da data da prova');
  });

  it('meta de sessões acima da disponibilidade e linguagem proibida são recusadas', async () => {
    const output = strategyOutput('MAINTENANCE');
    at(output.tasks, 0).target = 6;
    output.studentMessage = 'Resultado garantido: vamos tratar sua condição.';
    const found = await run(strategyValidators, strategyInput(), output, context());
    expect(found.join(' ')).toContain('acima da disponibilidade');
    expect(found.join(' ')).toContain('guardrail');
  });
});

// --- Força ---------------------------------------------------------------------------------

const candidate = (id: string, group: string, pattern = 'HORIZONTAL_PUSH'): StrengthCandidate => ({
  id,
  name: id,
  pattern,
  muscleGroups: [group],
  equipment: [],
  measurement: 'REPS',
});
const CANDIDATES: StrengthCandidate[] = [
  candidate('supino', 'peito'),
  candidate('crucifixo', 'peito', 'ISOLATION'),
  candidate('remada', 'costas', 'HORIZONTAL_PULL'),
  candidate('puxada', 'costas', 'VERTICAL_PULL'),
  candidate('desenvolvimento', 'ombro', 'VERTICAL_PUSH'),
  candidate('elevacao', 'ombro', 'ISOLATION'),
  candidate('agachamento', 'quadríceps', 'SQUAT'),
  candidate('extensora', 'quadríceps', 'ISOLATION'),
  candidate('stiff', 'posterior de coxa', 'HINGE'),
  candidate('elevacao_pelvica', 'glúteo', 'HINGE'),
  candidate('rosca', 'bíceps', 'ISOLATION'),
  candidate('triceps', 'tríceps', 'ISOLATION'),
];

const strengthInput = (over: Partial<StrengthInput> = {}): StrengthInput => ({
  level: 'INTERMEDIATE',
  goal: 'HYPERTROPHY',
  phase: 'HYPERTROPHY',
  sessionsPerWeek: 2,
  minutesPerSession: 75,
  weeksInBlock: 4,
  split: 'FULL_BODY',
  modalityPriority: 1,
  candidates: [...CANDIDATES, ...CANDIDATES.map((c) => ({ ...c, id: `${c.id}_b` }))],
  preferredExerciseIds: [],
  ...over,
});

function strengthSession(
  key: string,
  exercises: { id: string; sets: number; rest: number; rir?: number; reps?: [number, number] }[],
  over: Partial<PlanSession> = {},
): PlanSession {
  return {
    key,
    title: key,
    purpose: 'Sessão de teste',
    priority: 'KEY',
    weeklyFrequency: 1,
    estimatedMinutes: 70,
    estimatedRpe: 7,
    content: {
      modality: 'STRENGTH',
      focus: 'Corpo todo',
      exercises: exercises.map((e) => ({
        exerciseId: e.id,
        name: e.id,
        sets: e.sets,
        reps: { min: e.reps?.[0] ?? 8, max: e.reps?.[1] ?? 12 },
        loadStrategy: 'DOUBLE_PROGRESSION' as const,
        rir: e.rir ?? 2,
        restSeconds: e.rest,
      })),
    },
    ...over,
  } as PlanSession;
}

const block = (sessions: PlanSession[]): BlockOutput => ({
  summary: 'Bloco de força.',
  phases: [{ name: 'Base', focus: 'Volume', weeks: 4, endsWithDeload: false }],
  sessions,
  notes: [],
});

const FULL_BODY = [
  { id: 'supino', sets: 4, rest: 120 },
  { id: 'remada', sets: 4, rest: 120 },
  { id: 'desenvolvimento', sets: 4, rest: 120 },
  { id: 'agachamento', sets: 4, rest: 120 },
  { id: 'stiff', sets: 4, rest: 120 },
  { id: 'elevacao_pelvica', sets: 4, rest: 120 },
];

describe('strength.build_block', () => {
  const ctx = context({}, ['STRENGTH']);

  it('aceita um bloco coerente', async () => {
    const output = block([
      strengthSession('A', FULL_BODY, { estimatedMinutes: 65 }),
      strengthSession('B', FULL_BODY, { estimatedMinutes: 65 }),
    ]);
    expect(await run(strengthValidators, strengthInput(), output, ctx)).toEqual([]);
  });

  it('recusa exercício fora do universo permitido e frequência errada', async () => {
    const output = block([
      strengthSession('A', [{ id: 'inventado', sets: 3, rest: 90 }], { estimatedMinutes: 30 }),
    ]);
    const found = (await run(strengthValidators, strengthInput(), output, ctx)).join(' | ');
    expect(found).toContain('não está entre os exercícios permitidos');
    expect(found).toContain('a soma das frequências semanais deve ser 2');
  });

  it('recusa volume acima do teto por sessão e por semana', async () => {
    const heavy = [
      { id: 'supino', sets: 12, rest: 120 },
      { id: 'crucifixo', sets: 12, rest: 60 },
    ];
    const output = block([
      strengthSession('A', [...heavy, ...FULL_BODY.slice(1)], { estimatedMinutes: 75 }),
      strengthSession('B', [...heavy, ...FULL_BODY.slice(1)], { estimatedMinutes: 75 }),
    ]);
    const found = (
      await run(strengthValidators, strengthInput({ minutesPerSession: 200 }), output, ctx)
    ).join(' | ');
    expect(found).toContain('numa sessão (máximo');
    expect(found).toContain('séries/semana de peito');
  });

  it('recusa RIR, repetições e descanso fora das faixas', async () => {
    const output = block([
      strengthSession(
        'A',
        [{ ...at(FULL_BODY, 0), rir: 5, reps: [20, 30], rest: 20 }, ...FULL_BODY.slice(1)],
        {
          estimatedMinutes: 60,
        },
      ),
      strengthSession('B', FULL_BODY, { estimatedMinutes: 65 }),
    ]);
    const found = (await run(strengthValidators, strengthInput(), output, ctx)).join(' | ');
    expect(found).toContain('RIR 5');
    expect(found).toContain('repetições 20–30');
    expect(found).toContain('descanso de 20s');
  });

  it('recusa sessão que não cabe no tempo do aluno', async () => {
    const output = block([
      strengthSession('A', FULL_BODY, { estimatedMinutes: 90 }),
      strengthSession('B', FULL_BODY, { estimatedMinutes: 65 }),
    ]);
    const found = (
      await run(strengthValidators, strengthInput({ minutesPerSession: 45 }), output, ctx)
    ).join(' | ');
    expect(found).toContain('passa do tempo disponível');
  });

  it('recusa grupo principal sem volume com 2+ sessões', async () => {
    const noLegs = FULL_BODY.slice(0, 3);
    const output = block([
      strengthSession('A', noLegs, { estimatedMinutes: 45 }),
      strengthSession('B', noLegs, { estimatedMinutes: 45 }),
    ]);
    const found = (await run(strengthValidators, strengthInput(), output, ctx)).join(' | ');
    expect(found).toContain('quadríceps');
  });
});

// --- Corrida -------------------------------------------------------------------------------

const runningInput = (over: Partial<RunningInput> = {}): RunningInput => ({
  level: 'BEGINNER',
  goal: 'FITNESS',
  phase: 'BASE',
  sessionsPerWeek: 3,
  minutesPerSession: 60,
  weeksInBlock: 4,
  currentWeeklyKm: 12,
  recent5kSeconds: 1_800,
  race: null,
  modalityPriority: 1,
  ...over,
});

function runSession(
  key: string,
  kind: 'EASY' | 'LONG' | 'INTERVALS' | 'TEMPO',
  segments: object[],
  over: Partial<PlanSession> = {},
): PlanSession {
  return {
    key,
    title: key,
    purpose: 'Corrida de teste',
    priority: key === 'LONGAO' ? 'KEY' : 'IMPORTANT',
    weeklyFrequency: 1,
    estimatedMinutes: 40,
    estimatedRpe: 4,
    content: { modality: 'RUNNING', kind, segments, terrain: 'ANY' },
    ...over,
  } as PlanSession;
}
const easy = (meters: number) => [
  { type: 'STEADY', distanceMeters: meters, target: { by: 'ZONE', zone: 'Z2' } },
];

describe('running.build_block', () => {
  const ctx = context({}, ['RUNNING']);

  it('aceita volume dentro do crescimento permitido', async () => {
    const output = block([
      runSession('FACIL1', 'EASY', easy(4_000)),
      runSession('FACIL2', 'EASY', easy(4_000)),
      runSession('LONGAO', 'LONG', easy(5_000), { estimatedMinutes: 50 }),
    ]);
    expect(await run(runningValidators, runningInput(), output, ctx)).toEqual([]);
  });

  it('recusa salto de volume, longão longo demais e ritmo impossível', async () => {
    const output = block([
      runSession('FACIL1', 'EASY', easy(8_000)),
      runSession('FACIL2', 'EASY', [
        {
          type: 'WORK',
          distanceMeters: 5_000,
          target: { by: 'PACE', secondsPerKm: { min: 200, max: 220 } },
        },
      ]),
      runSession('LONGAO', 'LONG', easy(12_000), { estimatedMinutes: 55 }),
    ]);
    const found = (await run(runningValidators, runningInput(), output, ctx)).join(' | ');
    expect(found).toContain('volume semanal');
    expect(found).toContain('mais rápido do que o aluno sustenta');
  });

  it('quem está começando tem teto de minutos na semana', async () => {
    const output = block([
      runSession('FACIL1', 'EASY', [
        { type: 'STEADY', durationSeconds: 3_600, target: { by: 'RPE', rpe: { min: 3, max: 4 } } },
      ]),
      runSession('FACIL2', 'EASY', [
        { type: 'STEADY', durationSeconds: 3_600, target: { by: 'RPE', rpe: { min: 3, max: 4 } } },
      ]),
      runSession('LONGAO', 'LONG', [
        { type: 'STEADY', durationSeconds: 3_600, target: { by: 'RPE', rpe: { min: 3, max: 4 } } },
      ]),
    ]);
    const found = (
      await run(runningValidators, runningInput({ currentWeeklyKm: 0 }), output, ctx)
    ).join(' | ');
    expect(found).toContain('quem está começando');
  });

  it('limita sessões de qualidade e exige intensidade leve dominante', async () => {
    const quality = [
      { type: 'WARMUP', durationSeconds: 300, target: { by: 'ZONE', zone: 'Z1' } },
      { type: 'WORK', repeat: 5, distanceMeters: 800, target: { by: 'ZONE', zone: 'Z4' } },
      { type: 'COOLDOWN', durationSeconds: 300, target: { by: 'ZONE', zone: 'Z1' } },
    ];
    const output = block([
      runSession('Q1', 'INTERVALS', quality, { estimatedRpe: 8 }),
      runSession('Q2', 'TEMPO', quality, { estimatedRpe: 7 }),
      runSession('LONGAO', 'LONG', easy(4_000)),
    ]);
    const found = (await run(runningValidators, runningInput(), output, ctx)).join(' | ');
    expect(found).toContain('sessões de qualidade');
  });

  it('a duas semanas da prova o bloco é de polimento', async () => {
    const output = block([
      runSession('FACIL1', 'EASY', easy(4_000)),
      runSession('FACIL2', 'EASY', easy(4_000)),
      runSession('LONGAO', 'LONG', easy(5_000)),
    ]);
    const found = (
      await run(
        runningValidators,
        runningInput({ race: { distanceMeters: 10_000, weeksToRace: 2, targetSeconds: null } }),
        output,
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('polimento');
  });
});

// --- HYROX ---------------------------------------------------------------------------------

const hyroxInput = (over: Partial<HyroxInput> = {}): HyroxInput => ({
  level: 'INTERMEDIATE',
  division: 'OPEN',
  category: 'openMale',
  phase: 'BUILD',
  weeksToRace: 10,
  sessionsPerWeek: 2,
  minutesPerSession: 70,
  weeksInBlock: 4,
  simulationDue: false,
  stationsWithEquipment: ['SKIERG', 'SLED_PUSH', 'ROWING'],
  currentWeeklyKm: 20,
  modalityPriority: 1,
  ...over,
});

function hyroxSession(
  key: string,
  kind: 'COMPROMISED_RUNNING' | 'SIMULATION' | 'ENGINE' | 'STATION_STRENGTH',
  blocks: object[],
  over: Partial<PlanSession> = {},
): PlanSession {
  return {
    key,
    title: key,
    purpose: 'Sessão de HYROX',
    priority: 'KEY',
    weeklyFrequency: 1,
    estimatedMinutes: 60,
    estimatedRpe: 7,
    content: { modality: 'HYROX', kind, rounds: 1, blocks },
    ...over,
  } as PlanSession;
}
const sledPush = (loadKg: number) => ({
  type: 'STATION',
  station: 'SLED_PUSH',
  distanceMeters: 50,
  loadKg,
});
const run1k = { type: 'RUN', distanceMeters: 1_000, target: { by: 'ZONE', zone: 'Z3' } };

describe('hyrox.build_block', () => {
  const ctx = context({}, ['HYROX']);

  it('aceita um bloco dentro das regras', async () => {
    const output = block([
      hyroxSession('COMP', 'COMPROMISED_RUNNING', [run1k, sledPush(100)]),
      hyroxSession('ENGINE', 'ENGINE', [run1k], { priority: 'IMPORTANT' }),
    ]);
    expect(await run(hyroxValidators, hyroxInput(), output, ctx)).toEqual([]);
  });

  it('recusa simulado fora de hora, carga acima da prova e estação sem equipamento com carga', async () => {
    const loaded = {
      HYROX: {
        ...params('HYROX'),
        loads: { stationLoadsKg: { SLED_PUSH: { openMale: 152 } } },
      },
    } as never;
    const ctx = { state: {}, methodology: loaded } as ValidationContext;
    const output = block([
      hyroxSession('SIM', 'SIMULATION', [run1k, sledPush(300)]),
      hyroxSession('ENGINE', 'ENGINE', [
        run1k,
        { type: 'STATION', station: 'SANDBAG_LUNGES', distanceMeters: 100, loadKg: 20 },
      ]),
    ]);
    const found = (await run(hyroxValidators, hyroxInput(), output, ctx)).join(' | ');
    expect(found).toContain('simulado');
    expect(found).toContain('carga de prova');
    expect(found).toContain('sem equipamento oficial');
  });

  it('na fase específica exige corrida comprometida', async () => {
    const output = block([
      hyroxSession('ENGINE', 'ENGINE', [run1k]),
      hyroxSession('FORCA', 'STATION_STRENGTH', [sledPush(80)], { priority: 'IMPORTANT' }),
    ]);
    const found = (
      await run(hyroxValidators, hyroxInput({ phase: 'PEAK', weeksToRace: 5 }), output, ctx)
    ).join(' | ');
    expect(found).toContain('corrida comprometida');
  });
});

// --- Híbrido -------------------------------------------------------------------------------

const everyEvening = (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const).map((weekday) => ({
  weekday,
  slot: 'EVENING' as const,
  maxMinutes: 90,
}));

function hybridInput(over: Partial<HybridInput> = {}): HybridInput {
  const base = strengthSession('LOWER', FULL_BODY);
  const lower: PlanSession = {
    ...base,
    weeklyFrequency: 2,
    estimatedRpe: 7,
    content: {
      ...(base.content as object),
      focus: 'Inferiores — quadríceps',
    } as PlanSession['content'],
  };
  return {
    blocks: [
      { modality: 'STRENGTH', priority: 1, block: block([lower]) },
      {
        modality: 'RUNNING',
        priority: 2,
        block: block([
          runSession(
            'INTERV',
            'INTERVALS',
            [{ type: 'WORK', repeat: 5, distanceMeters: 800, target: { by: 'ZONE', zone: 'Z4' } }],
            { estimatedRpe: 8, priority: 'KEY' },
          ),
        ]),
      },
    ],
    externalSessions: [],
    availability: { maxSessionsPerWeek: 4, windows: everyEvening, externalFixedDays: {} },
    recentWeeklyLoad: null,
    startsOn: '2026-11-02',
    runningLevel: 'INTERMEDIATE',
    ...over,
  };
}

const planOf = (input: HybridInput, over: Partial<{ freq: Record<string, number> }> = {}) => {
  const sessions = [
    ...input.blocks.flatMap((b) => b.block.sessions),
    ...input.externalSessions,
  ].map((s) => ({ ...s, weeklyFrequency: over.freq?.[s.key] ?? s.weeklyFrequency }));
  return {
    summary: 'Plano integrado.',
    modalityPriorities: input.blocks.map((b) => ({ modality: b.modality, priority: b.priority })),
    phases: [{ name: 'Base', focus: 'Construir rotina', weeks: 4, endsWithDeload: false }],
    sessions,
  };
};

describe('hybrid.reconcile_week', () => {
  const ctx = context({}, ['HYBRID', 'RUNNING']);

  it('aceita um plano que cabe na semana', async () => {
    const input = hybridInput();
    expect(await run(hybridValidators, input, planOf(input), ctx)).toEqual([]);
  });

  it('recusa conteúdo alterado, frequência aumentada e sessão inventada', async () => {
    const input = hybridInput();
    const plan = structuredClone(planOf(input));
    (at(plan.sessions, 0).content as { focus: string }).focus = 'Outro';
    at(plan.sessions, 1).weeklyFrequency = 3;
    plan.sessions.push({ ...at(plan.sessions, 1), key: 'NOVA' });
    const found = (await run(hybridValidators, input, plan, ctx)).join(' | ');
    expect(found).toContain('não pode ser alterado');
    expect(found).toContain('não pode aumentar');
    expect(found).toContain('não existe nos blocos');
  });

  it('esporte externo precisa continuar no plano', async () => {
    const external: PlanSession = {
      key: 'LUTA',
      title: 'Luta',
      purpose: 'Esporte do aluno',
      priority: 'IMPORTANT',
      weeklyFrequency: 3,
      estimatedMinutes: 60,
      estimatedRpe: 7,
      content: {
        modality: 'EXTERNAL_SPORT',
        sport: 'MARTIAL_ARTS',
        label: 'Jiu-jitsu',
        plannedMinutes: 60,
        plannedRpe: 7,
      },
    };
    const input = hybridInput({
      externalSessions: [external],
      availability: {
        maxSessionsPerWeek: 4,
        windows: everyEvening,
        externalFixedDays: { LUTA: ['MON', 'WED', 'FRI'] },
      },
    });
    const plan = planOf(input);
    plan.sessions = plan.sessions.filter((s) => s.key !== 'LUTA');
    const found = (await run(hybridValidators, input, plan, ctx)).join(' | ');
    expect(found).toContain('esporte externo');
  });

  it('recusa plano que estoura a disponibilidade ou o teto de sessões intensas', async () => {
    const input = hybridInput({
      availability: {
        maxSessionsPerWeek: 2,
        windows: everyEvening.slice(0, 2),
        externalFixedDays: {},
      },
    });
    const found = (await run(hybridValidators, input, planOf(input), ctx)).join(' | ');
    expect(found).toContain('passam do que o aluno sustenta');
  });
});

// --- Nutrição ------------------------------------------------------------------------------

const bound = (kcal: [number, number], expenditure: number) => ({
  energyKcal: { min: kcal[0], max: kcal[1] },
  proteinG: { min: 144, max: 192 },
  fatMinG: 56,
  fiberMinG: 25,
  waterMinMl: 2_800,
  expenditureKcal: expenditure,
});

const food = (
  id: string,
  name: string,
  category: string,
  energyKcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  fiberG = 0,
): FoodCandidate => ({ id, name, category, energyKcal, proteinG, carbsG, fatG, fiberG });

const FOODS: FoodCandidate[] = [
  food('ovo', 'Ovo de galinha, inteiro, cozido', 'Ovos e derivados', 146, 13.3, 0.6, 9.5),
  food('pao', 'Pão, trigo, integral', 'Cereais e derivados', 253, 9.4, 49.9, 3.4, 6.9),
  food('banana', 'Banana, prata', 'Frutas e derivados', 98, 1.3, 26, 0.1, 2),
  food('arroz', 'Arroz, integral, cozido', 'Cereais e derivados', 124, 2.6, 25.8, 1, 2.7),
  food('feijao', 'Feijão, carioca, cozido', 'Leguminosas e derivados', 76, 4.8, 13.6, 0.5, 8.5),
  food('frango', 'Frango, peito, grelhado', 'Carnes e derivados', 159, 32, 0, 2.5),
  food('iogurte', 'Iogurte, natural, desnatado', 'Leite e derivados', 41, 3.8, 5.9, 0.2),
  food('aveia', 'Aveia, flocos', 'Cereais e derivados', 394, 13.9, 66.6, 8.5, 9.1),
  food(
    'batata',
    'Batata-doce, cozida',
    'Verduras, hortaliças e derivados',
    77,
    0.6,
    18.4,
    0.1,
    2.2,
  ),
  food('tilapia', 'Peixe, tilápia, grelhado', 'Pescados e frutos do mar', 128, 26, 0, 2.7),
  food('alface', 'Alface, crespa', 'Verduras, hortaliças e derivados', 11, 1.3, 1.7, 0.2, 1.8),
  food('macarrao', 'Macarrão, cozido', 'Cereais e derivados', 102, 3.4, 19.9, 0.5, 1.2),
  food('amendoim', 'Pasta de amendoim', 'Nozes e sementes', 588, 25, 20, 50, 6),
  food('leite_vegetal', 'Bebida vegetal de aveia', 'Leite e derivados', 45, 1, 8, 1),
];

const nutritionInput = (over: Partial<NutritionInput> = {}): NutritionInput => ({
  strategy: 'DEFICIT',
  weightKg: 80,
  bounds: { trainingDay: bound([2_000, 2_200], 2_600), restDay: bound([1_800, 1_950], 2_300) },
  mealsPerDay: 4,
  usualMeals: ['BREAKFAST', 'LUNCH', 'AFTERNOON_SNACK', 'DINNER'],
  dietaryRestrictions: [],
  allowedSupplements: ['CREATINE', 'WHEY'],
  proteinPerMealMinG: 25,
  maxWeeklyWeightLossPct: 1,
  cookingCapacity: 'BASIC',
  foodBudgetMonthlyBrl: 1200,
  mealsOutsideHomePerWeek: 3,
  foods: FOODS,
  dailyBudgetBrl: 40,
  ...over,
});

const day = (kcal: [number, number], protein: number, carbs: number, fat: number) => ({
  energyKcal: { min: kcal[0], max: kcal[1] },
  proteinG: protein,
  carbsG: carbs,
  fatG: fat,
  fiberG: 30,
  waterMl: 3_000,
});

const swapOf = (foodId: string) => ({ foodId });
const draftItem = (
  foodId: string,
  grams: number,
  swaps: string[] = [],
  unit?: { singular: string; plural: string; grams: number },
) => ({ foodId, grams, swaps: swaps.map(swapOf), ...(unit ? { unit } : {}) });

/** Três opções com as mesmas proporções (o servidor ajusta as quantidades à meta). */
const options = (
  titles: [string, string, string],
  items: ReturnType<typeof draftItem>[],
  cost: number,
) => titles.map((title) => ({ title, estimatedCostBrl: cost, items }));

const nutritionOutput = (over: Partial<NutritionOutput> = {}): NutritionOutput => ({
  strategy: 'DEFICIT',
  summary: 'Déficit moderado com proteína alta.',
  trainingDay: day([2_050, 2_150], 160, 235, 60),
  restDay: day([1_850, 1_950], 160, 195, 60),
  meals: [
    {
      slot: 'BREAKFAST',
      energyShare: 0.25,
      proteinG: 40,
      guidance: 'Proteína no café',
      options: options(
        ['Ovos com pão e banana', 'Ovos com pão e banana (B)', 'Ovos com pão e banana (C)'],
        [
          draftItem('ovo', 200, ['frango'], { singular: 'ovo', plural: 'ovos', grams: 50 }),
          draftItem('pao', 50, ['aveia'], { singular: 'fatia', plural: 'fatias', grams: 25 }),
          draftItem('banana', 100),
        ],
        5,
      ),
    },
    {
      slot: 'LUNCH',
      energyShare: 0.35,
      proteinG: 45,
      guidance: 'Prato completo',
      options: options(
        ['Frango, arroz e feijão', 'Frango, arroz e feijão (B)', 'Frango, arroz e feijão (C)'],
        [
          draftItem('frango', 100, ['tilapia']),
          draftItem('arroz', 200, ['batata', 'macarrao']),
          draftItem('feijao', 120),
          draftItem('alface', 40),
        ],
        9,
      ),
    },
    {
      slot: 'AFTERNOON_SNACK',
      energyShare: 0.15,
      proteinG: 18,
      guidance: 'Lanche prático',
      options: options(
        ['Ovo, pão e banana', 'Ovo, pão e banana (B)', 'Ovo, pão e banana (C)'].slice(0, 2) as [
          string,
          string,
          string,
        ],
        [draftItem('ovo', 100), draftItem('pao', 50), draftItem('banana', 50)],
        4,
      ).slice(0, 2),
    },
    {
      slot: 'DINNER',
      energyShare: 0.25,
      proteinG: 45,
      guidance: 'Jantar leve',
      options: options(
        ['Peixe com batata-doce', 'Peixe com batata-doce (B)', 'Peixe com batata-doce (C)'],
        [
          draftItem('tilapia', 150, ['frango']),
          draftItem('batata', 250, ['arroz']),
          draftItem('alface', 60),
        ],
        8,
      ),
    },
  ],
  guidelines: ['Beba água ao longo do dia.'],
  supplements: [{ name: 'Creatina', guidance: 'Uso diário, conforme orientação.' }],
  ...over,
});

describe('nutrition.build_plan', () => {
  const ctx = context({}, ['NUTRITION']);

  it('aceita um plano dentro dos limites', async () => {
    expect(await run(nutritionValidators, nutritionInput(), nutritionOutput(), ctx)).toEqual([]);
  });

  it('recusa energia, proteína e gordura fora dos limites', async () => {
    const output = nutritionOutput({
      trainingDay: day([1_500, 1_600], 100, 150, 30),
    });
    const found = (await run(nutritionValidators, nutritionInput(), output, ctx)).join(' | ');
    expect(found).toContain('energia mínima abaixo');
    expect(found).toContain('proteína de 100 g abaixo do mínimo');
    expect(found).toContain('gordura de 30 g abaixo do mínimo');
  });

  it('macros que não fecham com a energia são recusados', async () => {
    const output = nutritionOutput({ restDay: day([1_850, 1_950], 160, 100, 60) });
    const found = (await run(nutritionValidators, nutritionInput(), output, ctx)).join(' | ');
    expect(found).toContain('somam');
  });

  it('recusa perda de peso semanal acima do máximo', async () => {
    const found = (
      await run(
        nutritionValidators,
        nutritionInput({ maxWeeklyWeightLossPct: 0.3 }),
        nutritionOutput(),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('por semana');
  });

  it('cardápio dentro da meta: quantidades ajustadas, totais e trocas equivalentes calculados', async () => {
    const input = nutritionInput();
    const output = nutritionOutput();
    expect(await run(nutritionValidators, input, output, ctx)).toEqual([]);
    const plan = finalizeNutrition(output, input);
    const breakfast = at(plan.meals, 0);
    const option = at(breakfast.options ?? [], 0);
    // Meta do café: 25% de ~2.000 kcal. As quantidades fecham a meta e viram múltiplos da medida.
    expect(Math.abs(option.totals.energyKcal - 500)).toBeLessThanOrEqual(60);
    const eggs = at(option.items, 0);
    expect(eggs.unit?.plural).toBe('ovos');
    expect(eggs.grams % 50).toBe(0);
    // A troca de frango pelo ovo mantém a energia do item (mesmo grupo de alimento).
    const swap = at(eggs.swaps, 0);
    expect(Math.abs(swap.energyKcal - eggs.energyKcal)).toBeLessThanOrEqual(40);
    expect(breakfast.examples[0]).toBe('Ovos com pão e banana');
    expect(plan.estimatedDailyCostBrl).toBeGreaterThan(0);
  });

  it('recusa cardápio com alimento fora da lista, sem as opções pedidas ou fora da meta', async () => {
    const outside = nutritionOutput();
    at(at(outside.meals, 1).options ?? [], 0).items = [draftItem('picanha', 300)];
    expect((await run(nutritionValidators, nutritionInput(), outside, ctx)).join(' | ')).toContain(
      'não está na lista permitida',
    );

    const few = nutritionOutput();
    at(few.meals, 0).options = at(few.meals, 0).options?.slice(0, 2);
    expect((await run(nutritionValidators, nutritionInput(), few, ctx)).join(' | ')).toContain(
      'traga 3 opções',
    );

    const lowProtein = nutritionOutput();
    at(at(lowProtein.meals, 2).options ?? [], 0).items = [
      draftItem('iogurte', 200),
      draftItem('banana', 60),
    ];
    expect(
      (await run(nutritionValidators, nutritionInput(), lowProtein, ctx)).join(' | '),
    ).toContain('de proteína e a meta da refeição');
  });

  it('recusa troca de outro grupo de alimento', async () => {
    const output = nutritionOutput();
    at(at(at(output.meals, 3).options ?? [], 0).items, 0).swaps = [swapOf('banana')];
    expect((await run(nutritionValidators, nutritionInput(), output, ctx)).join(' | ')).toContain(
      'não é uma troca equivalente',
    );
  });

  it('o custo do dia precisa caber no orçamento do aluno', async () => {
    const found = (
      await run(nutritionValidators, nutritionInput({ dailyBudgetBrl: 10 }), nutritionOutput(), ctx)
    ).join(' | ');
    expect(found).toContain('orçamento do aluno');
    expect(
      await run(
        nutritionValidators,
        nutritionInput({ dailyBudgetBrl: null }),
        nutritionOutput(),
        ctx,
      ),
    ).toEqual([]);
  });

  it('recusa custo implausível para a quantidade de comida', async () => {
    const output = nutritionOutput();
    at(at(output.meals, 1).options ?? [], 0).estimatedCostBrl = 0.5;
    expect((await run(nutritionValidators, nutritionInput(), output, ctx)).join(' | ')).toContain(
      'não é plausível',
    );
  });

  it('recusa alimento que contraria vegetarianismo, lactose ou alergia', async () => {
    const output = nutritionOutput();
    at(at(output.meals, 2).options ?? [], 0).items = [
      draftItem('iogurte', 200),
      draftItem('amendoim', 20),
      draftItem('ovo', 100),
    ];
    const state = {
      safety: { healthRecords: [{ kind: 'FOOD_ALLERGY', summary: 'amendoim (SEVERE_ALLERGY)' }] },
    };
    const found = (
      await run(
        nutritionValidators,
        nutritionInput({ dietaryRestrictions: ['VEGETARIAN', 'LACTOSE_FREE'] }),
        output,
        context(state, ['NUTRITION']),
      )
    ).join(' | ');
    expect(found).toContain('VEGETARIAN');
    expect(found).toContain('LACTOSE_FREE');
    expect(found).toContain('alergia/intolerância');
  });

  it('"leite vegetal" não conta como contrário à lactose', async () => {
    const output = nutritionOutput();
    at(at(output.meals, 0).options ?? [], 0).items = [
      draftItem('leite_vegetal', 300),
      draftItem('aveia', 40),
      draftItem('ovo', 150),
    ];
    const found = await run(
      nutritionValidators,
      nutritionInput({ dietaryRestrictions: ['LACTOSE_FREE'] }),
      output,
      ctx,
    );
    expect(found.filter((f) => f.includes('LACTOSE_FREE'))).toEqual([]);
  });

  it('suplemento fora da lista permitida é recusado', async () => {
    const output = nutritionOutput({
      supplements: [{ name: 'Pré-treino com cafeína', guidance: 'Antes do treino.' }],
    });
    const found = (await run(nutritionValidators, nutritionInput(), output, ctx)).join(' | ');
    expect(found).toContain('suplementos permitidos');
  });

  it('estratégia diferente da definida é recusada', async () => {
    const found = (
      await run(
        nutritionValidators,
        nutritionInput(),
        nutritionOutput({ strategy: 'SURPLUS' }),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('DEFICIT');
  });
});
