/**
 * Retorno depois de cada treino concluído, em qualquer modalidade: o especialista lê o resumo
 * técnico (feito × previsto × última vez, carga, prontidão) e devolve uma leitura específica; a
 * persona transforma essa leitura em conversa didática no WhatsApp. O especialista não fala com o
 * aluno e nenhum dos dois diagnostica ou promete resultado. O treinador pode sugerir que o aluno
 * TENTE subir a carga (com critério), sempre como tentativa e não como obrigação.
 */
import { z } from 'zod';

import { defineAgentTask, type Validator } from '../../core/agents/agent-task';
import { fold, outputLanguageViolations } from '../planning/tasks/common';
import { loadMetricsViewSchema } from './analyst-tasks';
import type { EnduranceDigest, StrengthDigest } from './session-digest';
import type { SessionSnapshotView } from './session-snapshot.service';
import { toneViolations } from './tasks';

export const workoutReviewInputSchema = z.object({
  modality: z.enum(['STRENGTH', 'RUNNING', 'HYROX', 'EXTERNAL_SPORT']),
  title: z.string().max(80).nullable(),
  status: z.enum(['COMPLETED', 'PARTIAL']),
  /** Esforço percebido (0 a 10) e duração informados pelo aluno. */
  rpe: z.number().nullable(),
  durationMinutes: z.number().int().nullable(),
  load: z.number().int().nullable(),
  /** Aceitação da sessão, 1 a 5. */
  enjoyment: z.number().int().nullable(),
  planned: z.object({
    minutes: z.number().int().nullable(),
    load: z.number().int().nullable(),
    kind: z.string().max(40).nullable(),
  }),
  strength: z.custom<StrengthDigest>().nullable(),
  endurance: z.custom<EnduranceDigest>().nullable(),
  /** Sessões concluídas nos últimos 28 dias e esforço médio delas. */
  recent: z.object({ sessions28d: z.number().int(), avgRpe28d: z.number().nullable() }),
  checkIn: z
    .object({
      energy: z.number().nullable(),
      sleep: z.number().nullable(),
      soreness: z.number().nullable(),
      mood: z.number().nullable(),
      stress: z.number().nullable(),
    })
    .nullable(),
  loadMetrics: loadMetricsViewSchema.nullable(),
  /**
   * A sessão lado a lado com a disposição do dia (sono, energia, corpo, relatos do chat, ajuste do
   * treinador) e com as últimas vezes que o aluno fez a MESMA sessão.
   */
  sessionComparison: z.custom<SessionSnapshotView>().nullable(),
});
export type WorkoutReviewInput = z.infer<typeof workoutReviewInputSchema>;

const FOCUS = [
  'LOAD',
  'VOLUME',
  'TECHNIQUE',
  'EFFORT',
  'PACING',
  'HEART_RATE',
  'CONSISTENCY',
  'RECOVERY',
] as const;

const pointSchema = z.object({
  focus: z.enum(FOCUS),
  /** A leitura técnica, citando os números do resumo (exercício, séries, ritmo, comparação). */
  statement: z.string().trim().min(10).max(300),
});

export const workoutReviewSchema = z.object({
  /** Como a sessão foi contra o previsto. */
  verdict: z.enum(['AS_PLANNED', 'ABOVE_PLAN', 'BELOW_PLAN', 'MIXED']),
  /** O que foi bem, com número (1 a 3). */
  strengths: z.array(pointSchema).min(1).max(3),
  /** O que merece ajuste ou atenção (0 a 2), sem culpa. */
  attention: z.array(pointSchema).max(2),
  /** Orientação para a próxima sessão do mesmo tipo: foco, critério de progressão e, se fizer sentido, uma tentativa de carga. */
  nextFocus: z.string().trim().min(10).max(300),
  /** Recado de recuperação quando os dados pedem (sono, carga acumulada); senão ausente. */
  recoveryNote: z.string().trim().max(240).nullable(),
});
export type WorkoutReview = z.infer<typeof workoutReviewSchema>;

