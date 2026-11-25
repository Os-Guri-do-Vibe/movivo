/**
 * Agentes da rotina alimentar do dia a dia:
 *  - lembrete da refeição (a persona abre e fecha; a lista de alimentos vem do plano, em código);
 *  - leitura do dia (o nutricionista comenta o registro; os números vêm do código);
 *  - falha de registro (hábitos entende por que o aluno parou de registrar e a persona conversa);
 *  - retorno de cada refeição registrada pelo WhatsApp.
 */
import { z } from 'zod';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import { fold, languageViolations, outputLanguageViolations } from '../planning/tasks/common';
import { numbersIn, unknownNumbers } from '../nutrition/meal-routine';
import { trackingGapSchema } from './reengagement-tasks';
import { toneViolations } from './tasks';

const noDigits = (path: string, text: string): Violation[] =>
  /\d/.test(text)
    ? [{ path, message: 'sem números: lista e metas vão separadas, pelo código' }]
    : [];

// --- Lembrete da refeição ----------------------------------------------------------------------

export const mealReminderInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  mealLabel: z.string().max(40),
  /** Período do dia, para o cumprimento ("bom dia", "boa tarde", "boa noite"). */
  period: z.enum(['MORNING', 'AFTERNOON', 'EVENING']),
  /** Quantas refeições já foram registradas hoje. */
  loggedToday: z.number().int().min(0).max(8),
  /** Dias seguidos (até ontem) com ao menos um registro. */
  streakDays: z.number().int().min(0).max(60),
  /** O aluno tem treino hoje? */
  trainingToday: z.boolean(),
});
export type MealReminderInput = z.infer<typeof mealReminderInputSchema>;

export const mealReminderOutputSchema = z.object({
  /** Abertura curta com o cumprimento e o lembrete de registrar a refeição. */
  opening: z.string().trim().min(5).max(180),
  /** Fecho: como enviar o registro e onde ver outras opções. */
  closing: z.string().trim().min(20).max(320),
});
export type MealReminderOutput = z.infer<typeof mealReminderOutputSchema>;

export const mealReminderValidators: Validator<MealReminderInput, MealReminderOutput>[] = [
  (_input, output) => [
    ...noDigits('opening', output.opening),
    ...noDigits('closing', output.closing),
    ...(/regist/.test(fold(output.opening + ' ' + output.closing))
      ? []
      : [{ path: 'opening', message: 'o lembrete é para registrar a refeição' }]),
    ...(/foto|descrev|audio|escrev/.test(fold(output.closing))
      ? []
      : [{ path: 'closing', message: 'diga como enviar: foto, áudio ou descrevendo' }]),
    ...(/opc|plano|pdf|pergunt/.test(fold(output.closing))
      ? []
      : [
          {
            path: 'closing',
            message: 'avise onde ver outras opções (plano em PDF ou perguntando)',
          },
        ]),
  ],
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations([
        { path: 'opening', text: output.opening },
        { path: 'closing', text: output.closing },
      ]),
    ),
];

export const mealReminderTask = defineAgentTask<MealReminderInput, MealReminderOutput>({
  id: 'communication.meal_reminder',
  role: 'Quem acompanha a alimentação do aluno de perto pelo WhatsApp (a persona da MOVIVO). Você lembra de registrar a refeição com carinho e leveza, sem cobrança.',
  instructions: `Escreva o lembrete de registro de uma refeição. O cardápio (primeira opção do plano) é inserido pelo sistema ENTRE a abertura e o fecho: você escreve só os dois textos.

Regras:
1. "opening": cumprimento do período ("bom dia", "boa tarde", "boa noite") com o nome, se existir, e o lembrete de registrar a refeição ("mealLabel"). Uma ou duas frases curtas, na sua voz. Termine de um jeito que apresente a lista que vem logo abaixo (ex.: dois pontos).
2. "closing": peça para ele enviar o registro por foto, áudio ou descrevendo o que comeu, e diga que, se quiser outras opções para essa refeição, é só abrir o plano alimentar em PDF ou perguntar a você. Uma ou duas frases.
3. Varie o jeito de falar: use "streakDays", "loggedToday", "trainingToday" e "memory" para soar como quem conhece a rotina dele (ex.: reconhecer a sequência, lembrar que é dia de treino). Nunca repita a frase de ontem (veja "conversation").
4. NENHUM número (a lista e as metas vão separadas). Não cite calorias nem macros. Sem cobrança, sem culpa, sem promessa.`,
  tier: 'FAST',
  methodology: ['COMMUNICATION', 'ADHERENCE'],
  state: ['identity', 'memory', 'conversation'],
  input: mealReminderInputSchema,
  output: mealReminderOutputSchema,
  validators: mealReminderValidators,
  maxCorrectionRounds: 2,
});

