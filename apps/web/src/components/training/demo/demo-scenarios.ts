/**
 * Cenários da página de demonstração do diário (`/hoje/demo`, só no ambiente local): um treino
 * de cada modalidade em cada estado, para ver o check-in diário inteiro sem aluno de verdade.
 * Todos os dados são de exemplo.
 */
import type {
  ExecutionView,
  ScheduledSessionStatus,
  SessionContent,
  SessionModality,
  SessionPriority,
  TrainingDaySession,
} from '@movivo/shared';

// --- Conteúdo dos treinos ----------------------------------------------------------------------

const STRENGTH_A: SessionContent = {
  modality: 'STRENGTH',
  focus: 'Peito, ombros e tríceps',
  exercises: [
    {
      exerciseId: 'supino_reto_barra',
      name: 'Supino reto com barra',
      warmup: [{ sets: 1, reps: { min: 12, max: 12 } }],
      sets: 4,
      reps: { min: 8, max: 10 },
      loadStrategy: 'DOUBLE_PROGRESSION',
      rir: 2,
      restSeconds: 120,
    },
    {
      exerciseId: 'desenvolvimento_halteres',
      name: 'Desenvolvimento com halteres',
      sets: 3,
      reps: { min: 10, max: 12 },
      loadStrategy: 'RIR',
      rir: 2,
      restSeconds: 90,
    },
    {
      exerciseId: 'triceps_corda',
      name: 'Tríceps na polia com corda',
      sets: 3,
      reps: { min: 12, max: 15 },
      loadStrategy: 'RIR',
      rir: 1,
      restSeconds: 60,
      technique: 'DROP_SET',
    },
    {
      exerciseId: 'prancha',
      name: 'Prancha',
      sets: 3,
      durationSeconds: 40,
      loadStrategy: 'BODYWEIGHT',
      restSeconds: 45,
    },
  ],
};

const STRENGTH_B: SessionContent = {
  modality: 'STRENGTH',
  focus: 'Pernas e glúteos',
  exercises: [
    {
      exerciseId: 'agachamento_livre',
      name: 'Agachamento livre',
      sets: 4,
      reps: { min: 6, max: 8 },
      loadStrategy: 'DOUBLE_PROGRESSION',
      rir: 2,
      restSeconds: 150,
    },
    {
      exerciseId: 'stiff',
      name: 'Stiff com barra',
      sets: 3,
      reps: { min: 8, max: 10 },
      loadStrategy: 'RIR',
      rir: 2,
      restSeconds: 120,
    },
    {
      exerciseId: 'panturrilha_em_pe',
      name: 'Panturrilha em pé',
      sets: 3,
      reps: { min: 12, max: 15 },
      loadStrategy: 'RIR',
      rir: 1,
      restSeconds: 60,
    },
  ],
};

/** Grupos musculares dos exercícios de exemplo (no app, vêm do catálogo). */
export const DEMO_MUSCLES: Readonly<Record<string, readonly string[]>> = {
  supino_reto_barra: ['peito', 'tríceps', 'ombro'],
  desenvolvimento_halteres: ['ombro', 'tríceps'],
  triceps_corda: ['tríceps'],
  prancha: ['core'],
  agachamento_livre: ['quadríceps', 'glúteo'],
  stiff: ['posterior de coxa', 'glúteo'],
  panturrilha_em_pe: ['panturrilha'],
};

