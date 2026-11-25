/**
 * A evolução que o próprio aluno vê (aba "Evolução" do check-in): constância (dias ativos seguidos),
 * consistência, progressão nos treinos de cada modalidade, recordes e medidas do corpo. Só
 * tipos; o cálculo está em `student-progress.ts`.
 */
import type { HyroxStation } from '../training/endurance.schema';

/** Estado de um dia na constância. Descanso não soma nem quebra. */
export type StreakDayState = 'DONE' | 'REST' | 'MISSED' | 'PENDING' | 'FUTURE';

export interface StudentStreak {
  /** Dias ativos seguidos, sem contar os de descanso (que não quebram a sequência). */
  current: number;
  best: number;
  /** Treinou hoje (a constância de hoje já está garantida). */
  activeToday: boolean;
  /** As últimas 4 semanas (segunda a domingo), dia a dia. */
  days: { date: string; state: StreakDayState }[];
}

export interface StudentConsistency {
  /** Treinos feitos ÷ previstos nas últimas 4 semanas (0 a 100); nulo sem nada previsto. */
  adherencePct: number | null;
  sessions28d: number;
  minutes28d: number;
}

export interface StrengthProgress {
  exerciseId: string;
  name: string;
  sessions: number;
  /** Uma ponta por treino: a série mais pesada e o 1RM estimado (Epley) dela. */
  points: { date: string; topLoadKg: number | null; reps: number | null; e1rmKg: number | null }[];
}

export interface RunningProgress {
  runs: number;
  totalKm: number;
  longestKm: number;
  bestPaceSecondsPerKm: number | null;
  points: {
    date: string;
    distanceKm: number;
    paceSecondsPerKm: number | null;
    avgHeartRate: number | null;
  }[];
  weeks: { weekStart: string; km: number }[];
}

export interface HyroxProgress {
  sessions: number;
  points: { date: string; totalSeconds: number | null }[];
  stations: {
    station: HyroxStation;
    firstSeconds: number;
    bestSeconds: number;
    lastSeconds: number;
  }[];
}

export interface PersonalRecord {
  label: string;
  value: string;
  date: string;
}

/** Quão confiável é a estimativa, pela distância mais longa já corrida nos treinos. */
export type PredictionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface RacePrediction {
  race: '5K' | '10K' | 'HALF' | 'MARATHON';
  km: number;
  seconds: number;
  paceSecondsPerKm: number;
  confidence: PredictionConfidence;
}

export interface HyroxPrediction {
  seconds: number;
  /** 8 × 1 km de corrida já cansado das estações. */
  runSeconds: number;
  stationsSeconds: number;
  /** Trocas entre corrida e estação (roxzone). */
  roxzoneSeconds: number;
  /** Quantas das 8 estações têm tempo medido nos treinos (as outras usam uma referência). */
  measuredStations: number;
  confidence: PredictionConfidence;
}

export interface StudentPredictions {
  /** O treino de corrida que serviu de base (o melhor desempenho recente, de 3 km para cima). */
  basedOn: { date: string; distanceKm: number; seconds: number } | null;
  running: RacePrediction[];
  hyrox: HyroxPrediction | null;
}

export interface StudentProgress {
  streak: StudentStreak;
  consistency: StudentConsistency;
  strength: StrengthProgress[];
  running: RunningProgress | null;
  hyrox: HyroxProgress | null;
  records: PersonalRecord[];
  predictions: StudentPredictions;
}
