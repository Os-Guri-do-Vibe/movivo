/**
 * Tarefa `running.build_block` — um bloco de corrida.
 *
 * O volume parte do que o aluno corre HOJE e cresce no máximo o permitido; a distribuição de
 * intensidade (muito leve, pouco qualidade), o longão e o ritmo são checados contra a
 * metodologia publicada. Nada de ritmo sem base: o alvo sai da zona, do ritmo ou da PSE, e o
 * ritmo nunca é mais rápido do que o aluno sustenta.
 */
import { z } from 'zod';

import type { PlanSession, RunningSegment } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { runningRules } from '../calc/params';
import { blockOutputSchema, totalFrequency, type BlockOutput } from './blocks';
import { outputLanguageViolations } from './common';

export const runningInputSchema = z.object({
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  goal: z.enum(['RACE', 'PERFORMANCE', 'FITNESS', 'COMPLEMENT']),
  phase: z.enum(['BASE', 'BUILD', 'PEAK', 'TAPER', 'MAINTENANCE']),
  sessionsPerWeek: z.number().int().min(1).max(6),
  minutesPerSession: z.number().int().min(20).max(240),
  weeksInBlock: z.number().int().min(2).max(12),
  /** Quanto o aluno corre por semana hoje (km). 0 = está começando. */
  currentWeeklyKm: z.number().min(0).max(300),
  /** Melhor 5 km recente, em segundos (ancora os ritmos). */
  recent5kSeconds: z.number().int().min(600).max(7_200).nullable(),
  race: z
    .object({
      distanceMeters: z.number().int().min(1_000).max(100_000),
      weeksToRace: z.number().int().min(0).max(60),
      targetSeconds: z.number().int().min(60).max(86_400).nullable(),
    })
    .nullable(),
  modalityPriority: z.number().int().min(1).max(3),
});
export type RunningInput = z.infer<typeof runningInputSchema>;

const EASY_KINDS = ['EASY', 'RECOVERY', 'LONG', 'PROGRESSIVE'];
const QUALITY_KINDS = ['TEMPO', 'THRESHOLD', 'INTERVALS', 'HILLS', 'FARTLEK', 'TEST', 'RACE'];
/** Sem base (≤ 3 km/semana), o volume semanal total é limitado em minutos. */
const STARTER_WEEKLY_MINUTES_CAP = 120;
/** Ritmo fácil ≈ 25% mais lento que o ritmo de 5 km. */
const EASY_PACE_FACTOR = 1.25;

/** Distância e tempo estimados de um trecho (usa o ritmo de referência quando só há tempo). */
function segmentVolume(segment: RunningSegment, easySecondsPerKm: number) {
  const repeat = segment.repeat ?? 1;
  if (segment.distanceMeters !== undefined) {
    const meters = segment.distanceMeters * repeat;
    return { meters, seconds: (meters / 1000) * easySecondsPerKm };
  }
  const seconds = (segment.durationSeconds ?? 0) * repeat;
  return { meters: (seconds / easySecondsPerKm) * 1000, seconds };
}

function sessionVolume(session: PlanSession, easySecondsPerKm: number) {
  if (session.content.modality !== 'RUNNING') return { meters: 0, seconds: 0 };
  return session.content.segments.reduce(
    (acc, s) => {
      const v = segmentVolume(s, easySecondsPerKm);
      return { meters: acc.meters + v.meters, seconds: acc.seconds + v.seconds };
    },
    { meters: 0, seconds: 0 },
  );
}

function easySecondsPerKm(input: RunningInput): number {
  return input.recent5kSeconds ? (input.recent5kSeconds / 5) * EASY_PACE_FACTOR : 390;
}

