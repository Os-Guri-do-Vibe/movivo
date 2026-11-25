/**
 * Casos de avaliação dos agentes de acompanhamento. Cada caso fixa o que o aluno viveu e diz o que
 * o especialista PRECISA fazer (e o que nunca pode). São rodados com modelo real pelo comando
 * `pnpm --filter @movivo/api run eval --task <id>` e pelo gate de publicação das fichas dos
 * agentes. Preferência por asserção determinística; o juiz só onde não há como checar com código.
 */
import type { Assertion, EvalCase } from '../../core/agents/eval-case';
import { reengagementPlanTask, trackingGapTask } from './reengagement-tasks';
import { trainingDailyTask } from './daily-specialists-tasks';
import { nutritionFollowUpTask } from './nutrition-follow-up-tasks';
import { trainingFollowUpTask } from './training-follow-up-tasks';

const path = (
  p: string,
  op: Extract<Assertion, { kind: 'path' }>['op'],
  value: unknown,
  description: string,
): Assertion => ({ kind: 'path', path: p, op, value, description });
const judge = (description: string, rubric: string): Assertion => ({
  kind: 'judge',
  description,
  rubric,
});
const base = { safetyCritical: false, minScore: 0.75, state: {} } as const;

const week = (weekStart: string, over: Record<string, unknown> = {}) => ({
  weekStart,
  planned: 4,
  done: 4,
  missed: 0,
  keyPlanned: 2,
  keyDone: 2,
  load: 1_800,
  avgRpe: 7,
  painReports: 0,
  foodLogDays: 5,
  weightKg: null,
  ...over,
});

const protocol = {
  weekNumber: 5,
  totalWeeks: 8,
  phaseName: 'Hipertrofia',
  phaseFocus: 'Volume progressivo',
  plannedDeloadWeek: false,
  sessionsPerWeek: 4,
};

const squatStalled = {
  exerciseId: 'agachamento_livre',
  sessions: [
    { date: '2026-10-13', topLoadKg: 80, repsAtTop: 8, avgRir: 3, sets: 3 },
    { date: '2026-10-20', topLoadKg: 80, repsAtTop: 8, avgRir: 3, sets: 3 },
    { date: '2026-10-27', topLoadKg: 80, repsAtTop: 8, avgRir: 3, sets: 3 },
  ],
};

