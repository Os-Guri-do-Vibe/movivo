/**
 * Tarefa `strength.build_block` — um bloco de musculação.
 *
 * O código entrega só exercícios SEGUROS e viáveis (já filtrados por local, nível,
 * contraindicação e rejeições do aluno); o modelo monta as sessões; o validador confere volume,
 * frequência, esforço, descanso e tempo contra a metodologia publicada.
 */
import { z } from 'zod';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { strengthRules } from '../calc/params';
import { blockOutputSchema, totalFrequency, type BlockOutput } from './blocks';
import { outputLanguageViolations } from './common';

export const strengthCandidateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  pattern: z.string().min(1).max(30),
  muscleGroups: z.array(z.string().min(1).max(40)).min(1).max(6),
  equipment: z.array(z.string().max(40)).max(4),
  /** `DURATION` = prescrito por tempo (isometria, cardio contínuo). */
  measurement: z.enum(['REPS', 'DURATION']),
});
export type StrengthCandidate = z.infer<typeof strengthCandidateSchema>;

export const strengthInputSchema = z.object({
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  goal: z.enum(['HYPERTROPHY', 'STRENGTH', 'MUSCULAR_ENDURANCE']),
  phase: z.enum(['ADAPTATION', 'HYPERTROPHY', 'STRENGTH', 'DELOAD']),
  /** Soma das frequências semanais das sessões do bloco. */
  sessionsPerWeek: z.number().int().min(1).max(6),
  /** Teto de duração de uma sessão, em minutos. */
  minutesPerSession: z.number().int().min(20).max(180),
  weeksInBlock: z.number().int().min(2).max(12),
  split: z.enum(['FULL_BODY', 'UPPER_LOWER', 'PUSH_PULL_LEGS', 'BODY_PART', 'NO_PREFERENCE']),
  /** Papel da força no plano (1 = principal). */
  modalityPriority: z.number().int().min(1).max(3),
  candidates: z.array(strengthCandidateSchema).min(8).max(160),
  /** Exercícios que o aluno gosta: preferir quando equivalentes. */
  preferredExerciseIds: z.array(z.string()).max(40),
});
export type StrengthInput = z.infer<typeof strengthInputSchema>;

/** Grupos que precisam receber volume direto quando a semana comporta (≥ 2 sessões). */
const MAJOR_GROUPS = ['peito', 'costas', 'ombro', 'quadríceps', 'posterior de coxa', 'glúteo'];
/** Tolerância do piso semanal: o piso da metodologia é meta, não gatilho de reprovação seca. */
const FLOOR_TOLERANCE = 0.6;
/** Grupo só é exigido (piso e frequência) se houver ao menos este número de exercícios viáveis. */
const MIN_OPTIONS_TO_REQUIRE = 3;
const WARMUP_MINUTES = 5;
const SECONDS_UNDER_TENSION_PER_SET = 45;

function isIsolation(pattern: string): boolean {
  return pattern === 'ISOLATION';
}

