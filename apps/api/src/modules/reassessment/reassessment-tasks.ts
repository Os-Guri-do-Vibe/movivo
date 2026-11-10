/**
 * Análise do fim de ciclo: o especialista faz o que uma assessoria de alta performance faria na
 * virada de fase. Compara o começo (anamnese, medidas) com o agora (medidas, treinos, carga,
 * check-ins, relato do aluno), diz o que funcionou e o que não, e orienta o próximo ciclo de
 * treino e de alimentação. O texto vai para a Fila do Profissional como contexto e para os
 * agentes que montam os protocolos novos; o aluno recebe a conversa da persona.
 */
import { z } from 'zod';

import { cycleReassessmentAnswersSchema, mesocycleSchema, weekMetricsSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { outputLanguageViolations } from '../planning/tasks/common';
import { loadMetricsViewSchema } from '../progress/analyst-tasks';
import { toneViolations } from '../progress/tasks';

const measurementSnapshotSchema = z.object({
  kind: z.string().max(24),
  start: z.number().nullable(),
  startedOn: z.iso.date().nullable(),
  now: z.number().nullable(),
  nowOn: z.iso.date().nullable(),
});

export const cycleReviewInputSchema = z.object({
  cycle: z.object({
    startsOn: z.iso.date(),
    endedOn: z.iso.date(),
    weeks: z.number().int(),
    /** Fases do protocolo que terminou (nome, foco e se previa semana de recuperação). */
    phases: z
      .array(
        z.object({
          name: z.string().max(60),
          focus: z.string().max(200),
          endsWithDeload: z.boolean(),
          mesocycle: mesocycleSchema.optional(),
        }),
      )
      .max(8),
  }),
  /** Semanas do ciclo (planejado × feito, carga, esforço, dor, registro de alimentação). */
  weeks: z.array(weekMetricsSchema).max(16),
  measurements: z.array(measurementSnapshotSchema).max(8),
  answers: cycleReassessmentAnswersSchema,
  loadMetrics: loadMetricsViewSchema.nullable(),
  checkIns: z.object({
    answeredDays: z.number().int(),
    avgEnergy: z.number().nullable(),
    avgSleep: z.number().nullable(),
    avgStress: z.number().nullable(),
    avgMood: z.number().nullable(),
  }),
  /** Dores relatadas no ciclo, por região. */
  pain: z
    .array(
      z.object({ region: z.string().max(40), reports: z.number().int(), maxIntensity: z.number() }),
    )
    .max(8),
  goal: z.object({ primary: z.string().nullable(), summary: z.string().max(300).nullable() }),
  /** Comparação visual início × agora, quando o aluno enviou fotos e autorizou o uso. */
  photos: z
    .object({
      comparable: z.boolean(),
      visibleChanges: z.array(z.string().max(200)).max(5),
      bodyFatRange: z.object({ min: z.number(), max: z.number() }).nullable(),
      confidence: z.enum(['LOW', 'MEDIUM']),
      limitations: z.array(z.string().max(200)).max(4),
    })
    .nullable()
    .optional(),
});
export type CycleReviewInput = z.infer<typeof cycleReviewInputSchema>;

const textList = (max: number, size = 220) => z.array(z.string().trim().min(8).max(size)).max(max);

export const cycleReviewSchema = z.object({
  summary: z.string().trim().min(40).max(600),
  achievements: textList(4).min(1),
  gaps: textList(4),
  /** Início × agora, métrica a métrica (só as que os dados sustentam). */
  comparison: z
    .array(
      z.object({
        metric: z.string().trim().min(3).max(60),
        start: z.string().trim().min(1).max(60),
        now: z.string().trim().min(1).max(60),
        reading: z.string().trim().min(8).max(200),
      }),
    )
    .max(8),
  goalStatus: z.enum(['AHEAD', 'ON_TRACK', 'BEHIND', 'CHANGED']),
  nextCycle: z.object({
    training: z.object({
      /**
       * Mesociclo de musculação do próximo ciclo. Depois da Adaptação vem Hipertrofia ou Força;
       * Recuperação (deload) só quando os dados pedem.
       */
      mesocycle: mesocycleSchema,
      focus: z.string().trim().min(10).max(300),
      volume: z.enum(['INCREASE', 'MAINTAIN', 'DECREASE']),
      changes: textList(5, 240),
      /** Só quando os dados do aluno pedem recuperação programada no próximo bloco. */
      includeDeloadMesocycle: z.boolean(),
    }),
    nutrition: z.object({
      focus: z.string().trim().min(10).max(300),
      energy: z.enum(['INCREASE', 'MAINTAIN', 'DECREASE']),
      /** Micronutrientes e hábitos de saúde a priorizar (ferro, cálcio, vitamina D, fibras…). */
      healthFocus: textList(5, 120),
      changes: textList(5, 240),
    }),
  }),
  /** Pontos que o profissional deve olhar com atenção (dor nova, condição nova, sinal de alerta). */
  professionalFlags: textList(3, 240),
});
export type CycleReview = z.infer<typeof cycleReviewSchema>;

export const cycleReviewValidators: Validator<CycleReviewInput, CycleReview>[] = [
  // O aluno disse que tem dor ou condição nova: o profissional precisa ser avisado.
  (input, output) =>
    (input.answers.health.newPainOrInjury || input.answers.health.newCondition) &&
    output.professionalFlags.length === 0
      ? [
          {
            path: 'professionalFlags',
            message: 'o aluno relatou dor, lesão ou condição nova: sinalize para o profissional',
          },
        ]
      : [],
  // Semana de recuperação só com mesociclo planejado, nunca por padrão.
  (input, output): Violation[] =>
    output.nextCycle.training.includeDeloadMesocycle && input.weeks.length < 4
      ? [
          {
            path: 'nextCycle.training.includeDeloadMesocycle',
            message: 'com menos de 4 semanas de dados não há base para programar recuperação',
          },
        ]
      : [],
  // Cada linha de comparação cita as duas pontas.
  (_input, output) =>
    output.comparison.some((c) => c.start === c.now && c.reading.length < 12)
      ? [{ path: 'comparison', message: 'compare o começo com o agora com leitura própria' }]
      : [],
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations([
        { path: 'summary', text: output.summary },
        ...output.gaps.map((text, i) => ({ path: `gaps.${i}`, text })),
      ]),
    ),
];