export const workoutReviewValidators: Validator<WorkoutReviewInput, WorkoutReview>[] = [
  (input, output) =>
    input.status === 'PARTIAL' && output.verdict === 'ABOVE_PLAN'
      ? [{ path: 'verdict', message: 'sessão parcial não supera o previsto' }]
      : [],
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations([
        ...output.strengths.map((p, i) => ({ path: `strengths.${i}`, text: p.statement })),
        ...output.attention.map((p, i) => ({ path: `attention.${i}`, text: p.statement })),
        { path: 'nextFocus', text: output.nextFocus },
      ]),
    ),
];

const REVIEW_RULES = `Regras:
1. Cada leitura cita números do resumo (exercício, séries, repetições, carga usada, ritmo, comparação com a última vez), de modo técnico e específico.
2. Compare com a última vez ("previous") e com o previsto ("planned"). Diga o que isso significa para o estímulo (progressão, manutenção, fadiga, qualidade).
3. Esforço (RPE), repetições em reserva (RIR) e prontidão contam a história: série perto da falha com técnica preservada é estímulo bom; queda grande de repetições entre séries aponta fadiga ou descanso curto.
4. "loadMetrics" e "checkIn", quando existem, entram na leitura de recuperação (carga subindo rápido, sono ruim, prontidão abaixo do normal). São orientações, não diagnóstico.
5. "nextFocus" orienta a próxima vez: o critério de progressão e, quando os dados sustentam, uma tentativa concreta (ex.: "na próxima, tente 2 kg a mais no agachamento; se as repetições caírem abaixo de 6, volte à carga de hoje"). É uma tentativa que o aluno testa, não uma ordem. Volume e estrutura quem define é a MOVIVO.
6. Sem diagnóstico, sem medicamento, sem promessa de resultado, sem culpa. Dor não é assunto desta tarefa (outro especialista cuida).
7. Sessão PARTIAL: reconheça o que foi feito, sem tratar como falha.
8. "sessionComparison" cruza o rendimento com a disposição do dia: "readiness" (sono, energia, corpo, estresse, horas de sono, se ele avisou antes do treino, se o treinador ajustou a sessão), "comparison" (variação de volume ou ritmo contra a última vez, com "pattern") e "history" (as últimas vezes da mesma sessão). Use para interpretar o desempenho, não só o placar: rendeu menos com sono ruim é esperado e merece uma frase de acolhimento; rendeu igual ou mais mesmo cansado é mérito; rendeu menos com a disposição boa pede atenção (carga, técnica, recuperação acumulada). Se o treinador ajustou a sessão por causa do relato, considere o ajuste ao comparar.`;

export const strengthReviewTask = defineAgentTask<WorkoutReviewInput, WorkoutReview>({
  id: 'strength.review_session',
  role: 'Treinador de força e hipertrofia da MOVIVO, com formação em ciência do treinamento. Você analisa como o aluno executou a sessão e o que isso diz sobre estímulo, progressão e recuperação.',
  instructions: `Analise a sessão de força do aluno a partir do resumo técnico.

${REVIEW_RULES}
8. Em "strength.exercises", "change" mostra o que mudou desde a última vez (LOAD_UP, REPS_UP, SAME, LOAD_DOWN, REPS_DOWN, NEW); "versusRange" diz se as repetições da série de topo ficaram acima, dentro ou abaixo da faixa prescrita; "repDropOff" é a queda de repetições da primeira à última série. Destaque os 2 ou 3 exercícios mais informativos, não todos.
9. Exercícios pulados ("skippedExercises") entram só se mudarem a leitura do estímulo.`,
  tier: 'STANDARD',
  methodology: ['STRENGTH', 'RECOVERY'],
  state: ['goals', 'training', 'restrictions', 'memory'],
  input: workoutReviewInputSchema,
  output: workoutReviewSchema,
  validators: workoutReviewValidators,
  maxCorrectionRounds: 2,
});

