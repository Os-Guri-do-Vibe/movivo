import { describe, expect, it } from 'vitest';

import {
  RUNNING_WORKOUTS,
  RUNNING_WORKOUT_TYPES,
  type MethodologyParameters,
  type PlanSession,
  type RunningWorkoutType,
} from '@movivo/shared';

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
import { runningTask, runningValidators, type RunningInput } from './running';
import {
  minRunningSessions,
  strategyValidators,
  type StrategyInput,
  type StrategyOutput,
} from './strategy';
import {
  strengthTask,
  strengthValidators,
  type StrengthCandidate,
  type StrengthInput,
  strengthTimeBudget,
} from './strength';
import { blockOutputSchema, type BlockOutput } from './blocks';
import { strengthRules } from '../calc/params';
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
  externalSports: [],
  derived: {
    adiposity: 'MODERATE',
    bmi: 24,
    weeksToEvent: null,
    hasExternalSport: false,
    sessionLimits: {
      availableDays: 5,
      maxTrainingDays: 5,
      minRestDays: 1,
      allowTwoSessionsSameDay: true,
      maxSessions: 7,
    },
    ...over,
  },
});

const LIMITS_TIGHT = {
  availableDays: 4,
  maxTrainingDays: 4,
  minRestDays: 1,
  allowTwoSessionsSameDay: false,
  maxSessions: 4,
};