export const cycleReviewTask = defineAgentTask<CycleReviewInput, CycleReview>({
  id: 'cycle.review_and_plan',
  role: 'Coordenador técnico da MOVIVO (treino, nutrição e recuperação), com a visão de uma assessoria de alta performance. Você fecha um ciclo de protocolo e orienta o próximo com base em dados.',
  instructions: `O ciclo do aluno terminou. Faça a análise de fechamento e oriente o próximo ciclo.

Como analisar:
1. Compare o COMEÇO com o AGORA: medidas, fotos ("photos": leitura visual, sempre com margem de erro; use como apoio às medidas, nunca sozinha), ("measurements"), objetivo, rotina, adesão (planejado × feito nas "weeks"), carga e esforço, recuperação (check-ins, sono, estresse), dores e o que o aluno contou ("answers"). Use números.
2. Separe o que o plano produziu (efeito do protocolo) do que a vida atrapalhou (rotina, estresse, sono). Não culpe o aluno.
3. "goalStatus": AHEAD, ON_TRACK ou BEHIND em relação ao objetivo; CHANGED se ele contou que o objetivo mudou.
4. Próximo treino: ajuste o foco e o volume pelo que o aluno respondeu ("trainingLoad" fácil demais ou pesado demais, adesão, recuperação). Progressão é orientação (critério e tentativas sugeridas), não carga obrigatória por exercício. Semana ou bloco de recuperação (mesociclo de deload) só se os dados pedirem: carga acumulada alta (acwr, strain), prontidão baixa, sono ruim, sensação de peso; nunca por calendário fixo.
5. Próxima alimentação: além de calorias e macros, pense em saúde, longevidade, imunidade e energia: fibras, variedade de frutas e hortaliças, ferro, cálcio, vitamina D, ômega-3, hidratação e o que o relato de dificuldades pedir. "healthFocus" lista o que priorizar.
6. Dor, lesão ou condição nova relatada vai em "professionalFlags" para o profissional olhar; você não diagnostica nem indica tratamento.
7. Se o aluno mudou a rotina (dias por semana, minutos por sessão) ou o objetivo, o próximo ciclo parte disso.
8. Pense na periodização de longo prazo do aluno e na ciência do treinamento e da nutrição: quais fases ele já cumpriu, o que falta para chegar ao objetivo, como a sobrecarga progride de um ciclo para o outro. O próximo ciclo não repete o anterior por inércia nem muda tudo sem motivo: cada mudança em "changes" cita o dado que a justifica (resultado do ciclo, resposta nova, rotina, avaliação física).
   "nextCycle.training.mesocycle" é o próximo mesociclo de musculação (o que terminou está em "cycle.phases"): ADAPTATION só se a adaptação não se completou (adesão baixa, execução ainda insegura) ou se o aluno ficou parado; depois dela, HYPERTROPHY ou STRENGTH conforme o objetivo e o que o aluno já cumpriu; HYPERTROPHY e STRENGTH podem alternar entre ciclos mantendo os multiarticulares-chave; DELOAD (bloco inteiro de recuperação) só quando os dados pedirem recuperação além de uma semana leve.
9. A avaliação física visual atual junto das medidas orienta a estratégia: gordura estimada alta pede déficit ou recomposição mesmo que o aluno peça outra coisa; baixa não pede déficit. Os grupos musculares a desenvolver, os pontos fortes e as assimetrias ("bodyComposition") guiam o foco do próximo ciclo; alinhamento alterado é percepção por foto (sem diagnóstico), para o profissional que audita. É estimativa com margem de erro: descreva em faixa e linguagem neutra.
10. Sem promessa de resultado. Português claro e profissional.`,
  tier: 'REASONING',
  methodology: ['STRENGTH', 'RUNNING', 'HYROX', 'HYBRID', 'NUTRITION', 'RECOVERY', 'ADHERENCE'],
  state: [
    'identity',
    'goals',
    'body',
    'bodyComposition',
    'training',
    'nutrition',
    'restrictions',
    'preferences',
    'adherence',
    'followUp',
    'memory',
  ],
  input: cycleReviewInputSchema,
  output: cycleReviewSchema,
  validators: cycleReviewValidators,
  maxCorrectionRounds: 2,
});

