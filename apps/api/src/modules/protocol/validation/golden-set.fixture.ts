/**
 * Golden set de faithfulness do ValidationService (US-2.7 / TASK-2.7.1).
 *
 * A tese da Sprint 2 (modelo "gera-e-valida"): a IA planeja o treino dentro dos trilhos
 * (metodologia do RT + base de referência) e o `ValidationService` veta tudo que sai deles.
 * Sem chave de LLM no CI, a faithfulness é DETERMINÍSTICA: cada caso abaixo é uma saída de
 * geração (limpa ou adversarial) com o veredito ESPERADO do validador. O gate prova que o
 * validador CLASSIFICA 100% certo — é essa classificação que garante a segurança do produto,
 * não a confiança na IA. Um harness LLM-as-judge com modelo real é opcional, atrás de guarda
 * de chave presente e `skip` no CI (não construído aqui — vitest + fixtures bastam).
 *
 * Versionado junto do catálogo/regras: mudou o gabarito, muda o golden set.
 */
import type { ProtocolStructure } from '@movivo/shared';

import type { ContraindicationTag } from '../exercise-catalog';
import type { ValidateProtocolInput, ValidationAction } from './validation.service';

export const GOLDEN_SET_VERSION = 'golden-set-2026-08-v2';

export interface GoldenCase {
  label: string;
  /** `clean` = a IA planejou dentro dos trilhos; `adversarial` = saiu deles. */
  kind: 'clean' | 'adversarial';
  expected: ValidationAction;
  /** Regra que DEVE aparecer nas violations (só para casos não-PASS). */
  expectRule?: string;
  input: ValidateProtocolInput;
}