export const runningValidators: Validator<RunningInput, BlockOutput>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    output.sessions.forEach((s, index) => {
      if (s.content.modality !== 'RUNNING') {
        violations.push({
          path: `sessions.${index}.content.modality`,
          message: 'este bloco só contém sessões de corrida',
        });
      }
      if (s.estimatedMinutes > input.minutesPerSession) {
        violations.push({
          path: `sessions.${index}.estimatedMinutes`,
          message: `${s.estimatedMinutes} min passa do tempo disponível (${input.minutesPerSession} min)`,
        });
      }
    });
    if (totalFrequency(output.sessions) !== input.sessionsPerWeek) {
      violations.push({
        path: 'sessions',
        message: `a soma das frequências semanais deve ser ${input.sessionsPerWeek} (veio ${totalFrequency(output.sessions)})`,
      });
    }
    return violations;
  },

  // Volume semanal, longão e sessões de qualidade contra a metodologia.
  (input, output, context) => {
    const rules = runningRules(context.methodology.RUNNING, input.level);
    const easyPace = easySecondsPerKm(input);
    const violations: Violation[] = [];

    let weeklyMeters = 0;
    let weeklySeconds = 0;
    let longestSeconds = 0;
    let qualitySessions = 0;
    let easySeconds = 0;
    output.sessions.forEach((session) => {
      if (session.content.modality !== 'RUNNING') return;
      const volume = sessionVolume(session, easyPace);
      weeklyMeters += volume.meters * session.weeklyFrequency;
      weeklySeconds += volume.seconds * session.weeklyFrequency;
      if (session.content.kind === 'LONG')
        longestSeconds = Math.max(longestSeconds, volume.seconds);
      if (QUALITY_KINDS.includes(session.content.kind)) qualitySessions += session.weeklyFrequency;
      if (EASY_KINDS.includes(session.content.kind)) {
        easySeconds += volume.seconds * session.weeklyFrequency;
      } else {
        // Em sessões de qualidade, só aquecimento, trote e desaquecimento contam como leve.
        for (const segment of session.content.segments) {
          if (['WARMUP', 'COOLDOWN', 'RECOVERY'].includes(segment.type)) {
            easySeconds += segmentVolume(segment, easyPace).seconds * session.weeklyFrequency;
          }
        }
      }
    });

    const weeklyKm = weeklyMeters / 1000;
    if (input.currentWeeklyKm <= 3) {
      if (weeklySeconds / 60 > STARTER_WEEKLY_MINUTES_CAP) {
        violations.push({
          path: 'sessions',
          message: `quem está começando corre no máximo ${STARTER_WEEKLY_MINUTES_CAP} min na semana (veio ~${Math.round(weeklySeconds / 60)})`,
        });
      }
    } else if (rules.weeklyIncreaseMaxPct !== null) {
      const ceiling = input.currentWeeklyKm * (1 + rules.weeklyIncreaseMaxPct / 100);
      if (weeklyKm > ceiling * 1.02) {
        violations.push({
          path: 'sessions',
          message: `volume semanal de ~${weeklyKm.toFixed(1)} km passa do máximo permitido (${ceiling.toFixed(1)} km = hoje +${rules.weeklyIncreaseMaxPct}%)`,
        });
      }
    }
    if (rules.longRunMaxMinutes !== null && longestSeconds / 60 > rules.longRunMaxMinutes) {
      violations.push({
        path: 'sessions',
        message: `longão de ~${Math.round(longestSeconds / 60)} min passa do máximo (${rules.longRunMaxMinutes} min)`,
      });
    }
    if (
      rules.longRunMaxSharePct !== null &&
      weeklySeconds > 0 &&
      // Só se aplica quando a participação máxima é alcançável com a quantidade de sessões.
      100 / input.sessionsPerWeek < rules.longRunMaxSharePct &&
      (longestSeconds / weeklySeconds) * 100 > rules.longRunMaxSharePct
    ) {
      violations.push({
        path: 'sessions',
        message: `o longão é ${Math.round((longestSeconds / weeklySeconds) * 100)}% do volume; o máximo é ${rules.longRunMaxSharePct}%`,
      });
    }
    if (
      rules.qualitySessionsPerWeekMax !== null &&
      qualitySessions > rules.qualitySessionsPerWeekMax
    ) {
      violations.push({
        path: 'sessions',
        message: `${qualitySessions} sessões de qualidade por semana; o máximo do nível é ${rules.qualitySessionsPerWeekMax}`,
      });
    }
    if (rules.easySharePct !== null && weeklySeconds > 0) {
      const easyShare = (easySeconds / weeklySeconds) * 100;
      if (easyShare < rules.easySharePct - 5) {
        violations.push({
          path: 'sessions',
          message: `${Math.round(easyShare)}% do tempo em intensidade leve; a metodologia pede ao menos ${rules.easySharePct}%`,
        });
      }
    }
    return violations;
  },

  // Ritmos plausíveis: nenhum alvo mais rápido do que o aluno sustenta (ancorado no 5 km).
  (input, output) => {
    if (!input.recent5kSeconds) return [];
    const fastest = (input.recent5kSeconds / 5) * 0.9;
    const violations: Violation[] = [];
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'RUNNING') return;
      session.content.segments.forEach((segment, gi) => {
        if (segment.target.by === 'PACE' && segment.target.secondsPerKm.min < fastest) {
          violations.push({
            path: `sessions.${si}.content.segments.${gi}.target`,
            message: `ritmo de ${segment.target.secondsPerKm.min}s/km é mais rápido do que o aluno sustenta (limite ~${Math.round(fastest)}s/km)`,
          });
        }
      });
    });
    return violations;
  },

  // Chegando perto da prova (polimento) o volume não sobe e a sessão-chave existe.
  (input, output) => {
    const violations: Violation[] = [];
    if (input.race && input.race.weeksToRace <= 2 && input.phase !== 'TAPER') {
      violations.push({
        path: 'phases',
        message: 'a duas semanas da prova o bloco deve ser de polimento (TAPER)',
      });
    }
    if (!output.sessions.some((s) => s.priority === 'KEY')) {
      violations.push({ path: 'sessions', message: 'marque ao menos uma sessão-chave' });
    }
    return violations;
  },

  (_input, output) => outputLanguageViolations(output),
];