export const enduranceReviewTask = defineAgentTask<WorkoutReviewInput, WorkoutReview>({
  id: 'endurance.review_session',
  role: 'Treinador de corrida e HYROX da MOVIVO, com formação em fisiologia do exercício. Você analisa como o aluno executou a sessão de endurance e o que isso diz sobre estímulo, eficiência e recuperação.',
  instructions: `Analise a sessão de corrida, HYROX ou esporte externo a partir do resumo técnico.

${REVIEW_RULES}
8. Em "endurance": "paceDriftPercent" e "heartRateDriftPercent" comparam a segunda metade com a primeira (ritmo mais lento e FC subindo juntos sugerem fadiga ou ritmo inicial agressivo); "paceChangePercent" negativo = mais rápido que a última sessão parecida. Considere o tipo da sessão ("planned.kind"): rodagem leve pede ritmo controlado, não rápido.
9. Esporte externo não é prescrito pela MOVIVO: comente carga, esforço e como isso se encaixa na semana, sem criticar o esporte.
10. Sem dados de ritmo ou FC, use esforço, duração e carga em vez de inventar.`,
  tier: 'STANDARD',
  methodology: ['RUNNING', 'HYROX', 'RECOVERY'],
  state: ['goals', 'training', 'restrictions', 'memory'],
  input: workoutReviewInputSchema,
  output: workoutReviewSchema,
  validators: workoutReviewValidators,
  maxCorrectionRounds: 2,
});

// --- Comunicação ---------------------------------------------------------------------------

export const workoutFeedbackInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  modality: workoutReviewInputSchema.shape.modality,
  title: z.string().max(80).nullable(),
  status: workoutReviewInputSchema.shape.status,
  review: workoutReviewSchema,
});
export type WorkoutFeedbackInput = z.infer<typeof workoutFeedbackInputSchema>;

export const workoutFeedbackSchema = z.object({
  /** Mensagens curtas de WhatsApp, na ordem em que o aluno lê (2 a 3). */
  messages: z.array(z.string().trim().min(1).max(480)).min(2).max(3),
});
export type WorkoutFeedback = z.infer<typeof workoutFeedbackSchema>;

const FORBIDDEN = [
  /\bdiagnostic/,
  /\bremedio|medicamento|anti-?inflamatorio|ibuprofeno|dipirona|paracetamol|analgesico/,
  /\bgarant/,
];

export const workoutFeedbackValidators: Validator<WorkoutFeedbackInput, WorkoutFeedback>[] = [
  (_input, output) =>
    FORBIDDEN.some((pattern) => pattern.test(fold(output.messages.join(' '))))
      ? [{ path: 'messages', message: 'sem diagnóstico, medicamento ou garantia de resultado' }]
      : [],
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations(output.messages.map((text, i) => ({ path: `messages.${i}`, text }))),
    ),
];

export const workoutFeedbackTask = defineAgentTask<WorkoutFeedbackInput, WorkoutFeedback>({
  id: 'communication.workout_feedback',
  role: 'Quem acompanha o aluno de perto pelo WhatsApp (a persona da MOVIVO). Depois de cada treino você conversa com ele, em tom didático e próximo, passando o retorno técnico do especialista de um jeito que ele entenda e use.',
  instructions: `Escreva 2 a 3 mensagens curtas de WhatsApp com o retorno do treino, na sua voz, a partir da leitura do especialista ("review").

Regras:
1. Primeira mensagem: o que foi bem, com o número que prova (um ou dois destaques de "review.strengths"). Se "firstName" existir, use-o uma vez.
2. Segunda: o ponto de atenção ("review.attention"), se houver, explicado de forma simples e sem culpa, e o "nextFocus" como orientação do que observar na próxima vez. Se não houver atenção, vá direto ao "nextFocus".
3. Terceira (só se houver "review.recoveryNote"): o recado de recuperação.
4. Ensine: explique em uma frase por que aquilo importa ("isso mostra que…", "na prática…"), sem jargão ou, se usar um termo, traduza.
5. Não invente nada que não esteja na leitura. Se a leitura traz uma tentativa de carga, passe como tentativa. Sem diagnóstico, sem remédio, sem promessa de resultado.
6. Sessão PARTIAL: valorize o que foi feito.`,
  tier: 'STANDARD',
  methodology: ['COMMUNICATION'],
  state: ['identity', 'memory'],
  input: workoutFeedbackInputSchema,
  output: workoutFeedbackSchema,
  validators: workoutFeedbackValidators,
  maxCorrectionRounds: 2,
});
