/**
 * Tarefa `running.build_block` — um bloco de corrida.
 *
 * Quem escolhe corrida na anamnese quer treino ESTRUTURADO, periodizado e específico, não só
 * cardio: a semana tem um estímulo de qualidade, um longão e a base leve que os sustenta, e cada
 * sessão é um treino do catálogo MOVIVO (fartlek, subidas, limiar, intervalado, longão progressivo…)
 * escolhido para o nível e a fase da preparação. O código decide os papéis da semana e a lista de
 * treinos elegíveis; o agente escolhe e monta.
 *
 * O volume parte do que o aluno corre HOJE e cresce no máximo o permitido; a distribuição de
 * intensidade (muito leve, pouco qualidade), o longão e o ritmo são checados contra a
 * metodologia publicada. Nada de ritmo sem base: o alvo sai da zona, do ritmo ou da PSE, e o
 * ritmo nunca é mais rápido do que o aluno sustenta.
 */
import { z } from 'zod';

import {
  runningPhaseSchema,
  runningSessionKindSchema,
  runningWorkoutTypeSchema,
  trainingVenueSchema,
  type PlanSession,
  type RunningSegment,
} from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { runningRules } from '../calc/params';
import {
  QUALITY_KINDS,
  RUNNING_ROLE_LABELS,
  requiredRoleCounts,
  roleOfKind,
} from '../calc/running-week';
import { blockOutputSchema, totalFrequency, type BlockOutput } from './blocks';
import {
  outputLanguageViolations,
  weekdayMentionViolations,
  BODY_COMPOSITION_RULE,
  PROFESSIONAL_INSTRUCTION_RULE,
  professionalInstructionSchema,
} from './common';

/** Treino do catálogo MOVIVO que o aluno pode receber agora (já filtrado em código). */
export const runningWorkoutOptionSchema = z.object({
  type: runningWorkoutTypeSchema,
  label: z.string().min(1).max(80),
  /** Classe do treino: a que a metodologia e a agenda enxergam. */
  kind: runningSessionKindSchema,
  intensity: z.enum(['EASY', 'MODERATE', 'HARD', 'NEUROMUSCULAR']),
  stimulus: z.string().min(1).max(400),
  objective: z.string().min(1).max(400),
  adaptation: z.string().min(1).max(300),
  needsPaceAnchor: z.boolean(),
  terrain: z.enum(['FLAT', 'HILLS', 'TRACK', 'TREADMILL', 'TRAIL', 'SAND']).optional(),
  caution: z.string().max(300).optional(),
});

export const runningInputSchema = z.object({
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  goal: z.enum(['RACE', 'PERFORMANCE', 'FITNESS']),
  /** Fase da periodização, decidida em código (pela prova ou pelo nível e volume do aluno). */
  phase: runningPhaseSchema,
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
  /** Onde o aluno corre: define esteira, rua ou pista e o que cabe. */
  venue: trainingVenueSchema,
  /** Está começando a correr (≤ 3 km/semana, iniciante): base aeróbia, sem qualidade. */
  starter: z.boolean(),
  /** Papéis da semana, um por ocorrência: o esqueleto que a semana precisa cumprir. */
  weekRoles: z
    .array(z.enum(['QUALITY', 'LONG', 'EASY', 'SUPPORT']))
    .min(1)
    .max(6),
  /** Catálogo de treinos elegíveis para o nível, a fase, o local e a existência de prova. */
  workouts: z.array(runningWorkoutOptionSchema).min(1).max(40),
  professionalInstruction: professionalInstructionSchema,
});
export type RunningInput = z.infer<typeof runningInputSchema>;