// --- Leitura do dia ------------------------------------------------------------------------------

export const dayReviewInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  dayType: z.enum(['TRAINING', 'REST']),
  strategy: z.string().max(24),
  /** Meta do dia: faixa de energia e proteína (g). */
  targets: z.object({
    energyMinKcal: z.number(),
    energyMaxKcal: z.number(),
    proteinG: z.number(),
    waterMl: z.number(),
  }),
  consumed: z.object({
    energyKcal: z.number(),
    proteinG: z.number(),
    carbsG: z.number(),
    fatG: z.number(),
  }),
  waterMl: z.number().nullable(),
  meals: z
    .array(z.object({ label: z.string().max(40), energyKcal: z.number(), proteinG: z.number() }))
    .max(10),
  /** Refeições do plano sem registro. */
  missingMeals: z.array(z.string().max(40)).max(8),
  /** Fechado antes do fim do dia porque o aluno registrou tudo, ou no limite da noite. */
  closedBecause: z.enum(['ALL_LOGGED', 'END_OF_DAY']),
  /** Média dos últimos dias registrados (energia e proteína), para ver tendência. */
  last7DaysAverage: z
    .object({ days: z.number().int(), energyKcal: z.number(), proteinG: z.number() })
    .nullable(),
});
export type DayReviewInput = z.infer<typeof dayReviewInputSchema>;

export const DAY_PATTERNS = [
  'NONE',
  'LOW_PROTEIN',
  'UNDER_EATING',
  'OVER_TARGET',
  'LOW_WATER',
  'SKIPPED_MEALS',
] as const;

export const dayReviewOutputSchema = z.object({
  /** Leitura do nutricionista: o que foi bem e um ajuste prático para amanhã. */
  note: z.string().trim().min(10).max(420),
  pattern: z.enum(DAY_PATTERNS),
});
export type DayReviewOutput = z.infer<typeof dayReviewOutputSchema>;

export const dayReviewValidators: Validator<DayReviewInput, DayReviewOutput>[] = [
  (input, output) => {
    const extras = unknownNumbers(output.note, [
      ...numbersIn(input),
      // metas e totais em outros formatos (litros, faltas)
      input.targets.proteinG - input.consumed.proteinG,
      input.targets.energyMinKcal - input.consumed.energyKcal,
      input.targets.energyMaxKcal - input.consumed.energyKcal,
    ]);
    return extras.length > 0
      ? [{ path: 'note', message: `números fora dos dados do dia: ${extras.join(', ')}` }]
      : [];
  },
  (_input, output) =>
    languageViolations(output.note, 'note').concat(
      toneViolations([{ path: 'note', text: output.note }]),
    ),
];

export const dayReviewTask = defineAgentTask<DayReviewInput, DayReviewOutput>({
  id: 'nutrition.review_day',
  role: 'Nutricionista da MOVIVO, acompanhando a alimentação do aluno todos os dias com olhar de saúde e de resultado, como um nutricionista humano faria.',
  instructions: `Leia o dia alimentar do aluno e escreva a observação que acompanha o resumo (o bloco de números é inserido pelo sistema).

Regras:
1. 2 a 3 frases, na sua voz. Comece pelo que foi BEM (consistência, proteína no alvo, boa distribuição, água) e depois, no máximo, UM ajuste prático e específico para amanhã (ex.: onde encaixar os gramas de proteína que faltaram, adiantar o lanche da tarde, levar a água na bolsa).
2. Compare com a meta do tipo de dia ("dayType", "targets") e com a tendência ("last7DaysAverage"). Faixa de energia é faixa, não número exato: dentro ou perto dela está bom. Dia sem todas as refeições registradas ("missingMeals"): trate como registro incompleto, não como falha dele, e não conclua que comeu pouco.
3. Cite apenas números que vieram em "consumed", "targets", "waterMl", "meals" ou "last7DaysAverage" (ou a diferença entre eles). Nada de calorias inventadas.
4. "pattern": o padrão mais relevante do dia (LOW_PROTEIN, UNDER_EATING, OVER_TARGET, LOW_WATER, SKIPPED_MEALS) ou NONE se o dia foi bom. Um dia isolado não é padrão: com poucos dados, NONE.
5. Pense como nutricionista: qualidade do prato além dos macros, sem terrorismo nutricional nem alimento proibido, sem culpa. Estratégia de restrição energética: nunca estimule comer menos que a meta. Sem diagnóstico, sem suplemento, sem promessa.`,
  tier: 'STANDARD',
  methodology: ['NUTRITION', 'COMMUNICATION'],
  state: ['goals', 'restrictions', 'preferences', 'memory'],
  input: dayReviewInputSchema,
  output: dayReviewOutputSchema,
  validators: dayReviewValidators,
  maxCorrectionRounds: 2,
});

