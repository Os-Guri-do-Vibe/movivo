/**
 * Escolha das perguntas do check-in (código, sem LLM): entram só as que podem mudar a próxima
 * decisão. Semana normal = poucas perguntas; queda de adesão, esforço fora do padrão ou pouca
 * alimentação registrada trazem as perguntas sobre esses fatores.
 */
import type { CheckInQuestion } from '@movivo/shared';

export interface CheckInSignals {
  /** Adesão das últimas 4 semanas (0–1); `null` sem sessões planejadas. */
  adherenceRate: number | null;
  /** Limiar de adesão baixa (documento ADHERENCE). */
  lowAdherenceRate: number;
  /** Sessões de força concluídas na última semana. */
  strengthSessionsLastWeek: number;
  /** PSE média das últimas sessões menos a PSE prevista; `null` sem dado. */
  rpeAbovePlanned: number | null;
  /** Dias com refeição confirmada nos últimos 7. */
  foodLogDaysLast7: number;
  /** Há plano de nutrição ativo. */
  hasNutritionPlan: boolean;
  /** Dias desde a última medida de peso; `null` se nunca. */
  daysSinceWeight: number | null;
}

/**
 * Teto de perguntas: cabem num toque cada (escalas, escolhas e sim/não); o texto livre é opcional
 * e vem por último. Pergunta de acompanhamento (`showIf`) só aparece quando a anterior pede.
 */
const MAX_QUESTIONS = 12;

const PAIN_REGIONS = [
  'Ombro',
  'Cotovelo ou punho',
  'Lombar ou coluna',
  'Quadril',
  'Joelho',
  'Tornozelo ou pé',
  'Outra região',
];

export function composeQuestions(signals: CheckInSignals): CheckInQuestion[] {
  const questions: CheckInQuestion[] = [
    {
      key: 'energy',
      prompt: 'Como está a sua energia nesta semana? (1 = muito baixa, 5 = ótima)',
      type: 'SCALE_1_5',
      reason: 'Base de toda semana: calibra o volume da próxima.',
    },
    {
      key: 'sleep',
      prompt: 'Como foi o seu sono? (1 = péssimo, 5 = ótimo)',
      type: 'SCALE_1_5',
      reason: 'Sono ruim muda a recuperação e o que dá para pedir.',
    },
    {
      key: 'stress',
      prompt: 'E o seu nível de estresse? (1 = tranquilo, 5 = muito estressado)',
      type: 'SCALE_1_5',
      reason: 'Estresse alto pesa na recuperação e na constância.',
    },
    {
      key: 'motivation',
      prompt: 'Como está a sua vontade de treinar e seguir o plano? (1 = nenhuma, 5 = total)',
      type: 'SCALE_1_5',
      reason: 'Motivação em queda antecede perda de constância.',
    },
    {
      key: 'next_week',
      prompt: 'Como vai ser a sua próxima semana?',
      type: 'CHOICE',
      options: [
        'Semana normal',
        'Semana corrida',
        'Vou viajar',
        'Tenho um compromisso importante',
        'Não sei ainda',
      ],
      reason: 'Permite ajustar o plano antes de a rotina apertar.',
    },
    {
      key: 'pain',
      prompt: 'Sentiu alguma dor ou desconforto que te preocupou nesta semana?',
      type: 'YES_NO',
      reason: 'Pergunta de segurança, sempre presente.',
    },
    {
      key: 'pain_where',
      prompt: 'Onde foi?',
      type: 'CHOICE',
      options: PAIN_REGIONS,
      showIf: { key: 'pain', equals: true },
      reason: 'Localiza a dor para o especialista de recuperação.',
    },
    {
      key: 'win',
      prompt: 'Qual foi a sua melhor vitória da semana? (opcional)',
      type: 'TEXT',
      reason: 'Registra conquistas e ajuda a acompanhar de perto.',
    },
    {
      key: 'help_with',
      prompt: 'Quer que a gente te ajude em algo na próxima semana? (opcional)',
      type: 'TEXT',
      reason: 'Deixa o aluno pedir o que precisa.',
    },
  ];

  if (signals.adherenceRate !== null && signals.adherenceRate < signals.lowAdherenceRate) {
    questions.push({
      key: 'barrier',
      prompt: 'O que mais atrapalhou os treinos nas últimas semanas?',
      type: 'CHOICE',
      options: [
        'Falta de tempo',
        'Cansaço',
        'Sem motivação',
        'Dor ou desconforto',
        'Mudança na rotina',
        'Outro motivo',
      ],
      reason: `Adesão de ${Math.round(signals.adherenceRate * 100)}% nas últimas 4 semanas.`,
    });
  }
  if (signals.rpeAbovePlanned !== null && Math.abs(signals.rpeAbovePlanned) >= 1.5) {
    questions.push({
      key: 'intensity_feel',
      prompt: 'Como você sentiu a intensidade dos treinos?',
      type: 'CHOICE',
      options: ['Leve demais', 'No ponto', 'Pesado demais'],
      reason:
        signals.rpeAbovePlanned > 0
          ? 'Esforço percebido acima do previsto.'
          : 'Esforço percebido abaixo do previsto.',
    });
  }
  if (signals.strengthSessionsLastWeek > 0) {
    questions.push({
      key: 'soreness',
      prompt: 'Como está o seu corpo depois dos treinos de força? (1 = muito dolorido, 5 = ótimo)',
      type: 'SCALE_1_5',
      reason: 'Houve treino de força na semana.',
    });
  }
  if (signals.hasNutritionPlan) {
    questions.push({
      key: 'food_week',
      prompt: 'Como foi a alimentação na semana, em relação ao plano?',
      type: 'CHOICE',
      options: ['Segui o plano', 'Segui quase sempre', 'Segui pouco', 'Quase nada'],
      reason: 'Base do acompanhamento nutricional.',
    });
  }
  if (signals.hasNutritionPlan && signals.foodLogDaysLast7 < 3) {
    questions.push({
      key: 'food_difficulty',
      prompt: 'O que dificulta registrar ou seguir a alimentação?',
      type: 'CHOICE',
      options: [
        'Esqueço de registrar',
        'Dá trabalho',
        'Rotina muda muito',
        'Não gosto do plano',
        'Outro motivo',
      ],
      reason: `Só ${signals.foodLogDaysLast7} dia(s) com refeição registrada na semana.`,
    });
  }
  // O peso é semanal: todo domingo entra no check-in (opcional) e os agentes leem a evolução.
  questions.push({
    key: 'weight_kg',
    prompt: 'Quanto você pesa hoje, em kg? (de manhã, em jejum, se puder; opcional)',
    type: 'NUMBER',
    reason:
      signals.daysSinceWeight === null
        ? 'Primeira pesagem: ponto de partida da evolução.'
        : `Pesagem semanal (última há ${signals.daysSinceWeight} dia(s)): base da leitura de evolução.`,
  });

  // O que mais pesa na decisão vem primeiro; o texto livre fecha. O corte respeita esta ordem.
  const priority = [
    'pain',
    'pain_where',
    'weight_kg',
    'energy',
    'sleep',
    'stress',
    'motivation',
    'barrier',
    'intensity_feel',
    'soreness',
    'food_week',
    'food_difficulty',
    'next_week',
    'win',
    'help_with',
  ];
  return [...questions]
    .sort((a, b) => priority.indexOf(a.key) - priority.indexOf(b.key))
    .slice(0, MAX_QUESTIONS);
}