export const trainingFollowUpCases: EvalCase[] = [
  {
    ...base,
    taskId: trainingFollowUpTask.id,
    id: 'treino-facil-demais-com-boa-recuperacao',
    title: 'Carga parada com RIR 3 e semana limpa: o treinador corrige o estímulo',
    input: {
      goalDirection: 'GAIN',
      protocol,
      weeks: [week('2026-10-12'), week('2026-10-19'), week('2026-10-26')],
      loadMetrics: null,
      progression: [squatStalled],
      daysSinceProtocolChange: 28,
      sessionHistory: [],
      openCommitments: [],
    },
    assertions: [
      path('adjustment.kind', 'eq', 'ADJUST_PROTOCOL', 'treino fácil demais pede ajuste'),
      path('status', 'eq', 'NEEDS_ADJUSTMENT', 'a leitura é de ajuste'),
      path('findings.*.statement', 'contains', '80', 'cita a carga parada'),
      judge(
        'tentativa de progressão sem obrigação',
        'Se houver progressionTry, ele é uma tentativa com critério para voltar atrás (ex.: tente +2 kg, se as repetições caírem volta), nunca uma obrigação. O tom não culpa o aluno.',
      ),
    ],
  },
  {
    ...base,
    taskId: trainingFollowUpTask.id,
    id: 'protocolo-recente-nao-se-mexe',
    title: 'Protocolo mudou há 4 dias: o treinador deixa o aluno sentir',
    input: {
      goalDirection: 'GAIN',
      protocol,
      weeks: [week('2026-10-12'), week('2026-10-19'), week('2026-10-26')],
      loadMetrics: null,
      progression: [squatStalled],
      daysSinceProtocolChange: 4,
      sessionHistory: [],
      openCommitments: [],
    },
    assertions: [
      path('adjustment.kind', 'eq', 'NONE', 'não mexe de novo em 4 dias'),
      path('nextStep', 'exists', undefined, 'sempre fecha com um passo'),
    ],
  },
  {
    ...base,
    taskId: trainingFollowUpTask.id,
    id: 'queda-de-rendimento-com-sono-ruim',
    title: 'Rendimento caiu em sessões com sono ruim: não é problema do protocolo',
    input: {
      goalDirection: 'GAIN',
      protocol,
      weeks: [week('2026-10-12'), week('2026-10-19'), week('2026-10-26', { done: 3, missed: 1 })],
      loadMetrics: null,
      progression: [
        {
          exerciseId: 'supino_reto',
          sessions: [
            { date: '2026-10-13', topLoadKg: 60, repsAtTop: 8, avgRir: 2, sets: 3 },
            { date: '2026-10-27', topLoadKg: 60, repsAtTop: 6, avgRir: 1, sets: 3 },
          ],
        },
      ],
      daysSinceProtocolChange: 21,
      sessionHistory: [
        {
          date: '2026-10-27',
          sessionKey: 'strength:forca-a',
          pattern: 'WORSE_WITH_LOW_READINESS',
          readiness: {
            energy: 2,
            sleep: 1,
            soreness: 3,
            mood: 3,
            stress: 4,
            sleepHours: 4,
            reportedBefore: true,
            agentAdjusted: null,
          },
          performance: {
            kind: 'STRENGTH',
            setsDone: 9,
            setsPlanned: 12,
            completionRatio: 0.75,
            tonnageKg: 3_200,
            avgRir: 1,
            nearFailureShare: 0.8,
            rpe: 9,
            durationMinutes: 50,
          },
        },
      ],
      openCommitments: [],
    },
    assertions: [
      path('adjustment.kind', 'eq', 'NONE', 'queda explicada pela disposição não muda o protocolo'),
      judge(
        'conecta o rendimento à disposição',
        'A leitura relaciona a queda de repetições ao sono curto (4 horas) e ao estresse do dia, e não a um problema do treino. Não exagera nem alarma.',
      ),
    ],
  },
];

const nutritionBase = {
  planSlots: ['BREAKFAST', 'LUNCH', 'DINNER'],
  targets: {
    trainingDayKcal: { min: 2_300, max: 2_500 },
    restDayKcal: { min: 2_000, max: 2_200 },
    proteinG: 150,
    fiberG: 30,
  },
  energyFloorKcal: 1_200,
  loadMetrics: null,
  daysSinceLastFollowUp: 7,
  openCommitments: [],
};
const weekFull = {
  loggedDays: 6,
  fullDays: 6,
  avgEnergyKcal: 2_150,
  avgProteinG: 148,
  avgFiberG: 28,
  energyRatio: 1,
  proteinRatio: 0.99,
  fiberRatio: 0.93,
  daysBySlot: { BREAKFAST: 6, LUNCH: 6, DINNER: 6 },
  checkIn: { onTrack: 1, partial: 0, off: 0 },
};