// --- Falha de registro -----------------------------------------------------------------------

export const LOGGING_GAP_STRATEGIES = [
  'SIMPLIFY',
  'UNDERSTAND',
  'ADJUST_REMINDERS',
  'REFRAME',
  'ESCALATE',
] as const;

export const loggingGapInputSchema = z.object({
  /** Dias seguidos (até hoje) sem nenhum registro de refeição. */
  daysWithoutLog: z.number().int().min(1).max(60),
  /** Dias com registro nos últimos 14. */
  loggedDaysLast14: z.number().int().min(0).max(14),
  /** Lembretes enviados nos últimos 3 dias. */
  remindersLast3Days: z.number().int().min(0).max(30),
  /** Quantas vezes a MOVIVO já puxou esse assunto nos últimos 14 dias. */
  previousOutreachLast14: z.number().int().min(0).max(10),
  /** Respondeu no WhatsApp nos últimos 3 dias (mesmo sem registrar)? */
  talkedRecently: z.boolean(),
  trainedLast7Days: z.number().int().min(0).max(14),
  /** Dias desde a última pesagem (check-in de domingo); `null` = nunca se pesou. */
  daysSinceWeight: z.number().int().nullable(),
  /** O que a nutricionista precisa e o jeito mais leve de pedir (ela lê antes de o hábito decidir). */
  nutritionist: trackingGapSchema,
  checkIn: z
    .object({
      energy: z.number().nullable(),
      sleep: z.number().nullable(),
      mood: z.number().nullable(),
      stress: z.number().nullable(),
    })
    .nullable(),
});
export type LoggingGapInput = z.infer<typeof loggingGapInputSchema>;

export const loggingGapPlanSchema = z.object({
  strategy: z.enum(LOGGING_GAP_STRATEGIES),
  hypotheses: z.array(z.string().trim().min(5).max(200)).max(2),
  question: z.string().trim().min(5).max(200),
  rationale: z.string().trim().min(10).max(300),
});
export type LoggingGapPlan = z.infer<typeof loggingGapPlanSchema>;

export const ESCALATE_MIN_DAYS = 5;

export const loggingGapPlanValidators: Validator<LoggingGapInput, LoggingGapPlan>[] = [
  (input, output) =>
    output.strategy === 'ESCALATE' &&
    (input.daysWithoutLog < ESCALATE_MIN_DAYS || input.previousOutreachLast14 < 1)
      ? [
          {
            path: 'strategy',
            message: `ESCALATE só com ${ESCALATE_MIN_DAYS} ou mais dias sem registro e uma tentativa anterior sem resposta`,
          },
        ]
      : [],
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations([
        ...output.hypotheses.map((text, i) => ({ path: `hypotheses.${i}`, text })),
        { path: 'rationale', text: output.rationale },
      ]),
    ),
];

export const loggingGapPlanTask = defineAgentTask<LoggingGapInput, LoggingGapPlan>({
  id: 'habits.plan_logging_gap',
  role: 'Especialista em hábitos, comportamento e psicologia da MOVIVO. Você entende por que o aluno parou de registrar a alimentação e escolhe a abordagem que traz a constância de volta sem culpa, com base em ciência comportamental.',
  instructions: `O aluno parou de registrar as refeições. Escolha UMA abordagem para a conversa de hoje.

Abordagens:
- SIMPLIFY: o registro está pesado. Reduza a fricção ao mínimo: só a foto do prato, só as refeições principais, ou um áudio de 10 segundos no fim do dia.
- UNDERSTAND: falha recente, sem padrão claro. Pergunte com curiosidade o que está atrapalhando (rotina, esquecimento, vergonha do que comeu, cansaço, falta de tempo).
- ADJUST_REMINDERS: ele talvez esqueça ou os lembretes caem na hora errada. Ofereça ajustar os horários ou trocar o lembrete por um único no fim do dia.
- REFRAME: o aluno parece evitar registrar por sentir que "comeu mal". Normalize: o registro serve para ajustar o plano, não para julgar; dia fora do plano também é dado útil.
- ESCALATE: ${ESCALATE_MIN_DAYS} ou mais dias sem registro e uma tentativa anterior sem resposta. A conversa é de acolhimento ("como você está?"); o caso também vai para a equipe acompanhar.

A nutricionista já leu o caso ("nutritionist"): "priority" diz o que ela mais precisa (refeições, peso ou os dois), "whyItMatters" o benefício para o aluno e "easiestWay" o jeito mais leve de entregar. Sua abordagem deve servir a esse pedido: escolha como conversar para que o aluno consiga dar o dado, sem cobrança. O peso é semanal, no check-in de domingo; não peça peso diário.

Regras:
1. Use princípios de mudança de comportamento (reduzir fricção, gatilho ligado a uma rotina existente, reforçar a identidade e o progresso, recomeço sem culpa) e a neurociência do hábito: o objetivo é o MENOR passo que ele consegue dar hoje.
2. "hypotheses" são leituras cautelosas com base nos dados ("checkIn", treinos, lembretes, conversa recente), nunca afirmações. "question": UMA pergunta simples, que se responde com uma palavra ou frase curta.
3. Sem culpa, sem cobrança, sem comparação. Quem treina e se cuida, mas não registra, é um aluno engajado que está com o registro difícil: trate assim.
4. Nada de sugerir que coma menos ou compense o que comeu.`,
  tier: 'STANDARD',
  methodology: ['ADHERENCE', 'COMMUNICATION', 'NUTRITION'],
  state: ['goals', 'preferences', 'adherence', 'restrictions', 'safety', 'memory', 'conversation'],
  input: loggingGapInputSchema,
  output: loggingGapPlanSchema,
  validators: loggingGapPlanValidators,
  maxCorrectionRounds: 2,
});

