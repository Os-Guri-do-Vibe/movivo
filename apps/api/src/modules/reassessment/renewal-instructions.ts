/**
 * Do fechamento do ciclo ao briefing dos protocolos novos: texto objetivo para os agentes que
 * montam o treino e a alimentação, e as notas que o profissional vê na Fila. Funções puras.
 */
import type { CycleReassessmentAnswers } from '@movivo/shared';

import type { PlanRenewal } from '../planning/plan-generation.service';
import type { CycleReview } from './reassessment-tasks';

const VOLUME_TEXT = {
  INCREASE: 'aumentar o volume em relação ao ciclo anterior, dentro da zona segura',
  MAINTAIN: 'manter o volume do ciclo anterior',
  DECREASE: 'reduzir o volume em relação ao ciclo anterior',
} as const;
const ENERGY_TEXT = {
  INCREASE: 'subir a meta de energia',
  MAINTAIN: 'manter a meta de energia',
  DECREASE: 'reduzir a meta de energia',
} as const;
/**
 * O próximo protocolo concilia quatro fontes, nesta ordem de peso quando entram em conflito:
 * segurança e ciência (metodologia publicada), a periodização correta do aluno, as respostas
 * novas e a rotina, e o que de fato aconteceu no ciclo que fecha.
 */
const RECONCILE_RULE = (domain: 'treino' | 'alimentação') =>
  `Concilie no novo protocolo de ${domain}: (1) a ciência e a metodologia publicada, que não se negociam; (2) a periodização correta do aluno: em que ponto do planejamento de longo prazo ele está, o que as fases anteriores já cobriram e o que a próxima fase precisa entregar; (3) as respostas novas e a rotina atual dele; (4) os resultados realizados neste ciclo (adesão, cargas e progressão, medidas, resposta do corpo e avaliação física por foto). Quando houver conflito entre o que ele pede e o que os dados e a ciência indicam, siga o que é seguro e eficaz e explique o motivo na nota ao profissional.`;

const LOAD_FEEL = {
  TOO_EASY: 'o aluno achou o treino fácil demais',
  ADEQUATE: 'o aluno achou a carga de treino adequada',
  TOO_HARD: 'o aluno achou o treino pesado demais',
} as const;

const WEEKDAY_PT = {
  MON: 'segunda',
  TUE: 'terça',
  WED: 'quarta',
  THU: 'quinta',
  FRI: 'sexta',
  SAT: 'sábado',
  SUN: 'domingo',
} as const;
const SLOT_PT = {
  MORNING: 'manhã',
  AFTERNOON: 'tarde',
  EVENING: 'noite',
  ANY: 'horário variável',
} as const;

function routineLine(answers: CycleReassessmentAnswers): string | null {
  if (!answers.routine.changed) return null;
  const parts = [
    answers.routine.weekdays.length > 0
      ? `treina ${answers.routine.weekdays.map((day) => WEEKDAY_PT[day]).join(', ')}`
      : answers.routine.daysPerWeek
        ? `${answers.routine.daysPerWeek} dia(s) por semana`
        : null,
    answers.routine.slot ? `de ${SLOT_PT[answers.routine.slot]}` : null,
    answers.routine.sessionMinutes
      ? `cerca de ${answers.routine.sessionMinutes} minutos por sessão`
      : null,
    answers.routine.notes || null,
  ].filter(Boolean);
  return `Rotina mudou (a disponibilidade do aluno já foi atualizada e vale para o plano): ${parts.join('; ') || 'ver relato do aluno'}.`;
}

export function renewalOf(review: CycleReview, answers: CycleReassessmentAnswers): PlanRenewal {
  const { training, nutrition } = review.nextCycle;
  const routine = routineLine(answers);
  const goalLine = answers.goals.stillTheSame
    ? null
    : `O objetivo mudou: ${answers.goals.notes || 'ver relato do aluno'}.`;

  const trainingInstruction = [
    'Próximo ciclo de treino (reavaliação do ciclo anterior).',
    `Foco: ${training.focus}`,
    `Volume: ${VOLUME_TEXT[training.volume]}.`,
    training.includeDeloadMesocycle
      ? 'Incluir mesociclo de recuperação (deload) programado no fim do bloco, porque os dados do aluno pedem.'
      : 'Não incluir semana leve: recuperação programada só quando os dados pedirem.',
    `Percepção: ${LOAD_FEEL[answers.phase.trainingLoad]}.`,
    routine,
    goalLine,
    ...training.changes.map((change) => `Mudança: ${change}`),
    'Progressão é orientação ao aluno (critério e tentativas sugeridas), não carga obrigatória por exercício.',
    RECONCILE_RULE('treino'),
  ];
  const nutritionInstruction = [
    'Próximo ciclo alimentar (reavaliação do ciclo anterior).',
    `Foco: ${nutrition.focus}`,
    `Energia: ${ENERGY_TEXT[nutrition.energy]}.`,
    nutrition.healthFocus.length > 0
      ? `Priorizar saúde, longevidade e imunidade: ${nutrition.healthFocus.join('; ')}.`
      : null,
    answers.nutrition.difficulties
      ? `Dificuldades relatadas: ${answers.nutrition.difficulties}`
      : null,
    answers.nutrition.newRestrictions
      ? `Restrições novas: ${answers.nutrition.newRestrictions}`
      : null,
    routine,
    goalLine,
    ...nutrition.changes.map((change) => `Mudança: ${change}`),
    'A avaliação física visual atual (fotos e medidas da reavaliação) está no estado: se a gordura estimada ou as medidas pedem outra estratégia energética, a ciência e o objetivo decidem, não o hábito do ciclo anterior.',
    RECONCILE_RULE('alimentação'),
  ];
  const notes = [
    `Reavaliação do ciclo: ${review.summary}`,
    ...review.professionalFlags.map((flag) => `Atenção do especialista: ${flag}`),
  ];
  return {
    trainingInstruction: trainingInstruction.filter(Boolean).join('\n'),
    nutritionInstruction: nutritionInstruction.filter(Boolean).join('\n'),
    notes,
  };
}