export class AnswerError extends Error {}

/** Valida as respostas contra as perguntas enviadas (tipo, faixa, opção, chaves desconhecidas). */
export function validateAnswers(
  questions: readonly CheckInQuestion[],
  answers: Record<string, number | boolean | string>,
): void {
  const keys = new Set(questions.map((q) => q.key));
  for (const key of Object.keys(answers)) {
    if (!keys.has(key)) throw new AnswerError(`resposta para pergunta desconhecida: ${key}`);
  }
  for (const question of questions) {
    if (question.showIf && answers[question.showIf.key] !== question.showIf.equals) {
      if (answers[question.key] !== undefined) {
        throw new AnswerError(`${question.key}: só se responde quando ${question.showIf.key} pede`);
      }
      continue;
    }
    const answer = answers[question.key];
    const optional = question.type === 'TEXT' || question.key === 'weight_kg';
    if (answer === undefined) {
      if (optional) continue;
      throw new AnswerError(`falta responder: ${question.key}`);
    }
    switch (question.type) {
      case 'SCALE_1_5':
        if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 1 || answer > 5) {
          throw new AnswerError(`${question.key}: use um número de 1 a 5`);
        }
        break;
      case 'YES_NO':
        if (typeof answer !== 'boolean')
          throw new AnswerError(`${question.key}: responda sim ou não`);
        break;
      case 'CHOICE':
        if (typeof answer !== 'string' || !question.options?.includes(answer)) {
          throw new AnswerError(`${question.key}: escolha uma das opções`);
        }
        break;
      case 'NUMBER':
        if (typeof answer !== 'number' || !Number.isFinite(answer) || answer < 30 || answer > 300) {
          throw new AnswerError(`${question.key}: número fora da faixa plausível`);
        }
        break;
      case 'TEXT':
        if (typeof answer !== 'string' || answer.length > 1_000) {
          throw new AnswerError(`${question.key}: texto longo demais`);
        }
        break;
    }
  }
}
