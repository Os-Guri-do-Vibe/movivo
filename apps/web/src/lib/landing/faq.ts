/**
 * Perguntas frequentes da landing. É a fonte única da seção visível e do `FAQPage` em
 * JSON-LD: o que o buscador (ou uma IA) lê é exatamente o que a pessoa vê.
 *
 * Cada resposta é autocontida (faz sentido citada isolada) e só afirma o que a landing já
 * afirma. Preço nunca é digitado aqui: sai do catálogo de planos.
 */
import { TRIAL_DAYS, LANDING_PLANS, billingCadence, formatBRL, type LandingPlan } from './pricing';

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

function plansSentence(plans: readonly LandingPlan[]): string {
  const list = plans
    .map(
      (plan) =>
        `${plan.label.toLowerCase()} por ${formatBRL(plan.totalCents)} ${billingCadence(plan.months)}`,
    )
    .join(', ')
    // O `Intl` usa espaço sem quebra entre o símbolo e o valor; em texto corrido vira espaço comum.
    .replace(/\s/g, ' ');
  return `Os planos disponíveis são: ${list}. Todos incluem o mesmo acompanhamento; o período muda só o valor.`;
}

export function buildFaq(plans: readonly LandingPlan[] = LANDING_PLANS): FaqItem[] {
  return [
    {
      id: 'o-que-e',
      question: 'O que é a MOVIVO?',
      answer:
        'A MOVIVO é uma plataforma de orientação de treino individualizada pelo WhatsApp. Ela combina tecnologia e inteligência artificial com a metodologia e a supervisão de um profissional de Educação Física registrado no CREF.',
    },
    {
      id: 'como-funciona',
      question: 'Como funciona a MOVIVO?',
      answer:
        'Você responde a uma anamnese com seus objetivos, rotina, experiência, disponibilidade e limitações. Com essas informações, a MOVIVO estrutura um protocolo de treino individualizado, que passa por supervisão profissional antes de chegar até você. A partir daí, o acompanhamento acontece pelo WhatsApp: treino, orientação, feedbacks e ajustes.',
    },
    {
      id: 'quem-supervisiona',
      question: 'Quem supervisiona o meu treino?',
      answer:
        'Um responsável técnico com registro no CREF define os critérios da metodologia e revisa os protocolos antes de chegarem até você. A inteligência artificial é uma ferramenta usada por esse profissional, não quem decide sozinha. Exceções e casos sensíveis seguem para avaliação humana.',
    },
    {
      id: 'saude',
      question: 'A MOVIVO substitui o acompanhamento de um profissional de saúde?',
      answer:
        'Não. A MOVIVO oferece orientação de treino e não substitui consulta, avaliação ou acompanhamento de profissionais de saúde. Se você tem alguma condição de saúde ou dúvida sobre estar apto a se exercitar, converse com um profissional de saúde antes de começar.',
    },
    {
      id: 'teste-gratis',
      question: 'Como funciona o teste grátis?',
      answer: `Você tem ${TRIAL_DAYS} dias para experimentar a MOVIVO antes de decidir continuar. Não é preciso cadastrar cartão para começar e não há cobrança automática ao fim do teste.`,
    },
    {
      id: 'preco',
      question: 'Quanto custa a MOVIVO?',
      answer: plansSentence(plans),
    },
    {
      id: 'adaptacao',
      question: 'O treino se adapta quando a minha rotina muda?',
      answer:
        'Sim. A MOVIVO acompanha seus feedbacks, sua rotina e a carga e a execução observadas para manter o protocolo alinhado ao que você consegue executar, com ajustes ao longo das semanas.',
    },
    {
      id: 'aplicativo',
      question: 'Preciso baixar algum aplicativo?',
      answer: 'Não. O acompanhamento acontece pelo WhatsApp, que você já usa no dia a dia.',
    },
    {
      id: 'para-quem',
      question: 'Para quem é a MOVIVO?',
      answer:
        'Para pessoas maiores de 18 anos que querem orientação de treino individualizada, com acompanhamento pelo WhatsApp. Na anamnese você informa seu contexto de treino, sua disponibilidade e suas limitações, e o protocolo parte dessas informações.',
    },
  ];
}