export const strengthValidators: Validator<StrengthInput, BlockOutput>[] = [
  // Só modalidade de força, na frequência pedida.
  (input, output) => {
    const violations: Violation[] = [];
    output.sessions.forEach((s, index) => {
      if (s.content.modality !== 'STRENGTH') {
        violations.push({
          path: `sessions.${index}.content.modality`,
          message: 'este bloco só contém sessões de musculação',
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

  // Exercícios do universo permitido, sem repetir na sessão, dentro do limite por sessão.
  (input, output, context) => {
    const violations: Violation[] = [];
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const rules = strengthRules(context.methodology.STRENGTH, input.level);
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      const seen = new Set<string>();
      session.content.exercises.forEach((exercise, ei) => {
        const path = `sessions.${si}.content.exercises.${ei}`;
        const candidate = byId.get(exercise.exerciseId);
        if (!candidate) {
          violations.push({
            path: `${path}.exerciseId`,
            message: `"${exercise.exerciseId}" não está entre os exercícios permitidos`,
          });
        } else if (candidate.measurement === 'DURATION' && exercise.reps) {
          violations.push({ path: `${path}.reps`, message: 'este exercício é por tempo' });
        } else if (candidate.measurement === 'REPS' && exercise.durationSeconds) {
          violations.push({
            path: `${path}.durationSeconds`,
            message: 'este exercício é por repetições',
          });
        }
        if (seen.has(exercise.exerciseId)) {
          violations.push({ path: `${path}.exerciseId`, message: 'exercício repetido na sessão' });
        }
        seen.add(exercise.exerciseId);
      });
      if (
        rules.maxExercisesPerSession !== null &&
        session.content.exercises.length > rules.maxExercisesPerSession
      ) {
        violations.push({
          path: `sessions.${si}.content.exercises`,
          message: `no máximo ${rules.maxExercisesPerSession} exercícios por sessão`,
        });
      }
    });
    return violations;
  },

  // Volume: teto por grupo por sessão, faixa semanal, frequência por grupo.
  (input, output, context) => {
    const rules = strengthRules(context.methodology.STRENGTH, input.level);
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const weekly = new Map<string, number>();
    const frequency = new Map<string, number>();
    const violations: Violation[] = [];
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      const perSession = new Map<string, number>();
      for (const exercise of session.content.exercises) {
        // Série direta = grupo PRIMÁRIO (o primeiro do catálogo); os demais são volume indireto.
        const primary = byId.get(exercise.exerciseId)?.muscleGroups[0];
        if (!primary) continue;
        perSession.set(primary, (perSession.get(primary) ?? 0) + exercise.sets);
      }
      for (const [group, sets] of perSession) {
        weekly.set(group, (weekly.get(group) ?? 0) + sets * session.weeklyFrequency);
        frequency.set(group, (frequency.get(group) ?? 0) + session.weeklyFrequency);
        if (rules.maxSetsPerMusclePerSession !== null && sets > rules.maxSetsPerMusclePerSession) {
          violations.push({
            path: `sessions.${si}`,
            message: `${sets} séries de ${group} numa sessão (máximo ${rules.maxSetsPerMusclePerSession})`,
          });
        }
      }
    });
    // Grupo com pouca opção viável (ex.: costas com dor no ombro, posterior em casa) não é
    // exigido: o piso e a frequência só valem onde há exercício suficiente para cumpri-los.
    const optionsPerGroup = new Map<string, number>();
    for (const c of input.candidates) {
      const group = c.muscleGroups[0];
      if (group) optionsPerGroup.set(group, (optionsPerGroup.get(group) ?? 0) + 1);
    }
    const required = MAJOR_GROUPS.filter(
      (group) => (optionsPerGroup.get(group) ?? 0) >= MIN_OPTIONS_TO_REQUIRE,
    );
    const summary = `Volume atual por grupo (séries/semana): ${[...weekly.entries()].map(([g, n]) => `${g} ${n}`).join(', ') || 'nenhum'}.`;
    const range = rules.weeklySetsPerMuscle;
    if (range) {
      for (const [group, sets] of weekly) {
        if (sets > range.max) {
          violations.push({
            path: 'sessions',
            message: `${sets} séries/semana de ${group} (máximo ${range.max} para o nível). ${summary}`,
          });
        }
      }
      if (input.sessionsPerWeek >= 2) {
        for (const group of required) {
          const sets = weekly.get(group) ?? 0;
          if (sets < Math.floor(range.min * FLOOR_TOLERANCE)) {
            violations.push({
              path: 'sessions',
              message: `${group} com ${sets} séries/semana; o piso do nível é ${range.min}. ${summary}`,
            });
          }
        }
      }
    }
    if (
      rules.minFrequencyPerMuscle !== null &&
      input.sessionsPerWeek >= rules.minFrequencyPerMuscle
    ) {
      for (const group of required) {
        if ((frequency.get(group) ?? 0) < rules.minFrequencyPerMuscle) {
          violations.push({
            path: 'sessions',
            message: `${group} treinado ${frequency.get(group) ?? 0}×/semana; a metodologia pede ao menos ${rules.minFrequencyPerMuscle}× (inclua ${group} em mais sessões). ${summary}`,
          });
        }
      }
    }
    return violations;
  },

  // Esforço, repetições e descanso dentro das faixas da metodologia.
  (input, output, context) => {
    const rules = strengthRules(context.methodology.STRENGTH, input.level);
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const violations: Violation[] = [];
    const rir = rules.rirByPhase[input.phase];
    const reps = rules.repsByGoal[input.goal];
    const enduranceMax = rules.repsByGoal['MUSCULAR_ENDURANCE']?.max ?? reps?.max;
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      session.content.exercises.forEach((exercise, ei) => {
        const path = `sessions.${si}.content.exercises.${ei}`;
        if (
          rir &&
          exercise.rir !== undefined &&
          (exercise.rir < rir.min || exercise.rir > rir.max)
        ) {
          violations.push({
            path: `${path}.rir`,
            message: `RIR ${exercise.rir} fora da faixa da fase ${input.phase} (${rir.min}–${rir.max})`,
          });
        }
        if (exercise.reps && reps && enduranceMax !== undefined) {
          if (
            exercise.reps.min < reps.min ||
            exercise.reps.max > Math.max(reps.max, enduranceMax)
          ) {
            violations.push({
              path: `${path}.reps`,
              message: `repetições ${exercise.reps.min}–${exercise.reps.max} fora da faixa do objetivo (${reps.min}–${Math.max(reps.max, enduranceMax)})`,
            });
          }
        }
        const candidate = byId.get(exercise.exerciseId);
        const kind = candidate && isIsolation(candidate.pattern) ? 'ISOLATION' : 'COMPOUND';
        const rest = rules.restByKind[kind];
        if (
          rest &&
          (exercise.restSeconds < rest.min ||
            exercise.restSeconds >
              Math.max(rest.max, rules.restByKind['STRENGTH_MAIN']?.max ?? rest.max))
        ) {
          violations.push({
            path: `${path}.restSeconds`,
            message: `descanso de ${exercise.restSeconds}s fora da faixa (${rest.min}–${rest.max}s)`,
          });
        }
      });
    });
    return violations;
  },

  // A sessão cabe no tempo que o aluno tem: série × (execução + descanso) + aquecimento.
  (input, output) => {
    const violations: Violation[] = [];
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      const seconds = session.content.exercises.reduce(
        (sum, e) => sum + e.sets * (SECONDS_UNDER_TENSION_PER_SET + e.restSeconds),
        0,
      );
      const minutes = WARMUP_MINUTES + seconds / 60;
      if (session.estimatedMinutes > input.minutesPerSession) {
        violations.push({
          path: `sessions.${si}.estimatedMinutes`,
          message: `${session.estimatedMinutes} min passa do tempo disponível (${input.minutesPerSession} min)`,
        });
      }
      if (minutes > input.minutesPerSession * 1.1) {
        const sets = session.content.exercises.reduce((sum, e) => sum + e.sets, 0);
        const perSet = seconds / Math.max(1, sets);
        const budget = Math.floor(((input.minutesPerSession - WARMUP_MINUTES) * 60) / perSet);
        violations.push({
          path: `sessions.${si}.content.exercises`,
          message: `séries e descansos somam ~${Math.round(minutes)} min; o aluno tem ${input.minutesPerSession} min. Cada série custa ~${Math.round(perSet)} s com o descanso atual: cabem no máximo ~${budget} séries nesta sessão (hoje ${sets}) — corte séries ou exercícios`,
        });
      }
      if (session.estimatedMinutes < minutes * 0.7) {
        violations.push({
          path: `sessions.${si}.estimatedMinutes`,
          message: `estimativa de ${session.estimatedMinutes} min não bate com o conteúdo (~${Math.round(minutes)} min)`,
        });
      }
    });
    return violations;
  },

  (_input, output) => outputLanguageViolations(output),
];

