/**
 * Esqueleto da semana de corrida (determinístico).
 *
 * Quem pede corrida na anamnese quer um treino estruturado, não só "cardio": a semana precisa de
 * um estímulo de qualidade, um longão e o volume leve que sustenta os dois. O código decide os
 * PAPÉIS da semana (quantas sessões de qualidade, se há longão, quantas leves); o agente escolhe
 * qual treino do catálogo cumpre cada papel, na fase e no nível do aluno.
 */
import type { RunningPhase, RunningSessionKind } from '@movivo/shared';

export type RunningRole = 'QUALITY' | 'LONG' | 'EASY' | 'SUPPORT';

export const RUNNING_ROLE_LABELS: Readonly<Record<RunningRole, string>> = {
  QUALITY: 'qualidade (ritmo, intervalado, subidas, fartlek)',
  LONG: 'longão',
  EASY: 'corrida leve de base',
  SUPPORT: 'apoio (regenerativo ou leve com técnica e strides)',
};

/** Classes de treino que contam como sessão de qualidade (estímulo intenso). */
export const QUALITY_KINDS: readonly RunningSessionKind[] = [
  'TEMPO',
  'THRESHOLD',
  'INTERVALS',
  'HILLS',
  'FARTLEK',
  'TEST',
  'RACE',
];

export type RunningGoalKind = 'RACE' | 'PERFORMANCE' | 'FITNESS';

export interface RunningWeekInput {
  /** Sessões de corrida na semana (soma das frequências). */
  sessions: number;
  goal: RunningGoalKind;
  phase: RunningPhase;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  /** Teto de sessões de qualidade da metodologia para o nível (`null` = sem regra publicada). */
  qualityMax: number | null;
  /** Está começando a correr: sem qualidade, só base aeróbia. */
  starter: boolean;
}

/** Corre pouco ou nada hoje: a semana é de base aeróbia, sem estímulo de qualidade. */
export function isStarter(currentWeeklyKm: number, level: RunningWeekInput['level']): boolean {
  return currentWeeklyKm <= 3 && level === 'BEGINNER';
}

export function runningWeekRoles(input: RunningWeekInput): RunningRole[] {
  const { sessions, goal, phase, level, starter } = input;
  if (sessions <= 0) return [];
  if (starter) {
    // Começando: base aeróbia; o último dia vira o "mais longo" quando há três ou mais.
    return Array.from({ length: sessions }, (_, i) =>
      sessions >= 3 && i === sessions - 1 ? 'LONG' : 'EASY',
    );
  }

  const performance = goal === 'RACE' || goal === 'PERFORMANCE';
  let quality = 1;
  if (sessions >= 4 && performance && level !== 'BEGINNER' && ['BUILD', 'PEAK'].includes(phase)) {
    quality = 2;
  }
  if (input.qualityMax !== null) quality = Math.min(quality, input.qualityMax);
  quality = Math.min(quality, sessions);

  const hasLong = sessions >= 2 && sessions - quality >= 1;
  const roles: RunningRole[] = [
    ...Array<RunningRole>(quality).fill('QUALITY'),
    ...(hasLong ? (['LONG'] as const) : []),
  ];
  while (roles.length < sessions) roles.push('EASY');
  // A partir de cinco sessões, a última leve vira apoio (regenerativo ou técnica com strides).
  if (sessions >= 5) roles[roles.length - 1] = 'SUPPORT';
  return roles;
}

export interface RoleCounts {
  quality: number;
  long: number;
}

/** O que o esqueleto exige no mínimo: quantas sessões de qualidade e se há longão. */
export function requiredRoleCounts(roles: readonly RunningRole[]): RoleCounts {
  return {
    quality: roles.filter((r) => r === 'QUALITY').length,
    long: roles.filter((r) => r === 'LONG').length,
  };
}

export function roleOfKind(kind: RunningSessionKind): 'QUALITY' | 'LONG' | 'OTHER' {
  if (QUALITY_KINDS.includes(kind)) return 'QUALITY';
  if (kind === 'LONG') return 'LONG';
  return 'OTHER';
}