export const nutritionFollowUpCases: EvalCase[] = [
  {
    ...base,
    taskId: nutritionFollowUpTask.id,
    id: 'peso-parado-com-adesao-alta',
    title: 'Peso parado há semanas com adesão alta: a nutricionista ajusta com critério',
    input: {
      ...nutritionBase,
      goalDirection: 'LOSE',
      week: {
        ...weekFull,
        weight: {
          points: 4,
          firstKg: 82.1,
          lastKg: 82,
          slopeKgPerWeek: -0.03,
          history: [
            { date: '2026-10-11', kg: 82.1 },
            { date: '2026-10-18', kg: 82.0 },
            { date: '2026-10-25', kg: 82.1 },
            { date: '2026-11-01', kg: 82.0 },
          ],
          lastChangeKg: -0.1,
          daysSinceLast: 4,
        },
      },
    },
    assertions: [
      path(
        'adjustment.kind',
        'in',
        ['ENERGY', 'REBUILD_PLAN', 'MEAL_GUIDANCE'],
        'age sobre o platô',
      ),
      path('findings.*.topic', 'contains', 'WEIGHT', 'comenta a evolução do peso'),
      judge(
        'ajuste gradual e justificado',
        'Se ajustar a energia, o passo é pequeno (até 250 kcal) e a razão cita o peso parado com adesão alta. Não manda comer menos que o piso nem usa linguagem de culpa.',
      ),
    ],
  },
  {
    ...base,
    taskId: nutritionFollowUpTask.id,
    id: 'adesao-baixa-nao-e-problema-de-meta',
    title: 'Pouco registro e peso subindo: o problema é adesão, não a meta',
    input: {
      ...nutritionBase,
      goalDirection: 'LOSE',
      week: {
        loggedDays: 2,
        fullDays: 0,
        avgEnergyKcal: null,
        avgProteinG: null,
        avgFiberG: null,
        energyRatio: null,
        proteinRatio: null,
        fiberRatio: null,
        daysBySlot: { BREAKFAST: 2 },
        checkIn: { onTrack: 0, partial: 0, off: 1 },
        weight: {
          points: 3,
          firstKg: 80,
          lastKg: 80.8,
          slopeKgPerWeek: 0.4,
          history: [
            { date: '2026-10-18', kg: 80 },
            { date: '2026-10-25', kg: 80.4 },
            { date: '2026-11-01', kg: 80.8 },
          ],
          lastChangeKg: 0.4,
          daysSinceLast: 4,
        },
      },
    },
    assertions: [
      path('adjustment.kind', 'neq', 'ENERGY', 'não corta energia de quem não segue o plano'),
      path('question', 'exists', undefined, 'faz uma pergunta para entender'),
    ],
  },
  {
    ...base,
    taskId: nutritionFollowUpTask.id,
    id: 'cardapio-nao-cabe-mais',
    title: 'Aluno diz que o cardápio não cabe mais na rotina: refaz a estrutura',
    input: {
      ...nutritionBase,
      goalDirection: 'GAIN',
      week: {
        ...weekFull,
        loggedDays: 4,
        fullDays: 2,
        daysBySlot: { BREAKFAST: 4, LUNCH: 1, DINNER: 4 },
        checkIn: { onTrack: 0, partial: 1, off: 0 },
        weight: {
          points: 3,
          firstKg: 70,
          lastKg: 69.8,
          slopeKgPerWeek: -0.1,
          history: [],
          lastChangeKg: -0.1,
          daysSinceLast: 4,
        },
      },
    },
    assertions: [
      path(
        'adjustment.kind',
        'in',
        ['REBUILD_PLAN', 'MEAL_GUIDANCE'],
        'age sobre o almoço que some',
      ),
    ],
  },
];

export const reengagementCases: EvalCase[] = [
  {
    ...base,
    taskId: reengagementPlanTask.id,
    id: 'degrau-1-aluno-engajado-que-sumiu',
    title: 'Degrau 1: quem treinava e sumiu 3 dias recebe acolhimento, não cobrança',
    input: {
      level: 1,
      daysSilent: 3,
      allowedStrategies: ['WARM_CHECK_IN', 'REMOVE_FRICTION'],
      lastSignal: 'WORKOUT',
      trainedLast14: 6,
      plannedPerWeek: 4,
      hasNutritionPlan: true,
      daysWithoutMealLog: 3,
      daysSinceWeight: 5,
      previousOutreach: [],
    },
    assertions: [
      path('strategy', 'in', ['WARM_CHECK_IN', 'REMOVE_FRICTION'], 'abordagem do degrau'),
      path('minimumWeek', 'eq', null, 'sem semana mínima no degrau 1'),
      judge(
        'tom acolhedor',
        'A pergunta e as hipóteses são acolhedoras e cautelosas ("pode ser que a semana tenha apertado"), sem cobrar nem culpar.',
      ),
    ],
  },
  {
    ...base,
    taskId: reengagementPlanTask.id,
    id: 'degrau-2-nao-repete-o-que-nao-funcionou',
    title: 'Degrau 2 depois de um acolhimento sem resposta: muda o ângulo com a semana mínima',
    input: {
      level: 2,
      daysSilent: 6,
      allowedStrategies: ['MINIMUM_VERSION', 'REMOVE_FRICTION', 'RESET_GOAL'],
      lastSignal: 'MESSAGE',
      trainedLast14: 1,
      plannedPerWeek: 4,
      hasNutritionPlan: true,
      daysWithoutMealLog: 9,
      daysSinceWeight: 22,
      previousOutreach: [{ level: 1, strategy: 'WARM_CHECK_IN', respondedAfterHours: null }],
    },
    assertions: [
      path('strategy', 'neq', 'WARM_CHECK_IN', 'não repete a abordagem sem resposta'),
      path(
        'strategy',
        'in',
        ['MINIMUM_VERSION', 'REMOVE_FRICTION', 'RESET_GOAL'],
        'abordagem do degrau',
      ),
    ],
  },
  {
    ...base,
    taskId: reengagementPlanTask.id,
    id: 'degrau-4-porta-aberta',
    title: 'Degrau 4: último contato deixa a porta aberta',
    input: {
      level: 4,
      daysSilent: 21,
      allowedStrategies: ['OPEN_DOOR'],
      lastSignal: null,
      trainedLast14: 0,
      plannedPerWeek: 3,
      hasNutritionPlan: false,
      daysWithoutMealLog: null,
      daysSinceWeight: null,
      previousOutreach: [
        { level: 1, strategy: 'WARM_CHECK_IN', respondedAfterHours: null },
        { level: 2, strategy: 'MINIMUM_VERSION', respondedAfterHours: null },
        { level: 3, strategy: 'PERSONAL_TOUCH', respondedAfterHours: null },
      ],
    },
    assertions: [path('strategy', 'eq', 'OPEN_DOOR', 'porta aberta')],
  },
];