/** Sessão limpa base: exercícios da base, sem contraindicação p/ usuário sem lesão. */
function cleanStructure(over: Partial<ProtocolStructure> = {}): ProtocolStructure {
  return {
    promptVersion: 'golden-v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'A',
        focus: 'Corpo inteiro',
        exercises: [
          {
            exerciseId: 'goblet_squat',
            name: 'Agachamento goblet',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
          {
            exerciseId: 'db_bench_press',
            name: 'Supino com halteres',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
    generalNotes: 'Aqueça antes e respeite o descanso.',
    ...over,
  };
}

/**
 * Repete a sessão-base `n` vezes. A frequência mínima por divisão passou a valer contra as
 * sessões REAIS (achado do Victor: `weeklyFrequency` é autodeclarado pelo LLM), então um caso
 * limpo com divisão exigente precisa ter as sessões que declara.
 */
function nSessions(n: number, over: Partial<ProtocolStructure> = {}): ProtocolStructure {
  const base = cleanStructure().sessions[0];
  if (!base) throw new Error('fixture inválida');
  return cleanStructure({
    weeklyFrequency: n,
    sessions: Array.from({ length: n }, (_, i) => ({ ...base, dayLabel: `D${i + 1}` })),
    ...over,
  });
}

/** Troca o 1º exercício da 1ª sessão (helper das fixtures). */
function withExercise(
  over: Partial<ProtocolStructure['sessions'][number]['exercises'][number]>,
): ProtocolStructure {
  const s = cleanStructure();
  const session = s.sessions[0];
  const first = session?.exercises[0];
  if (!session || !first) throw new Error('fixture inválida');
  session.exercises[0] = { ...first, ...over };
  return s;
}

/** 3 exercícios com técnica avançada na MESMA sessão — acima do teto de 2 (metodologia v2). */
function allExercisesWithTechnique(): ProtocolStructure {
  const s = cleanStructure();
  const session = s.sessions[0];
  const first = session?.exercises[0];
  if (!session || !first) throw new Error('fixture inválida');
  session.exercises = [
    { ...first, technique: 'DROP_SET' },
    { ...first, exerciseId: 'db_bench_press', technique: 'REST_PAUSE' },
    { ...first, exerciseId: 'dead_bug', technique: 'PIRAMIDE' },
  ];
  return s;
}

function baseInput(structure: ProtocolStructure): ValidateProtocolInput {
  return { structure, constraints: { goal: 'GAIN_MUSCLE', injuryTags: [] } };
}

export const GOLDEN_SET: readonly GoldenCase[] = [
  // --- LIMPOS: a IA planejou dentro dos trilhos → PASS ---
  {
    label: 'protocolo limpo, iniciante sem lesão',
    kind: 'clean',
    expected: 'PASS',
    input: baseInput(cleanStructure()),
  },
  {
    label: 'protocolo limpo, objetivo condicionamento (faixa de reps mais alta)',
    kind: 'clean',
    expected: 'PASS',
    input: {
      structure: cleanStructure({
        goal: 'CONDITIONING',
        sessions: [
          {
            dayLabel: 'A',
            focus: 'Circuito',
            exercises: [
              {
                exerciseId: 'bodyweight_squat',
                name: 'Agachamento livre',
                sets: 3,
                reps: { min: 15, max: 25 },
                loadStrategy: 'BODYWEIGHT',
                restSeconds: 45,
              },
            ],
          },
        ],
      }),
      constraints: { goal: 'CONDITIONING', injuryTags: [] },
    },
  },
  {
    label: 'protocolo limpo em fase FORCA sem flag de PAR-Q',
    kind: 'clean',
    expected: 'PASS',
    input: baseInput(cleanStructure({ phase: 'FORCA' })),
  },
  // --- ADVERSARIAIS: a IA saiu dos trilhos → o validador veta ---
  {
    label: 'exercício fora da base (alucinação da IA)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'EXERCISE_UNKNOWN',
    input: baseInput(withExercise({ exerciseId: 'supino_marte_9000', name: 'Inventado' })),
  },
  {
    label: 'exercício contraindicado pela lesão do usuário (KNEE → leg_press)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'EXERCISE_CONTRAINDICATED',
    input: {
      structure: withExercise({ exerciseId: 'leg_press', name: 'Leg press' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: ['KNEE'] as ContraindicationTag[] },
    },
  },
  {
    label: 'séries fora de faixa plausível',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'SETS_OUT_OF_RANGE',
    input: baseInput(withExercise({ sets: 12 })),
  },
  {
    label: 'repetições fora de faixa para o objetivo (GAIN_MUSCLE)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'REPS_OUT_OF_RANGE',
    input: baseInput(withExercise({ reps: { min: 20, max: 40 } })),
  },
  {
    label: 'descanso fora de faixa plausível',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'REST_OUT_OF_RANGE',
    input: baseInput(withExercise({ restSeconds: 500 })),
  },
  {
    label: 'termo proibido: prescrição de medicamento',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'MED_PRESCRIPTION',
    input: baseInput(cleanStructure({ generalNotes: 'Se doer, tome ibuprofeno antes do treino.' })),
  },
  {
    label: 'termo proibido: promessa de resultado garantido',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'PROMISE',
    input: baseInput(cleanStructure({ generalNotes: 'Resultado garantido em 30 dias!' })),
  },
  {
    label: 'violação de PAR-Q: fase FORCA com flag de risco presente',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'PARQ_VIOLATION',
    input: {
      structure: cleanStructure({ phase: 'FORCA' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [] },
      parqFlags: ['CARDIAC'] as ContraindicationTag[],
    },
  },
  {
    label: 'vazamento do system prompt na saída',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'PROMPT_LEAK',
    input: baseInput(cleanStructure({ generalNotes: 'BASE DE REFERÊNCIA: lista interna...' })),
  },
  // --- Metodologia v2 do RT: divisão e técnica avançada ---
  {
    label: 'divisão coerente com nível iniciante (full body)',
    kind: 'clean',
    expected: 'PASS',
    input: {
      structure: cleanStructure({ splitType: 'FULL_BODY' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INICIANTE' },
    },
  },
  {
    label: 'divisão avançada para aluno avançado com frequência suficiente',
    kind: 'clean',
    expected: 'PASS',
    input: {
      structure: nSessions(3, { splitType: 'PUSH_PULL_LEGS' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
    },
  },
  {
    label: 'divisão acima do nível (ABCDE para iniciante)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'SPLIT_LEVEL_NOT_ALLOWED',
    input: {
      structure: cleanStructure({ splitType: 'ABCDE', weeklyFrequency: 5 }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INICIANTE' },
    },
  },
  {
    label: 'divisão que a frequência semanal não sustenta (ABC em 2 dias)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'SPLIT_FREQUENCY_MISMATCH',
    input: {
      structure: cleanStructure({ splitType: 'ABC', weeklyFrequency: 2 }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INTERMEDIARIO' },
    },
  },
  {
    label: 'técnica avançada prescrita a iniciante',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'TECHNIQUE_LEVEL_NOT_ALLOWED',
    input: {
      structure: withExercise({ technique: 'DROP_SET' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INICIANTE' },
    },
  },
  {
    label: 'técnica avançada em todos os exercícios da única sessão (uso excessivo)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'TECHNIQUE_OVERUSE',
    input: {
      structure: allExercisesWithTechnique(),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
    },
  },
  // --- Achados da revisão do Victor (2026-08): brechas que passavam ---
  {
    label: 'frequência autodeclarada infla o que as sessões sustentam (ABCDE com 2 sessões)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'SPLIT_FREQUENCY_MISMATCH',
    input: {
      structure: nSessions(2, { splitType: 'ABCDE', weeklyFrequency: 5 }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
    },
  },
  {
    label: 'sessão feita só de exercícios isolados (isolado é complemento, não base)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'ISOLATION_AS_BASE',
    input: baseInput(
      cleanStructure({
        sessions: [
          {
            dayLabel: 'A',
            focus: 'Peito',
            exercises: [
              {
                exerciseId: 'db_fly',
                name: 'Crucifixo com halteres',
                sets: 3,
                reps: { min: 8, max: 12 },
                loadStrategy: 'DOUBLE_PROGRESSION',
                restSeconds: 60,
              },
              {
                exerciseId: 'cable_crossover',
                name: 'Crucifixo na polia',
                sets: 3,
                reps: { min: 8, max: 12 },
                loadStrategy: 'DOUBLE_PROGRESSION',
                restSeconds: 60,
              },
            ],
          },
        ],
      }),
    ),
  },
  {
    label: 'exercício acima do nível do aluno (filtro do prompt driblado)',
    kind: 'adversarial',
    expected: 'BLOCK_FALLBACK',
    expectRule: 'EXERCISE_LEVEL_TOO_HIGH',
    input: {
      structure: withExercise({ exerciseId: 'bench_press', name: 'Supino reto' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INICIANTE' },
    },
  },
  {
    label: 'linguagem de diagnóstico (não bloqueia, roteia à revisão humana)',
    kind: 'adversarial',
    expected: 'FLAG_HUMAN_REVIEW',
    expectRule: 'DIAGNOSIS',
    input: baseInput(cleanStructure({ generalNotes: 'Isso parece uma tendinite no ombro.' })),
  },
];
