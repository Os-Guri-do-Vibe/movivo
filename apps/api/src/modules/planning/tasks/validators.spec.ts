import { describe, expect, it } from 'vitest';

import type { MethodologyParameters, PlanSession } from '@movivo/shared';

import type { ValidationContext, Violation } from '../../../core/agents/agent-task';
import { devMethodologyParameters } from '../../../core/database/seed-methodology';
import { hybridValidators, type HybridInput } from './hybrid';
import { hyroxValidators, type HyroxInput } from './hyrox';
import { nutritionValidators, type NutritionInput, type NutritionOutput } from './nutrition';
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
  foodBudget: 'MODERATE',
  mealsOutsideHomePerWeek: 3,
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
      examples: ['Ovos mexidos com pão integral'],
    },
    {
      slot: 'LUNCH',
      energyShare: 0.35,
      proteinG: 45,
      guidance: 'Prato completo',
      examples: ['Arroz, feijão e frango grelhado'],
    },
    {
      slot: 'AFTERNOON_SNACK',
      energyShare: 0.1,
      proteinG: 25,
      guidance: 'Lanche prático',
      examples: ['Iogurte com fruta'],
    },
    {
      slot: 'DINNER',
      energyShare: 0.3,
      proteinG: 50,
      guidance: 'Jantar leve',
      examples: ['Omelete com salada'],
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

  it('recusa exemplo que contraria vegetarianismo, lactose ou alergia', async () => {
    const output = nutritionOutput();
    at(output.meals, 1).examples = ['Arroz, feijão e frango grelhado'];
    at(output.meals, 2).examples = ['Iogurte com fruta'];
    const state = {
      safety: { healthRecords: [{ kind: 'FOOD_ALLERGY', summary: 'amendoim (SEVERE_ALLERGY)' }] },
    };
    at(output.meals, 3).examples = ['Salada com pasta de amendoim'];
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

  it('"leite vegetal" e "sem lactose" não contam como contrários', async () => {
    const output = nutritionOutput();
    at(output.meals, 2).examples = ['Iogurte sem lactose com fruta'];
    at(output.meals, 0).examples = ['Aveia com leite vegetal'];
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