const strategyOutput = (energy: StrategyOutput['strategy']['energyStrategy']): StrategyOutput => ({
  strategy: {
    title: 'Ganho de massa',
    rationale: ['Objetivo declarado e disponibilidade permitem foco em força.'],
    energyStrategy: energy,
    modalityFocus: ['STRENGTH'],
    sessionPlan: {
      weekly: 3,
      byModality: [{ modality: 'STRENGTH', sessions: 3 }],
      reason: 'Três sessões dão estímulo suficiente e deixam dias de recuperação.',
    },
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

  describe('quem quer correr melhor (objetivo principal ou secundário)', () => {
    const corredor = () =>
      strategyInput({}, { primary: 'FAT_LOSS', secondary: ['HYPERTROPHY', 'RUNNING_PERFORMANCE'] });
    const comCorrida = (running: number, strength: number): StrategyOutput => {
      const output = strategyOutput('DEFICIT');
      output.strategy.modalityFocus = ['STRENGTH', 'RUNNING'];
      output.strategy.sessionPlan = {
        weekly: running + strength,
        byModality: [
          { modality: 'STRENGTH', sessions: strength },
          { modality: 'RUNNING', sessions: running },
        ],
        reason: 'Divisão da semana.',
      };
      output.tasks = [
        {
          kind: 'COMPLETE_SESSIONS',
          title: 'Treinar',
          cadence: 'WEEKLY',
          target: running + strength,
        },
      ];
      return output;
    };
    const withModalities = (input: StrategyInput): StrategyInput => ({
      ...input,
      modalities: [
        { modality: 'STRENGTH', level: 'ADVANCED', wantsToStart: false },
        { modality: 'RUNNING', level: 'BEGINNER', wantsToStart: false },
      ],
    });

    it('duas corridas em cinco sessões é pouco: pede ao menos três', async () => {
      const found = (
        await run(strategyValidators, withModalities(corredor()), comCorrida(2, 3), context())
      ).join(' | ');
      expect(found).toContain('a corrida precisa de pelo menos 3');
    });

    it('três corridas e duas musculações em cinco sessões passa', async () => {
      const found = await run(
        strategyValidators,
        withModalities(corredor()),
        comCorrida(3, 2),
        context(),
      );
      expect(found.filter((f) => f.includes('corrida'))).toEqual([]);
    });

    it('o foco precisa incluir corrida mesmo com o objetivo só secundário', async () => {
      const output = strategyOutput('DEFICIT');
      const found = (
        await run(strategyValidators, withModalities(corredor()), output, context())
      ).join(' | ');
      expect(found).toContain('RUNNING precisa estar no foco');
    });

    it('o mínimo cresce com o papel da corrida na semana', () => {
      expect(minRunningSessions(5, false, true)).toBe(3);
      expect(minRunningSessions(4, false, true)).toBe(2);
      expect(minRunningSessions(3, false, true)).toBe(1);
      expect(minRunningSessions(5, true, true)).toBe(3);
      expect(minRunningSessions(4, true, true)).toBe(2);
      expect(minRunningSessions(3, false, false)).toBe(3);
    });
  });

  it('a mensagem não cita dias da semana', async () => {
    const output = strategyOutput('SURPLUS');
    output.studentMessage = 'Treinos na segunda, quarta e sexta.';
    const found = (await run(strategyValidators, strategyInput(), output, context())).join(' | ');
    expect(found).toContain('não cite dias da semana');
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
    expect(found.join(' ')).toContain('acima do que o plano prevê');
    expect(found.join(' ')).toContain('guardrail');
  });

  describe('frequência semanal decidida pela MOVIVO', () => {
    const withPlan = (plan: StrategyOutput['strategy']['sessionPlan']) => {
      const output = strategyOutput('MAINTENANCE');
      output.strategy.sessionPlan = plan;
      return output;
    };

    it('plano dentro do teto e com a divisão certa passa', async () => {
      expect(
        await run(strategyValidators, strategyInput(), strategyOutput('MAINTENANCE'), context()),
      ).toEqual([]);
    });

    it('soma da divisão diferente do total é recusada', async () => {
      const found = await run(
        strategyValidators,
        strategyInput(),
        withPlan({
          weekly: 4,
          byModality: [{ modality: 'STRENGTH', sessions: 3 }],
          reason: 'Quatro sessões.',
        }),
        context(),
      );
      expect(found.join(' ')).toContain('soma da divisão');
    });

    it('a divisão precisa trazer as modalidades do foco, uma vez cada', async () => {
      const found = await run(
        strategyValidators,
        strategyInput(),
        withPlan({
          weekly: 3,
          byModality: [
            { modality: 'STRENGTH', sessions: 2 },
            { modality: 'RUNNING', sessions: 1 },
          ],
          reason: 'Mistura.',
        }),
        context(),
      );
      expect(found.join(' ')).toContain('modalidades do foco');
    });

    it('passar do teto de dias e descanso é recusado, mesmo que o aluno tenha dias livres', async () => {
      const found = await run(
        strategyValidators,
        strategyInput({ sessionLimits: LIMITS_TIGHT }),
        withPlan({
          weekly: 6,
          byModality: [{ modality: 'STRENGTH', sessions: 6 }],
          reason: 'Seis sessões.',
        }),
        context(),
      );
      expect(found.join(' ')).toContain('passam do teto de 4');
    });

    it('sessão dupla sem permissão da metodologia é recusada', async () => {
      const found = await run(
        strategyValidators,
        strategyInput({ sessionLimits: { ...LIMITS_TIGHT, maxSessions: 6 } }),
        withPlan({
          weekly: 5,
          byModality: [{ modality: 'STRENGTH', sessions: 5 }],
          reason: 'Cinco sessões.',
        }),
        context(),
      );
      expect(found.join(' ')).toContain('sessão dupla');
    });
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

  describe('ênfase muscular escolhida pelo aluno', () => {
    // O validador só exige grupos com ao menos 3 exercícios viáveis.
    const candidates = ['', '_b', '_c'].flatMap((suffix) =>
      CANDIDATES.map((c) => ({ ...c, id: `${c.id}${suffix}` })),
    );
    const withGluteSets = (sets: number) =>
      block(
        ['A', 'B'].map((key) =>
          strengthSession(
            key,
            FULL_BODY.map((e) => (e.id === 'elevacao_pelvica' ? { ...e, sets } : e)),
            { estimatedMinutes: 65 },
          ),
        ),
      );

    it('grupo de ênfase com volume abaixo da média dos demais é recusado', async () => {
      const input = strengthInput({ candidates, emphasisMuscleGroups: ['glúteo'] });
      const found = (await run(strengthValidators, input, withGluteSets(2), ctx)).join(' | ');
      expect(found).toContain('glúteo é ênfase pedida pelo aluno');
    });

    it('grupo de ênfase com ao menos a média dos demais passa', async () => {
      const input = strengthInput({ candidates, emphasisMuscleGroups: ['glúteo'] });
      expect(await run(strengthValidators, input, withGluteSets(5), ctx)).toEqual([]);
    });

    it('sem ênfase escolhida nada é exigido', async () => {
      expect(await run(strengthValidators, strengthInput(), withGluteSets(2), ctx)).not.toContain(
        'ênfase',
      );
    });

    it('a ênfase do aluno vem antes da avaliação por foto no prompt', () => {
      expect(strengthTask.instructions).toMatch(
        /ALUNO escolheu e ela vem SEMPRE em primeiro lugar/,
      );
      expect(strengthTask.instructions).toMatch(/Hierarquia: o objetivo declarado/);
    });
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

  describe('descanso por tipo de exercício', () => {
    const withCore = strengthInput({
      candidates: [
        ...strengthInput().candidates,
        candidate('prancha', 'core', 'CORE'),
        candidate('abdominal', 'core', 'CORE'),
      ],
    });
    const sessionsWith = (extra: { id: string; sets: number; rest: number }) =>
      block([
        strengthSession('A', [...FULL_BODY, extra], { estimatedMinutes: 70 }),
        strengthSession('B', FULL_BODY, { estimatedMinutes: 65 }),
      ]);

    it('core descansa como isolado: 60 s numa prancha passa', async () => {
      const found = await run(
        strengthValidators,
        withCore,
        sessionsWith({ id: 'prancha', sets: 2, rest: 60 }),
        ctx,
      );
      expect(found.join(' | ')).not.toContain('descanso');
    });

    it('core abaixo do mínimo de isolado é recusado e a mensagem diz a classificação', async () => {
      const found = (
        await run(
          strengthValidators,
          withCore,
          sessionsWith({ id: 'abdominal', sets: 2, rest: 30 }),
          ctx,
        )
      ).join(' | ');
      expect(found).toContain(
        'descanso de 30s em "abdominal" fora da faixa de core (descansa como isolado) (60–300s)',
      );
    });

    it('multiarticular com descanso de isolado é recusado, com nome e faixa efetiva', async () => {
      const output = block([
        strengthSession('A', [{ ...at(FULL_BODY, 0), rest: 60 }, ...FULL_BODY.slice(1)], {
          estimatedMinutes: 65,
        }),
        strengthSession('B', FULL_BODY, { estimatedMinutes: 65 }),
      ]);
      const found = (await run(strengthValidators, strengthInput(), output, ctx)).join(' | ');
      expect(found).toContain(
        'descanso de 60s em "supino" fora da faixa de multiarticular (90–300s)',
      );
    });

    it('o prompt diz que CORE descansa na faixa de isolado', () => {
      expect(strengthTask.instructions).toContain(
        'ISOLATION e CORE (abdominal, prancha, lombar) descansam na faixa de isolado',
      );
    });
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
    // A correção pede o mínimo real e diz de onde tirar, não o piso cheio (que estoura o tempo).
    expect(found).toMatch(/quadríceps com 0 séries\/semana; o mínimo exigido é \d+/);
    expect(found).toContain('tire séries dos grupos acima');
  });
});

describe('strength.build_block — orçamento de tempo', () => {
  const ctx = context({}, ['STRENGTH']);
  const rules = strengthRules(devMethodologyParameters('STRENGTH'), 'ADVANCED');
  // Os 6 grupos principais com 3 opções cada, como numa academia completa.
  const sixGroups = [
    'peito',
    'costas',
    'ombro',
    'quadríceps',
    'posterior de coxa',
    'glúteo',
  ].flatMap((group) =>
    [1, 2, 3].map((n) => ({
      id: `${group}-${n}`,
      name: `${group} ${n}`,
      pattern: 'HORIZONTAL_PUSH',
      muscleGroups: [group],
      equipment: [],
      measurement: 'REPS' as const,
    })),
  );

  it('2 sessões de 45 min (o caso do Rodrigo): cabem 19 séries com o descanso mínimo; o mínimo por grupo cabe', () => {
    const budget = strengthTimeBudget(
      strengthInput({
        level: 'ADVANCED',
        sessionsPerWeek: 2,
        minutesPerSession: 45,
        candidates: sixGroups,
      }),
      rules,
    );
    expect(budget.restSeconds).toEqual({ compound: 90, isolation: 60 });
    expect(budget.maxSetsPerSession).toBe(19);
    // 6 grupos principais × mínimo cabe em 2 sessões de 19 séries.
    expect(budget.minWeeklySetsPerMajorGroup * 6).toBeLessThanOrEqual(19 * 2);
  });

  it('sessão curta: o piso de volume desce para o que cabe, em vez de exigir o impossível', () => {
    const full = strengthTimeBudget(
      strengthInput({
        level: 'ADVANCED',
        sessionsPerWeek: 2,
        minutesPerSession: 60,
        candidates: sixGroups,
      }),
      rules,
    );
    const short = strengthTimeBudget(
      strengthInput({
        level: 'ADVANCED',
        sessionsPerWeek: 2,
        minutesPerSession: 25,
        candidates: sixGroups,
      }),
      rules,
    );
    expect(short.minWeeklySetsPerMajorGroup).toBeLessThan(full.minWeeklySetsPerMajorGroup);
    expect(short.minWeeklySetsPerMajorGroup * 6).toBeLessThanOrEqual(short.maxSetsPerSession * 2);
  });

  it('18 séries em 45 min passam com o descanso mínimo; a correção manda descansar menos antes de cortar', async () => {
    const minRest = FULL_BODY.map((e) => ({ ...e, sets: 3, rest: 90 }));
    const fits = block([
      strengthSession('A', minRest, { estimatedMinutes: 45 }),
      strengthSession('B', minRest, { estimatedMinutes: 45 }),
    ]);
    const input = strengthInput({ level: 'ADVANCED', sessionsPerWeek: 2, minutesPerSession: 45 });
    let found = (await run(strengthValidators, input, fits, ctx)).join(' | ');
    expect(found).not.toContain('somam');

    const longRest = FULL_BODY.map((e) => ({ ...e, sets: 3, rest: 150 }));
    found = (
      await run(
        strengthValidators,
        input,
        block([
          strengthSession('A', longRest, { estimatedMinutes: 45 }),
          strengthSession('B', longRest, { estimatedMinutes: 45 }),
        ]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('Antes de cortar séries, use o descanso mínimo da metodologia (90 s');
    expect(found).toContain('cabem até 19 séries');
  });
});

describe('strength.build_block — cardio da OMS', () => {
  const ctx = context({}, ['STRENGTH']);
  const cardio = {
    targetMinutes: 150,
    coveredMinutes: 0,
    weeklyMinutes: 40,
    perSessionMinutes: { min: 10, max: 20 },
    leftoverMinutes: 110,
    candidates: [
      { id: 'esteira', name: 'Esteira', intensity: 'MODERATE' as const },
      { id: 'hiit', name: 'HIIT', intensity: 'VIGOROUS' as const },
    ],
  };
  const withCardio = (
    key: string,
    cardioExercises: { id: string; minutes: number }[],
    over: Partial<PlanSession> = {},
  ): PlanSession => {
    const session = strengthSession(key, FULL_BODY, { estimatedMinutes: 70, ...over });
    (session.content as { exercises: object[] }).exercises.push(
      ...cardioExercises.map((c) => ({
        exerciseId: c.id,
        name: c.id,
        sets: 1,
        durationSeconds: c.minutes * 60,
        loadStrategy: 'BODYWEIGHT',
        restSeconds: 0,
      })),
    );
    return session;
  };
  const input = () => strengthInput({ cardio, sessionsPerWeek: 2, minutesPerSession: 90 });

  it('aceita o cardio no fim de cada sessão, somando a meta da semana', async () => {
    const output = block([
      withCardio('A', [{ id: 'esteira', minutes: 20 }]),
      withCardio('B', [{ id: 'esteira', minutes: 20 }]),
    ]);
    const found = (await run(strengthValidators, input(), output, ctx)).join(' | ');
    expect(found).not.toContain('cardio');
  });

  it('recusa cardio abaixo da meta, concentrado numa sessão ou fora do fim', async () => {
    const pouco = block([
      withCardio('A', [{ id: 'esteira', minutes: 10 }]),
      strengthSession('B', FULL_BODY, { estimatedMinutes: 70 }),
    ]);
    let found = (await run(strengthValidators, input(), pouco, ctx)).join(' | ');
    expect(found).toContain('de cardio na semana; a meta para as sessões é 40 min');
    expect(found).toContain('distribua em pelo menos 2');

    const noMeio = withCardio('A', [{ id: 'esteira', minutes: 20 }]);
    const exercises = (noMeio.content as { exercises: object[] }).exercises;
    exercises.unshift(exercises.pop() as object);
    found = (
      await run(
        strengthValidators,
        input(),
        block([noMeio, withCardio('B', [{ id: 'esteira', minutes: 20 }])]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('o cardio vai no fim da sessão');
  });

  it('recusa cardio acima da faixa por sessão e vigoroso demais', async () => {
    let found = (
      await run(
        strengthValidators,
        input(),
        block([
          withCardio('A', [{ id: 'esteira', minutes: 30 }]),
          withCardio('B', [{ id: 'esteira', minutes: 10 }]),
        ]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('cardio de 30 min na sessão; a faixa é 10–20 min');

    found = (
      await run(
        strengthValidators,
        input(),
        block([
          withCardio('A', [{ id: 'hiit', minutes: 20 }]),
          withCardio('B', [{ id: 'esteira', minutes: 10 }]),
        ]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('metade do cardio da semana pode ser vigoroso');
  });

  it('cardio por repetições é recusado e sem meta o exercício de cardio não existe', async () => {
    const porReps = withCardio('A', [{ id: 'esteira', minutes: 20 }]);
    const last = (porReps.content as { exercises: Record<string, unknown>[] }).exercises.at(-1);
    if (last) {
      delete last.durationSeconds;
      last.reps = { min: 10, max: 12 };
    }
    let found = (
      await run(
        strengthValidators,
        input(),
        block([porReps, withCardio('B', [{ id: 'esteira', minutes: 20 }])]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('cardio é prescrito por tempo');

    found = (
      await run(
        strengthValidators,
        strengthInput({ sessionsPerWeek: 2, minutesPerSession: 90 }),
        block([
          withCardio('A', [{ id: 'esteira', minutes: 20 }]),
          strengthSession('B', FULL_BODY, { estimatedMinutes: 70 }),
        ]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('"esteira" não está entre os exercícios permitidos');
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
  venue: 'OUTDOOR',
  starter: false,
  weekRoles: ['EASY', 'EASY', 'LONG'],
  workouts: RUNNING_WORKOUT_TYPES.filter((type) => RUNNING_WORKOUTS[type].scope === 'RUNNING').map(
    (type) => {
      const spec = RUNNING_WORKOUTS[type];
      return {
        type,
        label: spec.label,
        kind: spec.kind,
        intensity: spec.intensity,
        stimulus: spec.stimulus,
        objective: spec.objective,
        adaptation: spec.adaptation,
        needsPaceAnchor: spec.needsPaceAnchor,
        ...(spec.terrain ? { terrain: spec.terrain } : {}),
      };
    },
  ),
  ...over,
});

/** Treino do catálogo de cada sessão de teste (a chave identifica o papel na semana). */
const WORKOUT_BY_KEY: Record<string, RunningWorkoutType> = {
  FACIL1: 'EASY_RUN',
  FACIL2: 'RUNNING_ECONOMY',
  LONGAO: 'LONG_RUN',
  Q1: 'AEROBIC_INTERVALS',
  Q2: 'TEMPO_RUN',
};

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
    content: {
      modality: 'RUNNING',
      kind,
      workoutType: WORKOUT_BY_KEY[key],
      segments,
      terrain: 'ANY',
    },
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

  const warmupWorkCooldown = [
    { type: 'WARMUP', durationSeconds: 600, target: { by: 'ZONE', zone: 'Z1' } },
    {
      type: 'WORK',
      repeat: 6,
      durationSeconds: 60,
      target: { by: 'RPE', rpe: { min: 6, max: 7 } },
    },
    { type: 'RECOVERY', repeat: 6, durationSeconds: 120, target: { by: 'ZONE', zone: 'Z1' } },
    { type: 'COOLDOWN', durationSeconds: 600, target: { by: 'ZONE', zone: 'Z1' } },
  ];

  it('cada sessão precisa ser um treino do catálogo, na classe e no terreno certos', async () => {
    const semTipo = runSession('FACIL1', 'EASY', easy(4_000));
    (semTipo.content as { workoutType?: string }).workoutType = undefined;
    let found = (
      await run(
        runningValidators,
        runningInput(),
        block([semTipo, runSession('LONGAO', 'LONG', easy(5_000))]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('informe o treino do catálogo');

    const input = runningInput({
      workouts: runningInput().workouts.filter((w) => w.type !== 'RUNNING_ECONOMY'),
    });
    found = (
      await run(
        runningValidators,
        input,
        block([
          runSession('FACIL2', 'EASY', easy(4_000)),
          runSession('LONGAO', 'LONG', easy(5_000)),
        ]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('não está disponível para este aluno');

    const classeErrada = runSession('FACIL1', 'LONG', easy(4_000));
    found = (
      await run(
        runningValidators,
        runningInput(),
        block([classeErrada, runSession('LONGAO', 'LONG', easy(5_000))]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('é da classe EASY, não LONG');

    const subida = runSession('Q1', 'INTERVALS', warmupWorkCooldown, { estimatedRpe: 7 });
    (subida.content as { workoutType?: string }).workoutType = 'HILL_REPEATS';
    (subida.content as { kind: string }).kind = 'HILLS';
    found = (
      await run(
        runningValidators,
        runningInput(),
        block([subida, runSession('LONGAO', 'LONG', easy(5_000))]),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('pede terreno HILLS');
  });

  it('a semana pede qualidade e longão: só corrida leve é recusada, e com qualidade passa', async () => {
    const roles = runningInput({ weekRoles: ['QUALITY', 'LONG', 'EASY'] });
    const soLeve = block([
      runSession('FACIL1', 'EASY', easy(3_000)),
      runSession('FACIL2', 'EASY', easy(3_000)),
    ]);
    const found = (await run(runningValidators, roles, soLeve, ctx)).join(' | ');
    expect(found).toContain('a semana pede 1 sessão(ões) de qualidade');
    expect(found).toContain('um longão');

    const estruturada = block([
      runSession('Q1', 'INTERVALS', warmupWorkCooldown, { estimatedRpe: 7 }),
      runSession('FACIL1', 'EASY', easy(3_000)),
      runSession('LONGAO', 'LONG', easy(4_000), { estimatedMinutes: 50 }),
    ]);
    expect(await run(runningValidators, roles, estruturada, ctx)).toEqual([]);
  });

  it('recusa a semana com o mesmo treino repetido', async () => {
    const mesmoTreino = (key: string) => {
      const session = runSession(key, 'EASY', easy(3_000));
      (session.content as { workoutType?: string }).workoutType = 'EASY_RUN';
      return session;
    };
    const found = (
      await run(
        runningValidators,
        runningInput({ weekRoles: ['EASY', 'EASY', 'EASY'] }),
        block(
          [mesmoTreino('FACIL1'), mesmoTreino('FACIL2'), mesmoTreino('FACIL3')].map((s) => ({
            ...s,
            weeklyFrequency: 1,
          })),
        ),
        ctx,
      )
    ).join(' | ');
    expect(found).toContain('varie os estímulos');
  });

  it('o contrato de texto do bloco está nas instruções: poucas notas, curtas', () => {
    // O contrato recusa nota com mais de 300 caracteres; a instrução pede até 250, no máximo 5.
    expect(runningTask.instructions).toContain('MÁXIMO 5 notas');
    expect(runningTask.instructions).toContain('MÁXIMO 250 caracteres');
    const notes = blockOutputSchema.shape.notes;
    expect(notes.safeParse(Array.from({ length: 5 }, () => 'x'.repeat(250))).success).toBe(true);
    expect(notes.safeParse(['x'.repeat(301)]).success).toBe(false);
  });

  it('o texto não cita dia da semana (a agenda é do sistema), mas ordinais passam', async () => {
    const output = block([
      runSession('FACIL1', 'EASY', easy(3_000)),
      runSession('FACIL2', 'EASY', easy(3_000)),
      runSession('LONGAO', 'LONG', easy(4_000), { estimatedMinutes: 50 }),
    ]);
    output.summary = 'Corrida leve terça e sábado, com revisão na quarta semana.';
    const found = (await run(runningValidators, runningInput(), output, ctx)).join(' | ');
    expect(found).toContain('não cite dias da semana');
    output.summary = 'Três corridas por semana, com revisão na quarta semana e na segunda sessão.';
    expect(await run(runningValidators, runningInput(), output, ctx)).toEqual([]);
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
  /** Proteína da 2ª opção (o cardápio real varia a proteína entre as opções). */
  alternative?: ReturnType<typeof draftItem>,
) =>
  titles.map((title, index) => ({
    title,
    estimatedCostBrl: cost,
    items: alternative && index === 1 ? [alternative, ...items.slice(1)] : items,
  }));

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
        draftItem('tilapia', 100, ['frango']),
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
        draftItem('frango', 130, ['tilapia']),
      ),
    },
  ],
  guidelines: ['Beba água ao longo do dia.'],
  supplements: [{ name: 'Creatina', guidance: 'Uso diário, conforme orientação.' }],
  freeMeals: {
    perWeek: 1,
    options: [
      {
        title: 'Combo de hambúrguer',
        description: 'Hambúrguer artesanal com batata frita média',
        energyKcal: 950,
        fitTip: 'No dia, capriche na proteína do almoço e deixe o lanche leve.',
      },
      {
        title: 'Pizza',
        description: '3 fatias (calabresa, margherita, frango com catupiry)',
        energyKcal: 850,
        fitTip: 'Faça uma salada grande antes e um jantar simples no dia seguinte.',
      },
      {
        title: 'Sushi',
        description: '14 peças variadas e 1 temaki',
        energyKcal: 800,
        fitTip: 'Boa proteína já vem junto: mantenha o café da manhã leve.',
      },
    ],
    guidance: 'Pode escolher outra refeição livre: me conte no WhatsApp e eu ajudo a encaixar.',
  },
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

  describe('refeições livres', () => {
    const free = nutritionOutput().freeMeals;
    if (!free) throw new Error('fixture sem refeições livres');
    const found = async (output: ReturnType<typeof nutritionOutput>, input = nutritionInput()) =>
      (await run(nutritionValidators, input, output, ctx)).join(' | ');

    it('exige o planejamento das refeições livres', async () => {
      expect(await found(nutritionOutput({ freeMeals: undefined }))).toContain('freeMeals');
    });

    it('em déficit, no máximo uma por semana', async () => {
      const input = nutritionInput({ strategy: 'DEFICIT' });
      const output = nutritionOutput({ strategy: 'DEFICIT', freeMeals: { ...free, perWeek: 2 } });
      expect(await found(output, input)).toContain('no máximo 1 refeição livre');
    });

    it('recusa opção que passa de metade do dia e linguagem de culpa', async () => {
      const [first, ...rest] = free.options;
      if (!first) throw new Error('fixture');
      const heavy = nutritionOutput({
        freeMeals: {
          ...free,
          options: [{ ...first, energyKcal: 1_800 }, ...rest] as typeof free.options,
        },
      });
      expect(await found(heavy)).toContain('metade do dia');
      const guilty = nutritionOutput({
        freeMeals: { ...free, guidance: 'É o dia liberado, depois você compensa na dieta.' },
      });
      expect(await found(guilty)).toContain('culpa ou proibição');
    });

    it('com histórico de transtorno alimentar não há refeição livre', async () => {
      const blocked = context(
        {
          safety: {
            activeSignals: [],
            healthRecords: [{ kind: 'EATING_DISORDER_HISTORY', summary: 'histórico' }],
          },
        },
        ['NUTRITION'],
      );
      const withFree = (
        await run(nutritionValidators, nutritionInput(), nutritionOutput(), blocked)
      ).join(' | ');
      expect(withFree).toContain('não planeje refeição livre');
      const without = await run(
        nutritionValidators,
        nutritionInput(),
        nutritionOutput({ freeMeals: undefined }),
        blocked,
      );
      expect(without.join(' | ')).not.toContain('freeMeals');
    });
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

  it('qualidade do cardápio: almoço e jantar levam vegetais, o dia leva fruta, proteínas variam', async () => {
    const base = nutritionOutput();
    const withoutFood = (foodId: string) => ({
      ...base,
      meals: base.meals.map((meal) => ({
        ...meal,
        options: meal.options?.map((option) => ({
          ...option,
          items: option.items.filter((item) => item.foodId !== foodId),
        })),
      })),
    });
    const noVeg = (
      await run(nutritionValidators, nutritionInput(), withoutFood('alface'), ctx)
    ).join(' | ');
    expect(noVeg).toContain('legumes ou verduras');
    const noFruit = (
      await run(nutritionValidators, nutritionInput(), withoutFood('banana'), ctx)
    ).join(' | ');
    expect(noFruit).toContain('inclua fruta');
    // Sem fruta na lista do aluno, a regra não cobra o impossível.
    const foodsNoFruit = FOODS.filter((f) => f.id !== 'banana');
    expect(
      (
        await run(
          nutritionValidators,
          nutritionInput({ foods: foodsNoFruit }),
          withoutFood('banana'),
          ctx,
        )
      ).join(' | '),
    ).not.toContain('inclua fruta');
    const samePrimaryProtein = {
      ...base,
      meals: base.meals.map((meal) => {
        const first = meal.options?.[0];
        return meal.slot === 'LUNCH' && first
          ? { ...meal, options: meal.options?.map((o) => ({ ...first, title: o.title })) }
          : meal;
      }),
    };
    expect(
      (await run(nutritionValidators, nutritionInput(), samePrimaryProtein, ctx)).join(' | '),
    ).toContain('repetem a mesma proteína');
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