const EASY_KINDS = ['EASY', 'RECOVERY', 'LONG', 'PROGRESSIVE'];
/** Com poucas corridas, uma sessão de qualidade pesa mais na semana: tolera menos tempo leve. */
const EASY_SHARE_SLACK_FEW_SESSIONS = 15;
const EASY_SHARE_SLACK = 5;
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

  // Cada sessão é um treino do catálogo MOVIVO, coerente com a classe, o terreno e o aluno.
  (input, output) => {
    const violations: Violation[] = [];
    const options = new Map(input.workouts.map((w) => [w.type, w]));
    const allowed = [...options.keys()].join(', ');
    output.sessions.forEach((session, index) => {
      const content = session.content;
      if (content.modality !== 'RUNNING') return;
      const path = `sessions.${index}.content`;
      if (!content.workoutType) {
        violations.push({
          path: `${path}.workoutType`,
          message: `informe o treino do catálogo em "workoutType" (opções: ${allowed})`,
        });
        return;
      }
      const option = options.get(content.workoutType);
      if (!option) {
        violations.push({
          path: `${path}.workoutType`,
          message: `"${content.workoutType}" não está disponível para este aluno agora; use um de: ${allowed}`,
        });
        return;
      }
      if (content.kind !== option.kind) {
        violations.push({
          path: `${path}.kind`,
          message: `"${content.workoutType}" é da classe ${option.kind}, não ${content.kind}`,
        });
      }
      const indoorHills =
        option.terrain === 'HILLS' &&
        content.terrain === 'TREADMILL' &&
        ['FULL_GYM', 'HYROX_GYM', 'CONDO_GYM'].includes(input.venue);
      if (option.terrain && content.terrain !== option.terrain && !indoorHills) {
        violations.push({
          path: `${path}.terrain`,
          message: `"${content.workoutType}" pede terreno ${option.terrain}`,
        });
      }
      if (!input.recent5kSeconds) {
        content.segments.forEach((segment, gi) => {
          if (segment.target.by === 'PACE') {
            violations.push({
              path: `${path}.segments.${gi}.target`,
              message: 'sem 5 km recente não há ritmo de referência: use zona ou PSE',
            });
          }
        });
      }
    });
    return violations;
  },

  // A semana cumpre o esqueleto: sessão de qualidade, longão e variedade de estímulos.
  (input, output) => {
    const violations: Violation[] = [];
    const required = requiredRoleCounts(input.weekRoles);
    let quality = 0;
    let long = 0;
    const types = new Set<string>();
    output.sessions.forEach((session) => {
      if (session.content.modality !== 'RUNNING') return;
      const role = roleOfKind(session.content.kind);
      if (role === 'QUALITY') quality += session.weeklyFrequency;
      if (role === 'LONG') long += session.weeklyFrequency;
      if (session.content.workoutType) types.add(session.content.workoutType);
    });
    if (quality < required.quality) {
      violations.push({
        path: 'sessions',
        message: `a semana pede ${required.quality} sessão(ões) de qualidade (${RUNNING_ROLE_LABELS.QUALITY}) e veio ${quality}: troque uma corrida leve por um treino de qualidade do catálogo`,
      });
    }
    if (long < required.long) {
      violations.push({
        path: 'sessions',
        message: `a semana pede um ${RUNNING_ROLE_LABELS.LONG} (classe LONG) e não veio nenhum`,
      });
    }
    const total = input.weekRoles.length;
    const wantedTypes = Math.min(total, 3);
    if (total >= 2 && types.size < wantedTypes) {
      violations.push({
        path: 'sessions',
        message: `varie os estímulos: ${types.size} tipo(s) de treino na semana; use pelo menos ${wantedTypes} diferentes do catálogo`,
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
      const slack = input.sessionsPerWeek <= 3 ? EASY_SHARE_SLACK_FEW_SESSIONS : EASY_SHARE_SLACK;
      if (easyShare < rules.easySharePct - slack) {
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

  (_input, output) =>
    weekdayMentionViolations([
      { path: 'summary', text: output.summary },
      ...output.notes.map((text, i) => ({ path: `notes.${i}`, text })),
      ...output.sessions.flatMap((session, i) => [
        { path: `sessions.${i}.title`, text: session.title },
        { path: `sessions.${i}.purpose`, text: session.purpose },
      ]),
    ]),

  (_input, output) => outputLanguageViolations(output),
];

export const runningTask = defineAgentTask<RunningInput, BlockOutput>({
  id: 'running.build_block',
  role: 'Treinador de corrida da MOVIVO. Você monta blocos de corrida seguros e progressivos, que respeitam o que o aluno consegue correr hoje e a metodologia dos profissionais de Educação Física.',
  instructions: `Monte o bloco de corrida do aluno: um treino ESTRUTURADO, periodizado e específico, nunca uma recomendação genérica de cardio. Quem escolheu corrida na anamnese quer evoluir nela.

Regras de montagem:
1. A soma de weeklyFrequency é exatamente "sessionsPerWeek"; cada sessão cabe em "minutesPerSession".
2. CADA sessão é um treino do catálogo "workouts" (use o "type" exato em content.workoutType e a "kind" do catálogo em content.kind). O catálogo já vem filtrado pelo nível, pela fase, pelo local ("venue") e pela existência de prova: não use treino fora dele. Leia o estímulo, o objetivo e a adaptação de cada opção e escolha o que serve ao objetivo do aluno (goal) e à fase (phase).
3. A semana cumpre "weekRoles": QUALITY = sessão de qualidade (kind TEMPO, THRESHOLD, INTERVALS, HILLS ou FARTLEK); LONG = longão (kind LONG); EASY = corrida leve de base (pode levar strides ou técnica no final); SUPPORT = regenerativo ou leve com técnica. Varie os estímulos: nunca repita o mesmo treino em todas as sessões. Sessões leves podem ter variações do catálogo (strides, progressão, técnica) em vez de repetir uma "corrida leve" igual.
4. Periodização: "phase" já está decidida (BASE: base aeróbia, subidas curtas, fartlek, strides, longão; BUILD: ritmo sustentado, limiar, intervalado, longão progressivo; PEAK: ritmo de prova, VO₂máx, simulado; TAPER: volume menor mantendo a intensidade; MAINTENANCE: manter). Em "phases" descreva o foco da fase e coloque a semana leve ao fim do bloco quando a metodologia pedir. Em "notes" (uma nota por ideia, curta) diga, em linguagem simples, como a carga sobe de uma semana para a outra (por exemplo, +5 a 10% de volume, nunca mais que a metodologia permite), quando entra a semana leve, e como a qualidade evolui (mais repetições, mais tempo no ritmo, depois mais intensidade).
5. Parta de "currentWeeklyKm": o volume semanal não pode crescer mais do que a metodologia permite. Quem está começando ("starter") alterna caminhada/corrida ou corre pouco tempo — sem qualidade, só base aeróbia e, se houver três sessões, um dia um pouco mais longo.
6. A maior parte do tempo é em intensidade leve (conforme a metodologia). As sessões de qualidade têm aquecimento, parte principal e desaquecimento; longão dentro do limite de tempo e de participação no volume. Com poucas sessões por semana, a qualidade entra de forma moderada (dosagem pelo nível, PSE 6–7 para iniciante).
7. Cada trecho tem distância OU duração e UM alvo: zona, ritmo, frequência cardíaca ou PSE. Para quem não tem relógio ou referência, prefira PSE/zona. Ritmos só quando "recent5kSeconds" existir, sempre sustentáveis. Em treinos com "needsPaceAnchor" sem 5 km recente, use PSE ou zona.
8. Com prova ("race"), respeite a fase (BASE, BUILD, PEAK, TAPER) e coloque a sessão que simula o esforço da prova como KEY quando fizer sentido. Sem prova, foque em evolução consistente (mais rápido e mais longe, aos poucos).
9. Marque como KEY a sessão de qualidade e o longão (as que mais movem a evolução); título específico e curto que diga o treino (por exemplo, "Fartlek 6 × 1 min") e "purpose" com o objetivo do treino para o aluno, em uma frase. NÃO cite dias da semana em nenhum texto: os dias saem da agenda do aluno, calculada pelo sistema.
10. notes: no MÁXIMO 5 notas, cada uma com NO MÁXIMO 250 caracteres e uma ideia só (progressão de volume, semana leve, evolução da qualidade, sinais para reduzir: cansaço fora do normal, dor que muda a passada). Nota longa é recusada: divida em mais de uma nota, dentro do limite de 5. summary: 2 a 3 frases claras, sem prometer tempo nem resultado.
11. ${BODY_COMPOSITION_RULE}
12. ${PROFESSIONAL_INSTRUCTION_RULE}`,
  tier: 'REASONING',
  methodology: ['RUNNING'],
  state: ['identity', 'goals', 'preferences', 'training', 'bodyComposition'],
  input: runningInputSchema,
  output: blockOutputSchema,
  validators: runningValidators,
  // Texto longo demais é o erro mais comum de um prompt mais rico: uma rodada a mais de correção.
  maxCorrectionRounds: 3,
});