// --- Comunicação ---------------------------------------------------------------------------

export const cycleWrapUpInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  review: cycleReviewSchema.pick({ summary: true, achievements: true, goalStatus: true }),
});
export type CycleWrapUpInput = z.infer<typeof cycleWrapUpInputSchema>;

export const cycleWrapUpSchema = z.object({
  /** Mensagens de WhatsApp (2 a 3): leitura do ciclo e o que vem a seguir. */
  messages: z.array(z.string().trim().min(1).max(480)).min(2).max(3),
});
export type CycleWrapUp = z.infer<typeof cycleWrapUpSchema>;

export const cycleWrapUpValidators: Validator<CycleWrapUpInput, CycleWrapUp>[] = [
  (_input, output) =>
    /\bgarant|\bremedio|\bmedicamento/.test(
      output.messages
        .join(' ')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase(),
    )
      ? [{ path: 'messages', message: 'sem garantia de resultado nem indicação de remédio' }]
      : [],
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations(output.messages.map((text, i) => ({ path: `messages.${i}`, text }))),
    ),
];

export const cycleWrapUpTask = defineAgentTask<CycleWrapUpInput, CycleWrapUp>({
  id: 'communication.cycle_wrap_up',
  role: 'Quem acompanha o aluno de perto pelo WhatsApp (a persona da MOVIVO). No fim de um ciclo você mostra, com carinho e clareza, o caminho que ele percorreu e avisa que o próximo protocolo está sendo montado.',
  instructions: `Escreva 2 a 3 mensagens curtas de WhatsApp, na sua voz, com base na análise do ciclo ("review").

Regras:
1. Comece reconhecendo o que ele conquistou, com um ou dois fatos de "achievements". Se "firstName" existir, use-o uma vez.
2. Seja honesta com o que ficou aquém sem culpa; se "goalStatus" for BEHIND, fale em ajustar o caminho, não em fracasso.
3. Diga que o próximo protocolo de treino e de alimentação está sendo montado com o que ele contou e que a equipe de profissionais confere antes de chegar.
4. Sem promessa de resultado e sem prazo inventado.`,
  tier: 'STANDARD',
  methodology: ['COMMUNICATION'],
  state: ['identity', 'memory'],
  input: cycleWrapUpInputSchema,
  output: cycleWrapUpSchema,
  validators: cycleWrapUpValidators,
  maxCorrectionRounds: 2,
});