export const loggingGapMessageInputSchema = z.object({
  firstName: z.string().max(60).nullable(),
  daysWithoutLog: z.number().int(),
  daysSinceWeight: z.number().int().nullable(),
  plan: loggingGapPlanSchema,
  nutritionist: trackingGapSchema,
});
export type LoggingGapMessageInput = z.infer<typeof loggingGapMessageInputSchema>;

export const loggingGapMessageSchema = z.object({
  messages: z.array(z.string().trim().min(1).max(360)).min(1).max(2),
});
export type LoggingGapMessage = z.infer<typeof loggingGapMessageSchema>;

const GUILT = [/\bvoce nao registr|\bvoce esqueceu|\bnao cumpriu|\bfalhou|\bpreguic|\bdecepcion/];

export const loggingGapMessageValidators: Validator<LoggingGapMessageInput, LoggingGapMessage>[] = [
  (_input, output) => {
    const violations: Violation[] = [];
    const last = output.messages[output.messages.length - 1] ?? '';
    if (!last.includes('?')) {
      violations.push({ path: 'messages', message: 'termine com a pergunta do plano' });
    }
    if (GUILT.some((p) => p.test(fold(output.messages.join(' '))))) {
      violations.push({ path: 'messages', message: 'sem cobrança nem culpa' });
    }
    return violations;
  },
  (_input, output) =>
    outputLanguageViolations(output).concat(
      toneViolations(output.messages.map((text, i) => ({ path: `messages.${i}`, text }))),
    ),
];

export const loggingGapMessageTask = defineAgentTask<LoggingGapMessageInput, LoggingGapMessage>({
  id: 'communication.logging_gap',
  role: 'Quem acompanha o aluno de perto pelo WhatsApp (a persona da MOVIVO). Quando o registro das refeições some, você aparece com cuidado e uma pergunta fácil de responder.',
  instructions: `Escreva 1 a 2 mensagens curtas de WhatsApp, na sua voz, seguindo a abordagem escolhida pelo especialista ("plan").

Regras:
0. A nutricionista pediu algo ("nutritionist"): traduza "whyItMatters" e "easiestWay" nas suas palavras, como a nutricionista falaria, sem repetir o texto dela. Se "nutritionist.priority" for WEIGHT, o assunto é a pesagem do domingo, não as refeições.
1. Não abra cobrando o registro. Comece com cuidado e curiosidade, reconheça o que ele está fazendo bem (treino, constância em outras áreas, use "memory") e normalize em uma frase.
2. Siga "plan.strategy": SIMPLIFY propõe o jeito mais leve de registrar; UNDERSTAND pergunta o que está atrapalhando; ADJUST_REMINDERS oferece ajustar os horários dos lembretes; REFRAME tira o peso de "comer certo" do registro; ESCALATE acolhe e pergunta como ele está.
3. Termine com a pergunta de "plan.question", com as suas palavras. Uma pergunta só.
4. Se "firstName" existir, use-o uma vez. Sem culpa, sem cobrança, sem promessa de resultado.`,
  tier: 'STANDARD',
  methodology: ['COMMUNICATION', 'ADHERENCE'],
  state: ['identity', 'memory', 'conversation'],
  input: loggingGapMessageInputSchema,
  output: loggingGapMessageSchema,
  validators: loggingGapMessageValidators,
  maxCorrectionRounds: 2,
});