/** 5 km em 25:00: as referências de ritmo e esteira já calculadas como no plano. */
const zone = (z: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5') => ({ by: 'ZONE' as const, zone: z });
const ref = (min: number, max: number, treadmill = false) => ({
  secondsPerKm: { min, max },
  treadmill,
});

const RUN_EASY_OUTDOOR: SessionContent = {
  modality: 'RUNNING',
  kind: 'EASY',
  workoutType: 'EASY_RUN',
  terrain: 'ANY',
  segments: [
    { type: 'WARMUP', durationSeconds: 600, target: zone('Z1'), paceReference: ref(405, 450) },
    {
      type: 'STEADY',
      durationSeconds: 1_800,
      target: zone('Z2'),
      paceReference: ref(360, 405),
      notes: 'Ritmo de conversa: dá para falar frases inteiras.',
    },
    {
      type: 'STRIDES',
      repeat: 4,
      durationSeconds: 20,
      target: { by: 'RPE', rpe: { min: 7, max: 8 } },
      notes: 'Acelerações soltas, sem forçar.',
    },
    { type: 'COOLDOWN', durationSeconds: 300, target: zone('Z1'), paceReference: ref(405, 450) },
  ],
};

const RUN_INTERVALS_TREADMILL: SessionContent = {
  modality: 'RUNNING',
  kind: 'INTERVALS',
  workoutType: 'CRUISE_INTERVALS',
  terrain: 'TREADMILL',
  segments: [
    {
      type: 'WARMUP',
      durationSeconds: 600,
      target: zone('Z2'),
      paceReference: ref(360, 405, true),
    },
    {
      type: 'WORK',
      repeat: 5,
      distanceMeters: 1_000,
      target: zone('Z4'),
      paceReference: ref(310, 330, true),
      notes: 'Passada curta e cadência alta.',
    },
    {
      type: 'RECOVERY',
      repeat: 5,
      durationSeconds: 120,
      target: zone('Z1'),
      paceReference: ref(405, 450, true),
    },
    {
      type: 'COOLDOWN',
      durationSeconds: 300,
      target: { by: 'RPE', rpe: { min: 2, max: 3 } },
      paceReference: ref(405, 450, true),
    },
  ],
};

const RUN_TEMPO_PACE: SessionContent = {
  modality: 'RUNNING',
  kind: 'TEMPO',
  workoutType: 'TEMPO_RUN',
  terrain: 'FLAT',
  segments: [
    { type: 'WARMUP', durationSeconds: 900, target: zone('Z2'), paceReference: ref(360, 405) },
    {
      type: 'WORK',
      distanceMeters: 4_000,
      target: { by: 'PACE', secondsPerKm: { min: 300, max: 310 } },
      paceReference: ref(300, 310),
    },
    {
      type: 'COOLDOWN',
      durationSeconds: 600,
      target: { by: 'HEART_RATE', bpm: { min: 110, max: 130 } },
    },
  ],
};

const HYROX_SIM: SessionContent = {
  modality: 'HYROX',
  kind: 'COMPROMISED_RUNNING',
  rounds: 2,
  blocks: [
    { type: 'RUN', distanceMeters: 1_000, target: zone('Z3'), paceReference: ref(330, 360, true) },
    { type: 'STATION', station: 'SKIERG', distanceMeters: 1_000 },
    { type: 'RUN', distanceMeters: 1_000, target: zone('Z3'), paceReference: ref(330, 360, true) },
    { type: 'STATION', station: 'SLED_PUSH', distanceMeters: 50, loadKg: 102 },
    { type: 'RUN', distanceMeters: 1_000, target: zone('Z4'), paceReference: ref(310, 330, true) },
    { type: 'STATION', station: 'WALL_BALLS', reps: 50, loadKg: 6 },
    { type: 'REST', durationSeconds: 180 },
  ],
};

const EXTERNAL: SessionContent = {
  modality: 'EXTERNAL_SPORT',
  sport: 'OTHER',
  label: 'Beach tennis',
  plannedMinutes: 90,
  plannedRpe: 6,
};

// --- Execuções de exemplo --------------------------------------------------------------------

/** Treino em andamento começou há 25 minutos (o cronômetro já aparece rodando). */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const exec = (id: string, partial: Partial<ExecutionView>): ExecutionView => ({
  id,
  status: 'IN_PROGRESS',
  source: 'LINK',
  sets: [],
  metrics: null,
  metricsConfirmed: false,
  rpe: null,
  durationMinutes: null,
  enjoyment: null,
  startedAt: minutesAgo(25),
  feedback: null,
  ...partial,
});

const DEMO_LOADS: Readonly<Record<string, number>> = {
  supino_reto_barra: 60,
  desenvolvimento_halteres: 18,
  triceps_corda: 25,
  agachamento_livre: 80,
  stiff: 50,
  panturrilha_em_pe: 40,
};

const strengthSets = (content: SessionContent, completedUpTo = Infinity) =>
  content.modality === 'STRENGTH'
    ? content.exercises.flatMap((exercise, ei) =>
        Array.from({ length: exercise.sets }, (_, si) => ({
          exerciseId: exercise.exerciseId,
          setNumber: si + 1,
          reps: exercise.durationSeconds ? null : (exercise.reps?.max ?? 10),
          loadKg:
            exercise.loadStrategy === 'BODYWEIGHT' ? null : (DEMO_LOADS[exercise.exerciseId] ?? 20),
          durationSeconds: exercise.durationSeconds ?? null,
          rir: exercise.rir ?? null,
          completed: ei * 10 + si < completedUpTo,
        })),
      )
    : [];

/** O que um arquivo do relógio traria (o envio na demonstração usa estes números). */
export const RUN_METRICS = {
  distanceMeters: 7_040,
  movingSeconds: 2_380,
  avgPaceSecondsPerKm: 338,
  avgHeartRate: 146,
  maxHeartRate: 171,
  elevationGainMeters: 38,
  laps: [348, 342, 339, 336, 333, 329, 330].map((seconds) => ({
    distanceMeters: 1_000,
    durationSeconds: seconds,
  })),
};

export const HYROX_METRICS = {
  distanceMeters: 6_000,
  movingSeconds: 3_960,
  stations: [
    { station: 'SKIERG' as const, durationSeconds: 268 },
    { station: 'SLED_PUSH' as const, durationSeconds: 195 },
    { station: 'WALL_BALLS' as const, durationSeconds: 301 },
    { station: 'SKIERG' as const, durationSeconds: 281 },
    { station: 'SLED_PUSH' as const, durationSeconds: 204 },
    { station: 'WALL_BALLS' as const, durationSeconds: 322 },
  ],
};

// --- Cenários -----------------------------------------------------------------------------

export interface DemoSessionSeed {
  key: string;
  title: string;
  purpose: string;
  modality: SessionModality;
  priority: SessionPriority;
  estimatedMinutes: number;
  content: SessionContent;
  status?: ScheduledSessionStatus;
  execution?: (id: string) => ExecutionView;
}

export interface DemoScenario {
  id: string;
  group: 'Fluxo completo' | 'Musculação' | 'Corrida' | 'HYROX' | 'Outro esporte' | 'Dia';
  label: string;
  /** Treinos de hoje (vazio = dia de descanso, ou plano em preparo se `noPlan`). */
  today: DemoSessionSeed[];
  noPlan?: boolean;
  /** Começa na tela de acesso pelo link (etapa 1). */
  access?: boolean;
  /** As perguntas do dia ainda não foram respondidas (etapa 2 aparece antes do treino). */
  pendingCheckIn?: boolean;
}

const strengthA: Omit<DemoSessionSeed, 'status' | 'execution'> = {
  key: 'FORCA_A',
  title: 'Força A · Empurrar',
  purpose: 'Força de peito e ombros, com tríceps de apoio.',
  modality: 'STRENGTH',
  priority: 'KEY',
  estimatedMinutes: 55,
  content: STRENGTH_A,
};
const strengthB: Omit<DemoSessionSeed, 'status' | 'execution'> = {
  key: 'FORCA_B',
  title: 'Força B · Pernas',
  purpose: 'Base de força de pernas e posterior.',
  modality: 'STRENGTH',
  priority: 'KEY',
  estimatedMinutes: 50,
  content: STRENGTH_B,
};
const easyRun: Omit<DemoSessionSeed, 'status' | 'execution'> = {
  key: 'RODAGEM',
  title: 'Rodagem leve',
  purpose: 'Base aeróbia: correr conversando.',
  modality: 'RUNNING',
  priority: 'IMPORTANT',
  estimatedMinutes: 45,
  content: RUN_EASY_OUTDOOR,
};
const treadmillRun: Omit<DemoSessionSeed, 'status' | 'execution'> = {
  key: 'INTERVALADO',
  title: 'Intervalado na esteira',
  purpose: 'Estímulo de limiar com recuperação ativa.',
  modality: 'RUNNING',
  priority: 'KEY',
  estimatedMinutes: 50,
  content: RUN_INTERVALS_TREADMILL,
};
const tempoRun: Omit<DemoSessionSeed, 'status' | 'execution'> = {
  key: 'RITMO',
  title: 'Ritmo de prova 4 km',
  purpose: 'Sustentar o ritmo alvo da prova.',
  modality: 'RUNNING',
  priority: 'KEY',
  estimatedMinutes: 45,
  content: RUN_TEMPO_PACE,
};
const hyrox: Omit<DemoSessionSeed, 'status' | 'execution'> = {
  key: 'HYROX',
  title: 'HYROX · corrida comprometida',
  purpose: 'Correr bem depois das estações.',
  modality: 'HYROX',
  priority: 'KEY',
  estimatedMinutes: 70,
  content: HYROX_SIM,
};
const external: Omit<DemoSessionSeed, 'status' | 'execution'> = {
  key: 'BEACH',
  title: 'Beach tennis',
  purpose: 'Você já pratica; o plano se organiza em volta.',
  modality: 'EXTERNAL_SPORT',
  priority: 'COMPLEMENTARY',
  estimatedMinutes: 90,
  content: EXTERNAL,
};

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'fluxo-forca',
    group: 'Fluxo completo',
    label: 'Musculação',
    today: [strengthA],
    access: true,
    pendingCheckIn: true,
  },
  {
    id: 'fluxo-corrida',
    group: 'Fluxo completo',
    label: 'Corrida',
    today: [easyRun],
    access: true,
    pendingCheckIn: true,
  },
  {
    id: 'fluxo-hyrox',
    group: 'Fluxo completo',
    label: 'HYROX',
    today: [hyrox],
    access: true,
    pendingCheckIn: true,
  },
  {
    id: 'fluxo-externo',
    group: 'Fluxo completo',
    label: 'Outro esporte',
    today: [external],
    access: true,
    pendingCheckIn: true,
  },
  { id: 'forca-planejada', group: 'Musculação', label: 'Planejado', today: [strengthA] },
  {
    id: 'forca-andamento',
    group: 'Musculação',
    label: 'Em andamento',
    today: [{ ...strengthA, execution: (id) => exec(id, { sets: strengthSets(STRENGTH_A, 12) }) }],
  },
  {
    id: 'forca-concluida',
    group: 'Musculação',
    label: 'Concluído',
    today: [
      {
        ...strengthA,
        status: 'DONE',
        execution: (id) =>
          exec(id, {
            status: 'COMPLETED',
            sets: strengthSets(STRENGTH_A),
            rpe: 8,
            durationMinutes: 58,
            enjoyment: 4,
          }),
      },
    ],
  },
  {
    id: 'forca-parte',
    group: 'Musculação',
    label: 'Feito em parte',
    today: [
      {
        ...strengthB,
        status: 'PARTIAL',
        execution: (id) =>
          exec(id, {
            status: 'PARTIAL',
            sets: strengthSets(STRENGTH_B, 12),
            rpe: 7,
            durationMinutes: 32,
          }),
      },
    ],
  },
  { id: 'corrida-rua', group: 'Corrida', label: 'Rua (zona + ritmo)', today: [easyRun] },
  {
    id: 'corrida-esteira',
    group: 'Corrida',
    label: 'Esteira, em andamento',
    today: [{ ...treadmillRun, execution: (id) => exec(id, {}) }],
  },
  { id: 'corrida-ritmo', group: 'Corrida', label: 'Alvo ritmo e FC', today: [tempoRun] },
  {
    id: 'corrida-arquivo',
    group: 'Corrida',
    label: 'Com arquivo do relógio',
    today: [
      { ...easyRun, execution: (id) => exec(id, { metrics: RUN_METRICS, source: 'FIT_FILE' }) },
    ],
  },
  {
    id: 'corrida-concluida',
    group: 'Corrida',
    label: 'Concluída',
    today: [
      {
        ...easyRun,
        status: 'DONE',
        execution: (id) =>
          exec(id, {
            status: 'COMPLETED',
            metrics: RUN_METRICS,
            metricsConfirmed: true,
            rpe: 5,
            durationMinutes: 40,
            startedAt: minutesAgo(70),
          }),
      },
    ],
  },
  { id: 'hyrox-planejado', group: 'HYROX', label: 'Planejado', today: [hyrox] },
  {
    id: 'hyrox-andamento',
    group: 'HYROX',
    label: 'Em andamento',
    today: [{ ...hyrox, execution: (id) => exec(id, {}) }],
  },
  {
    id: 'hyrox-concluido',
    group: 'HYROX',
    label: 'Concluído',
    today: [
      {
        ...hyrox,
        status: 'DONE',
        execution: (id) =>
          exec(id, {
            status: 'COMPLETED',
            metrics: HYROX_METRICS,
            metricsConfirmed: true,
            rpe: 9,
            durationMinutes: 66,
          }),
      },
    ],
  },
  { id: 'externo-planejado', group: 'Outro esporte', label: 'Planejado', today: [external] },
  {
    id: 'externo-concluido',
    group: 'Outro esporte',
    label: 'Concluído',
    today: [
      {
        ...external,
        status: 'DONE',
        execution: (id) => exec(id, { status: 'COMPLETED', rpe: 6, durationMinutes: 95 }),
      },
    ],
  },
  { id: 'dois-treinos', group: 'Dia', label: 'Dois treinos no dia', today: [strengthB, easyRun] },
  { id: 'descanso', group: 'Dia', label: 'Descanso (check-in)', today: [], pendingCheckIn: true },
  { id: 'sem-plano', group: 'Dia', label: 'Plano em preparo', today: [], noPlan: true },
];

/** A semana-tipo dos outros dias (para as setas e o histórico terem o que mostrar). */
export const DEMO_WEEK_TEMPLATE: Readonly<
  Record<number, Omit<DemoSessionSeed, 'status' | 'execution'>[]>
> = {
  1: [strengthA],
  2: [easyRun],
  3: [strengthB],
  4: [treadmillRun],
  6: [hyrox],
};

export type DemoSession = TrainingDaySession;

export { strengthSets };