export const trackingGapCases: EvalCase[] = [
  {
    ...base,
    taskId: trackingGapTask.id,
    id: 'sem-refeicao-e-sem-peso',
    title: 'Sem registro e sem pesagem: a nutricionista pede pelo jeito mais leve',
    input: {
      goalDirection: 'LOSE',
      daysWithoutMealLog: 4,
      loggedMealDaysLast14: 3,
      daysSinceWeight: 21,
      weightPointsLast8Weeks: 1,
      daysOnPlan: 42,
    },
    assertions: [
      path('priority', 'eq', 'BOTH', 'faltam os dois'),
      judge(
        'benefício, não obrigação',
        'whyItMatters fala do que o aluno ganha quando a nutricionista tem o dado; easiestWay propõe um gesto mínimo (foto do prato, peso só no domingo). Nada de peso diário, contagem de calorias ou culpa.',
      ),
    ],
  },
];

export const trainingDailyCases: EvalCase[] = [
  {
    ...base,
    taskId: trainingDailyTask.id,
    id: 'avisou-no-chat-que-dormiu-mal-antes-de-treinar',
    title: 'Aluno avisa no chat antes do treino: recomendação explícita para a sessão de hoje',
    input: {
      trigger: 'noite de sono ruim antes do treino',
      today: '2026-11-05',
      days: [{ date: '2026-11-05', energy: 3, sleep: 1, soreness: 3, mood: 3, stress: 4 }],
      load: null,
      plannedToday: { title: 'Força A', minutes: 60, priority: 'KEY' },
      last7Days: { planned: 4, done: 4 },
      recentOutreach: 0,
      source: 'CHAT',
      reportsToday: [
        { kind: 'SLEEP', score: 1, value: 4, phase: 'BEFORE', note: 'dormi só 4 horas' },
      ],
    },
    assertions: [
      path('recommendation', 'exists', undefined, 'recomendação explícita para hoje'),
      path('reachOut', 'eq', true, 'fala com o aluno'),
      judge(
        'recomendação concreta',
        'A recomendação diz o que fazer na sessão de hoje com critério objetivo (manter, baixar a intensidade, cortar séries, parar antes da falha), sem diagnóstico e sem mandar o aluno desistir do treino por pouco.',
      ),
    ],
  },
];

export const followUpCases: Record<string, EvalCase[]> = {
  [trainingFollowUpTask.id]: trainingFollowUpCases,
  [nutritionFollowUpTask.id]: nutritionFollowUpCases,
  [reengagementPlanTask.id]: reengagementCases,
  [trackingGapTask.id]: trackingGapCases,
  [trainingDailyTask.id]: trainingDailyCases,
};
