/**
 * Tarefa `strength.build_block` — um bloco de musculação.
 *
 * O código entrega só exercícios SEGUROS e viáveis (já filtrados por local, nível,
 * contraindicação e rejeições do aluno); o modelo monta as sessões; o validador confere volume,
 * frequência, esforço, descanso e tempo contra a metodologia publicada.
 */
import { z } from 'zod';

import { mesocycleSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { strengthRules } from '../calc/params';
import { blockOutputSchema, totalFrequency, type BlockOutput } from './blocks';
import {
  outputLanguageViolations,
  weekdayMentionViolations,
  BODY_COMPOSITION_RULE,
  PROFESSIONAL_INSTRUCTION_RULE,
  professionalInstructionSchema,
} from './common';

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

/** Cardio já cadastrado no catálogo que a musculação pode usar como cardio de apoio. */
export const cardioCandidateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  intensity: z.enum(['MODERATE', 'VIGOROUS']),
});
export type CardioCandidate = z.infer<typeof cardioCandidateSchema>;

/** Meta de cardio da OMS que cabe dentro das sessões de musculação (calculada pelo código). */
export const strengthCardioSchema = z.object({
  /** Meta semanal total em minutos de atividade moderada (OMS: 150 a 300). */
  targetMinutes: z.number().int().min(0).max(300),
  /** Quanto disso corrida e esporte externo já cobrem. */
  coveredMinutes: z.number().int().min(0).max(1_000),
  /** Cardio a prescrever nas sessões de musculação, somando a semana. */
  weeklyMinutes: z.number().int().min(5).max(300),
  perSessionMinutes: z.object({
    min: z.number().int().min(5).max(30),
    max: z.number().int().min(5).max(30),
  }),
  /** O que não cabe nas sessões: o aluno completa com caminhadas no dia a dia. */
  leftoverMinutes: z.number().int().min(0).max(300),
  candidates: z.array(cardioCandidateSchema).min(1).max(12),
});