export const strengthTask = defineAgentTask<StrengthInput, BlockOutput>({
  id: 'strength.build_block',
  role: 'Treinador de musculação da MOVIVO. Você monta blocos de treino de força seguros, progressivos e que cabem na rotina real do aluno, seguindo a metodologia publicada pelos profissionais de Educação Física.',
  instructions: `Monte o bloco de musculação do aluno.

Regras de montagem:
1. Use SOMENTE exercícios da lista "candidates" (exerciseId exato). Eles já respeitam local, nível e limitações do aluno; prefira os de "preferredExerciseIds" quando forem equivalentes.
2. A soma de weeklyFrequency das sessões deve ser exatamente "sessionsPerWeek". Respeite a divisão ("split"); com NO_PREFERENCE, escolha a que melhor distribui o volume e a recuperação entre os dias.
3. Volume, frequência por grupo, esforço (RIR da fase), repetições do objetivo e descanso devem estar DENTRO das faixas da metodologia. O grupo muscular de uma série é o primeiro da lista "muscleGroups".
4. Cada sessão tem de caber em "minutesPerSession": séries × (execução + descanso) + aquecimento. Estime estimatedMinutes honestamente; estimatedRpe (CR-10) coerente com o esforço.
5. Ordem: multiarticulares primeiro, isolados depois. Ofereça progressão clara em "notes" (como e quando subir carga) em linguagem simples.
6. priority: marque como KEY as sessões que não podem faltar na semana (as de maior volume do foco principal). Exercício por tempo usa durationSeconds, nunca reps.
7. phases descrevem o bloco (nome, foco, semanas; endsWithDeload quando a metodologia pedir recuperação). summary: 2 a 3 frases claras para o aluno, sem prometer resultado.`,
  tier: 'REASONING',
  methodology: ['STRENGTH'],
  state: ['identity', 'goals', 'preferences', 'training'],
  input: strengthInputSchema,
  output: blockOutputSchema,
  validators: strengthValidators,
  maxCorrectionRounds: 3,
});