export const runningTask = defineAgentTask<RunningInput, BlockOutput>({
  id: 'running.build_block',
  role: 'Treinador de corrida da MOVIVO. Você monta blocos de corrida seguros e progressivos, que respeitam o que o aluno consegue correr hoje e a metodologia dos profissionais de Educação Física.',
  instructions: `Monte o bloco de corrida do aluno.

Regras de montagem:
1. A soma de weeklyFrequency é exatamente "sessionsPerWeek"; cada sessão cabe em "minutesPerSession".
2. Parta de "currentWeeklyKm": o volume semanal não pode crescer mais do que a metodologia permite. Quem está começando (≤ 3 km/semana) alterna caminhada/corrida ou corre pouco tempo — nunca volume de quem já corre.
3. A maior parte do tempo é em intensidade leve (conforme a metodologia). Poucas sessões de qualidade (tempo, limiar, intervalado, subidas), com aquecimento e desaquecimento. Longão dentro do limite de tempo e de participação no volume.
4. Cada trecho tem distância OU duração e UM alvo: zona, ritmo, frequência cardíaca ou PSE. Para quem não tem relógio ou referência, prefira PSE/zona. Ritmos só quando "recent5kSeconds" existir, sempre sustentáveis.
5. Com prova ("race"), respeite a fase (BASE, BUILD, PEAK, TAPER) e coloque a sessão que simula o esforço da prova como KEY quando fizer sentido. Sem prova, foque em consistência.
6. notes: como progredir de uma semana para a outra e sinais para reduzir (cansaço fora do normal, dor que muda a passada). summary: 2 a 3 frases claras, sem prometer tempo nem resultado.`,
  tier: 'REASONING',
  methodology: ['RUNNING'],
  state: ['identity', 'goals', 'preferences', 'training'],
  input: runningInputSchema,
  output: blockOutputSchema,
  validators: runningValidators,
  maxCorrectionRounds: 2,
});