export const strengthInputSchema = z.object({
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  goal: z.enum(['HYPERTROPHY', 'STRENGTH', 'MUSCULAR_ENDURANCE']),
  /** Mesociclo do bloco, decidido pelo código (ou pela reavaliação do ciclo). */
  phase: mesocycleSchema,
  /** Soma das frequências semanais das sessões do bloco. */
  sessionsPerWeek: z.number().int().min(1).max(6),
  /** Teto de duração de uma sessão, em minutos. */
  minutesPerSession: z.number().int().min(20).max(180),
  /** Duração do mesociclo pela Metodologia (`blockWeeksByPhase`); deload pode ter 1 semana. */
  weeksInBlock: z.number().int().min(1).max(12),
  split: z.enum(['FULL_BODY', 'UPPER_LOWER', 'PUSH_PULL_LEGS', 'BODY_PART', 'NO_PREFERENCE']),
  /** Papel da força no plano (1 = principal). */
  modalityPriority: z.number().int().min(1).max(3),
  candidates: z.array(strengthCandidateSchema).min(8).max(160),
  /** Exercícios que o aluno gosta: preferir quando equivalentes. */
  preferredExerciseIds: z.array(z.string()).max(40),
  /** Grupos musculares em que o aluno pediu mais ênfase (até 2 regiões). */
  emphasisMuscleGroups: z.array(z.string().max(40)).max(6).optional(),
  /**
   * Orçamento de tempo calculado pelo sistema (`strengthTimeBudget`): séries que cabem por sessão
   * com o descanso mínimo e o mínimo semanal por grupo principal que cabe nesse tempo.
   */
  timeBudget: z
    .object({
      maxSetsPerSession: z.number().int().min(1).max(60),
      restSeconds: z.object({
        compound: z.number().int().min(0).max(600),
        isolation: z.number().int().min(0).max(600),
      }),
      minWeeklySetsPerMajorGroup: z.number().int().min(1).max(40),
    })
    .optional(),
  /** Cardio de apoio (OMS). Ausente = nada a prescrever (corrida/esporte já cobrem a meta). */
  cardio: strengthCardioSchema.optional(),
  /**
   * Meta de atividade aeróbia (OMS) que NÃO cabe dentro das sessões de musculação (sessão curta):
   * o aluno completa com caminhadas e atividade do dia a dia. Só quando não há `cardio`.
   */
  dailyActivityMinutes: z.number().int().min(5).max(300).optional(),
  professionalInstruction: professionalInstructionSchema,
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

type RestKind = 'COMPOUND' | 'ISOLATION' | 'CORE';

/**
 * Tipo de descanso pelo `pattern` do catálogo. CORE (abdominal, prancha, lombar) descansa como
 * isolado: tratá-lo como multiarticular exigia 120 s+ numa prancha e reprovava o bloco inteiro.
 * Exercício fora dos candidatos (já recusado por outro validador) conta como multiarticular.
 */
function restKindOf(candidate: StrengthCandidate | undefined): RestKind {
  if (candidate?.pattern === 'ISOLATION') return 'ISOLATION';
  if (candidate?.pattern === 'CORE') return 'CORE';
  return 'COMPOUND';
}

const REST_KIND_LABEL: Record<RestKind, string> = {
  COMPOUND: 'multiarticular',
  ISOLATION: 'isolado',
  CORE: 'core',
};

/**
 * Faixa de descanso aceita para o tipo: a da metodologia (CORE sem linha própria usa a de
 * isolado) e, no teto, até o descanso dos multiarticulares-chave de força.
 */
function restRangeFor(
  rules: ReturnType<typeof strengthRules>,
  kind: RestKind,
): { min: number; max: number; label: string } | null {
  const own = rules.restByKind[kind];
  const range = own ?? (kind === 'CORE' ? rules.restByKind['ISOLATION'] : undefined);
  if (!range) return null;
  const label = kind === 'CORE' && !own ? 'core (descansa como isolado)' : REST_KIND_LABEL[kind];
  return {
    min: range.min,
    max: Math.max(range.max, rules.restByKind['STRENGTH_MAIN']?.max ?? range.max),
    label,
  };
}

function cardioIdsOf(input: StrengthInput): Set<string> {
  return new Set(input.cardio?.candidates.map((c) => c.id));
}

/** Máximo de cardio vigoroso na parte de cardio da semana (o resto é moderado). */
const MAX_VIGOROUS_SHARE = 0.5;
const CARDIO_WEEK_TOLERANCE_LOW = 0.7;
const CARDIO_WEEK_TOLERANCE_HIGH = 1.25;

const cardioMinutes = (e: { sets: number; durationSeconds?: number }) =>
  (e.sets * (e.durationSeconds ?? 0)) / 60;

/** Descanso mínimo da metodologia (sem tabela publicada: 90 s multiarticulares, 60 s isolados). */
const DEFAULT_REST_MIN = { compound: 90, isolation: 60 };

export interface StrengthTimeBudget {
  /** Séries que cabem numa sessão com o descanso mínimo (o cardio já descontado). */
  maxSetsPerSession: number;
  /** Descanso a usar quando o tempo é curto. */
  restSeconds: { compound: number; isolation: number };
  /** Mínimo semanal de cada grupo principal: o piso da metodologia, limitado ao que cabe no tempo. */
  minWeeklySetsPerMajorGroup: number;
}

/**
 * Orçamento de tempo da musculação. Uma conta só, usada na entrada do modelo, no piso de volume e
 * na mensagem de correção: o piso nunca exige mais séries do que cabem na semana do aluno, e o
 * caminho para caber é primeiro descansar o mínimo, depois cortar séries.
 */
export function strengthTimeBudget(
  input: Pick<StrengthInput, 'minutesPerSession' | 'sessionsPerWeek' | 'candidates' | 'cardio'>,
  rules: ReturnType<typeof strengthRules>,
): StrengthTimeBudget {
  const restSeconds = {
    compound: rules.restByKind['COMPOUND']?.min ?? DEFAULT_REST_MIN.compound,
    isolation: rules.restByKind['ISOLATION']?.min ?? DEFAULT_REST_MIN.isolation,
  };
  // Dois multiarticulares para cada isolado: a média de uma sessão típica.
  const perSet =
    SECONDS_UNDER_TENSION_PER_SET + (restSeconds.compound * 2 + restSeconds.isolation) / 3;
  const cardio = input.cardio?.perSessionMinutes.max ?? 0;
  const maxSetsPerSession = Math.max(
    4,
    Math.floor(((input.minutesPerSession - WARMUP_MINUTES - cardio) * 60) / perSet),
  );
  const optionsPerGroup = new Map<string, number>();
  for (const c of input.candidates) {
    const group = c.muscleGroups[0];
    if (group) optionsPerGroup.set(group, (optionsPerGroup.get(group) ?? 0) + 1);
  }
  const required = MAJOR_GROUPS.filter(
    (group) => (optionsPerGroup.get(group) ?? 0) >= MIN_OPTIONS_TO_REQUIRE,
  ).length;
  const floor = rules.weeklySetsPerMuscle
    ? Math.floor(rules.weeklySetsPerMuscle.min * FLOOR_TOLERANCE)
    : 0;
  const fits =
    required > 0 ? Math.floor((maxSetsPerSession * input.sessionsPerWeek) / required) : floor;
  return {
    maxSetsPerSession,
    restSeconds,
    minWeeklySetsPerMajorGroup: Math.max(1, Math.min(floor, fits)),
  };
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
    const cardioIds = cardioIdsOf(input);
    const rules = strengthRules(context.methodology.STRENGTH, input.level);
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      const seen = new Set<string>();
      session.content.exercises.forEach((exercise, ei) => {
        const path = `sessions.${si}.content.exercises.${ei}`;
        if (cardioIds.has(exercise.exerciseId)) {
          // Cardio de apoio: sempre por tempo; as demais regras ficam no validador de cardio.
          if (exercise.reps || !exercise.durationSeconds) {
            violations.push({
              path: `${path}.durationSeconds`,
              message: 'cardio é prescrito por tempo (durationSeconds), nunca por repetições',
            });
          }
          if (seen.has(exercise.exerciseId)) {
            violations.push({
              path: `${path}.exerciseId`,
              message: 'exercício repetido na sessão',
            });
          }
          seen.add(exercise.exerciseId);
          return;
        }
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
      const resistanceCount = session.content.exercises.filter(
        (e) => !cardioIds.has(e.exerciseId),
      ).length;
      if (rules.maxExercisesPerSession !== null && resistanceCount > rules.maxExercisesPerSession) {
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
        const minimum = strengthTimeBudget(input, rules).minWeeklySetsPerMajorGroup;
        for (const group of required) {
          const sets = weekly.get(group) ?? 0;
          if (sets < minimum) {
            violations.push({
              path: 'sessions',
              // O mínimo real (não o piso cheio): pedir o piso cheio a todos os grupos estoura o
              // tempo da sessão, e o modelo passa a cortar um grupo inteiro para caber.
              message: `${group} com ${sets} séries/semana; o mínimo exigido é ${minimum} (o piso cheio de ${range.min} é meta, não obrigação). Se o tempo não comporta, tire séries dos grupos acima de ${minimum} e dê a ${group}. ${summary}`,
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

  // Ênfase que o aluno escolheu na anamnese: cada grupo escolhido recebe ao menos o volume médio
  // dos demais grupos principais (dentro do teto da metodologia). A foto complementa, não substitui.
  (input, output, context) => {
    const emphasis = input.emphasisMuscleGroups ?? [];
    if (emphasis.length === 0 || input.sessionsPerWeek < 2) return [];
    const rules = strengthRules(context.methodology.STRENGTH, input.level);
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const weekly = new Map<string, number>();
    for (const session of output.sessions) {
      if (session.content.modality !== 'STRENGTH') continue;
      for (const exercise of session.content.exercises) {
        const primary = byId.get(exercise.exerciseId)?.muscleGroups[0];
        if (primary) {
          weekly.set(primary, (weekly.get(primary) ?? 0) + exercise.sets * session.weeklyFrequency);
        }
      }
    }
    const optionsPerGroup = new Map<string, number>();
    for (const c of input.candidates) {
      const group = c.muscleGroups[0];
      if (group) optionsPerGroup.set(group, (optionsPerGroup.get(group) ?? 0) + 1);
    }
    const viable = (group: string) => (optionsPerGroup.get(group) ?? 0) >= MIN_OPTIONS_TO_REQUIRE;
    const others = MAJOR_GROUPS.filter((group) => !emphasis.includes(group) && viable(group));
    if (others.length === 0) return [];
    const average =
      others.reduce((sum, group) => sum + (weekly.get(group) ?? 0), 0) / others.length;
    const ceiling = rules.weeklySetsPerMuscle?.max ?? Number.POSITIVE_INFINITY;
    const target = Math.min(Math.ceil(average), ceiling);
    const violations: Violation[] = [];
    for (const group of emphasis.filter(viable)) {
      const sets = weekly.get(group) ?? 0;
      if (sets < target) {
        violations.push({
          path: 'sessions',
          message: `${group} é ênfase pedida pelo aluno e tem ${sets} séries/semana, abaixo da média dos demais grupos principais (${target}). Dê mais volume e frequência a ${group}.`,
        });
      }
    }
    return violations;
  },

  // Esforço, repetições e descanso dentro das faixas da metodologia.
  (input, output, context) => {
    const rules = strengthRules(context.methodology.STRENGTH, input.level);
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const cardioIds = cardioIdsOf(input);
    const violations: Violation[] = [];
    const rir = rules.rirByPhase[input.phase];
    const reps = rules.repsByGoal[input.goal];
    const enduranceMax = rules.repsByGoal['MUSCULAR_ENDURANCE']?.max ?? reps?.max;
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      session.content.exercises.forEach((exercise, ei) => {
        if (cardioIds.has(exercise.exerciseId)) return;
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
        const rest = restRangeFor(rules, restKindOf(candidate));
        if (rest && (exercise.restSeconds < rest.min || exercise.restSeconds > rest.max)) {
          // A mensagem diz como o exercício foi classificado: sem isso o modelo não sabe por que
          // a faixa é aquela e insiste no valor que considera certo.
          const name = candidate?.name ?? exercise.exerciseId;
          violations.push({
            path: `${path}.restSeconds`,
            message: `descanso de ${exercise.restSeconds}s em "${name}" fora da faixa de ${rest.label} (${rest.min}–${rest.max}s); use um valor dentro dela`,
          });
        }
      });
    });
    return violations;
  },

  // A sessão cabe no tempo que o aluno tem: série × (execução + descanso) + aquecimento.
  (input, output, context) => {
    const violations: Violation[] = [];
    const budget = strengthTimeBudget(
      input,
      strengthRules(context.methodology.STRENGTH, input.level),
    );
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      const seconds = session.content.exercises.reduce(
        (sum, e) =>
          sum + e.sets * ((e.durationSeconds ?? SECONDS_UNDER_TENSION_PER_SET) + e.restSeconds),
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
        // O conselho conta só as séries de musculação: o cardio tem tempo reservado à parte.
        const cardioIds = cardioIdsOf(input);
        const resistance = session.content.exercises.filter((e) => !cardioIds.has(e.exerciseId));
        const sets = resistance.reduce((sum, e) => sum + e.sets, 0);
        const { compound, isolation } = budget.restSeconds;
        violations.push({
          path: `sessions.${si}.content.exercises`,
          message: `séries, descansos e cardio somam ~${Math.round(minutes)} min; o aluno tem ${input.minutesPerSession} min. Antes de cortar séries, use o descanso mínimo da metodologia (${compound} s nos multiarticulares, ${isolation} s nos isolados e no core): assim cabem até ${budget.maxSetsPerSession} séries de musculação nesta sessão (hoje ${sets}). Só corte séries de grupos acima de ${budget.minWeeklySetsPerMajorGroup} séries/semana, o mínimo de cada grupo principal.`,
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

  // Cardio de apoio (OMS): vai no fim da sessão, soma a meta da semana e se espalha pelas sessões.
  (input, output) => {
    const cardio = input.cardio;
    if (!cardio) return [];
    const ids = cardioIdsOf(input);
    const intensity = new Map(cardio.candidates.map((c) => [c.id, c.intensity]));
    const violations: Violation[] = [];
    let weekly = 0;
    let vigorous = 0;
    let sessionsWithCardio = 0;
    output.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      const exercises = session.content.exercises;
      const first = exercises.findIndex((e) => ids.has(e.exerciseId));
      if (first < 0) return;
      sessionsWithCardio += session.weeklyFrequency;
      if (exercises.slice(first).some((e) => !ids.has(e.exerciseId))) {
        violations.push({
          path: `sessions.${si}.content.exercises`,
          message: 'o cardio vai no fim da sessão, depois da musculação',
        });
      }
      const minutes = exercises
        .filter((e) => ids.has(e.exerciseId))
        .reduce((sum, e) => sum + cardioMinutes(e), 0);
      if (
        minutes > cardio.perSessionMinutes.max + 1 ||
        minutes < cardio.perSessionMinutes.min - 1
      ) {
        violations.push({
          path: `sessions.${si}.content.exercises`,
          message: `cardio de ${Math.round(minutes)} min na sessão; a faixa é ${cardio.perSessionMinutes.min}–${cardio.perSessionMinutes.max} min`,
        });
      }
      for (const e of exercises) {
        if (!ids.has(e.exerciseId)) continue;
        const m = cardioMinutes(e) * session.weeklyFrequency;
        weekly += m;
        if (intensity.get(e.exerciseId) === 'VIGOROUS') vigorous += m;
      }
    });
    const low = Math.floor(cardio.weeklyMinutes * CARDIO_WEEK_TOLERANCE_LOW);
    const high = Math.ceil(cardio.weeklyMinutes * CARDIO_WEEK_TOLERANCE_HIGH);
    if (weekly < low || weekly > high) {
      violations.push({
        path: 'sessions',
        message: `${Math.round(weekly)} min de cardio na semana; a meta para as sessões é ${cardio.weeklyMinutes} min (aceita ${low}–${high}). Distribua o cardio entre as sessões de musculação.`,
      });
    }
    const needed = Math.min(
      input.sessionsPerWeek,
      Math.ceil(cardio.weeklyMinutes / cardio.perSessionMinutes.max),
    );
    if (sessionsWithCardio < needed) {
      violations.push({
        path: 'sessions',
        message: `cardio em ${sessionsWithCardio} sessão(ões) por semana; distribua em pelo menos ${needed}`,
      });
    }
    if (weekly > 0 && vigorous / weekly > MAX_VIGOROUS_SHARE) {
      violations.push({
        path: 'sessions',
        message:
          'no máximo metade do cardio da semana pode ser vigoroso (HIIT, tiros); o resto é moderado',
      });
    }
    return violations;
  },

  (_input, output) =>
    weekdayMentionViolations([
      { path: 'summary', text: output.summary },
      ...output.notes.map((text, i) => ({ path: `notes.${i}`, text })),
    ]),

  (_input, output) => outputLanguageViolations(output),
];

export const strengthTask = defineAgentTask<StrengthInput, BlockOutput>({
  id: 'strength.build_block',
  role: 'Treinador de musculação da MOVIVO. Você monta blocos de treino de força seguros, progressivos e que cabem na rotina real do aluno, seguindo a metodologia publicada pelos profissionais de Educação Física.',
  instructions: `Monte o bloco de musculação do aluno.

Regras de montagem:
1. Use SOMENTE exercícios da lista "candidates" (exerciseId exato). Eles já respeitam local, nível e limitações do aluno; prefira os de "preferredExerciseIds" quando forem equivalentes.
2. A soma de weeklyFrequency das sessões deve ser exatamente "sessionsPerWeek". Respeite a divisão ("split"); com NO_PREFERENCE, escolha a que melhor distribui o volume e a recuperação entre os dias.
3. Volume, frequência por grupo, esforço (RIR da fase), repetições do objetivo e descanso devem estar DENTRO das faixas da metodologia. O grupo muscular de uma série é o primeiro da lista "muscleGroups". Todo grupo principal com opções em "candidates" (peito, costas, ombro, quadríceps, posterior de coxa, glúteo) precisa de volume direto e da frequência mínima por grupo. Quando o tempo não comporta o piso semanal cheio em todos, distribua primeiro: cada grupo principal com ao menos ${Math.round(FLOOR_TOLERANCE * 100)}% do piso do nível, e só depois dê volume extra (inclusive à ênfase). Nunca zere um grupo principal para caber no tempo.
4. Cada sessão tem de caber em "minutesPerSession": séries × (execução + descanso) + aquecimento. Estime estimatedMinutes honestamente; estimatedRpe (CR-10) coerente com o esforço.
5. Ordem: multiarticulares primeiro, isolados depois. O tipo de cada exercício para o descanso vem do "pattern" do candidato: ISOLATION e CORE (abdominal, prancha, lombar) descansam na faixa de isolado; todos os outros padrões, na de multiarticular.Ofereça progressão clara em "notes" (como e quando subir carga) em linguagem simples. Limites de texto: no máximo 5 notas do bloco, cada uma com até 250 caracteres e uma ideia só; "notes" de cada exercício com até 300 caracteres.
6. priority: marque como KEY as sessões que não podem faltar na semana (as de maior volume do foco principal). Exercício por tempo usa durationSeconds, nunca reps.
7. Se "emphasisMuscleGroups" vier preenchida, é a ênfase que o ALUNO escolheu e ela vem SEMPRE em primeiro lugar: dê a esses grupos mais volume e frequência (ao menos a média dos demais grupos principais), sempre DENTRO das faixas da metodologia e sem sacrificar os demais grupos principais. Os grupos "TO_DEVELOP" da avaliação por foto ("bodyComposition") vêm depois: complementam a ênfase sem tirar volume dela; se o aluno não escolheu ênfase (corpo todo), eles passam a orientar onde dar mais volume.
8. "phase" é o mesociclo deste bloco e "weeksInBlock" a duração dele, ambos já decididos: prescreva repetições, RIR, séries e descanso pelas faixas da metodologia para essa fase (Adaptação: prioridade à execução e menor volume; Força: menos séries e mais descanso nos multiarticulares-chave; Recuperação: volume reduzido mantendo frequência e exercícios). phases: UMA fase, com o foco do bloco em uma frase e endsWithDeload quando a metodologia ou a orientação pedirem recuperação no fim; o nome e as semanas são fixados pelo sistema. summary: 2 a 3 frases claras para o aluno, sem prometer resultado e sem citar dias da semana (a agenda é calculada pelo sistema).
9. ${BODY_COMPOSITION_RULE}
10. ${PROFESSIONAL_INSTRUCTION_RULE}
11. CARDIO (OMS). Quando "cardio" vier preenchido, a musculação carrega parte da atividade aeróbia da semana (a OMS recomenda 150 a 300 min de atividade moderada por semana, ou 75 a 150 de vigorosa, e musculação em 2 ou mais dias): distribua "cardio.weeklyMinutes" entre as sessões de musculação, de "perSessionMinutes.min" a "perSessionMinutes.max" por sessão, SEMPRE no fim da sessão, depois da força. Use SOMENTE os exercícios de "cardio.candidates" (exerciseId exato), por tempo (durationSeconds, sets 1, restSeconds 0, loadStrategy BODYWEIGHT, sem reps nem rir). Varie o equipamento entre as sessões (esteira, elíptico, bicicleta, simulador de escadas…); intensidade MODERATE em ritmo de conversa (PSE 5–6) e, no máximo, metade do tempo em VIGOROUS (HIIT/tiros, PSE 7–8) apenas quando houver exercício vigoroso na lista. Descreva o ritmo em "notes" do exercício. O tempo do cardio já está reservado dentro de "minutesPerSession" (a parte da força fica com o resto): não tire volume da força além do que o tempo da força exige. Se "cardio.leftoverMinutes" > 0, diga em "notes" do bloco que o restante da meta se completa com caminhadas leves no dia a dia. Sem "cardio", não inclua cardio. Se vier "dailyActivityMinutes", a sessão é curta demais para cardio sem tirar volume da força: não inclua cardio e diga em "notes" do bloco, em uma nota curta, que a meta de atividade aeróbia da semana (cerca de esse tempo) se completa com caminhadas e atividade no dia a dia.
12. TEMPO: "timeBudget" vem calculado pelo sistema. Planeje cada sessão com no máximo "timeBudget.maxSetsPerSession" séries de musculação e dê a CADA grupo principal pelo menos "timeBudget.minWeeklySetsPerMajorGroup" séries na semana. Quando o tempo é curto, use os descansos de "timeBudget.restSeconds" (multiarticulares e isolados) antes de cortar séries; só depois corte séries dos grupos que estão acima do mínimo. Confira antes de responder: cada grupo principal (peito, costas, ombro, quadríceps, posterior de coxa, glúteo) aparece em pelo menos 2 sessões da semana (com 2 sessões, nas duas) e soma o mínimo semanal; não concentre volume em peito, costas ou quadríceps deixando glúteo ou posterior abaixo do mínimo.`,
  tier: 'REASONING',
  methodology: ['STRENGTH'],
  state: ['identity', 'goals', 'preferences', 'training', 'bodyComposition'],
  input: strengthInputSchema,
  output: blockOutputSchema,
  validators: strengthValidators,
  maxCorrectionRounds: 3,
});
