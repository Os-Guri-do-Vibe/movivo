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
        'A MOVIVO é uma assessoria de movimento, performance e bem-estar pelo WhatsApp. Ela combina a orientação de profissionais registrados nos seus conselhos, ciência e tecnologia (com inteligência artificial como ferramenta de apoio) para ajudar cada pessoa a evoluir com consistência, a partir do próprio ponto de partida.',
    },
    {
      id: 'como-funciona',
      question: 'Como funciona a MOVIVO?',
      answer:
        'Você responde a uma anamnese com seus objetivos, rotina, experiência, disponibilidade e limitações. Com essas informações, a MOVIVO monta um plano individual de treino (musculação, corrida, HYROX ou uma combinação) e de alimentação. A partir daí, o acompanhamento acontece pelo WhatsApp: o link da sessão do dia, registro do que você fez, check-ins e ajustes ao longo das semanas.',
    },
    {
      id: 'quem-supervisiona',
      question: 'Quem supervisiona o meu treino?',
      answer:
        'Profissionais registrados no CREF, e parceiros das áreas de nutrição e saúde nos respectivos conselhos, escrevem as regras dentro das quais a inteligência artificial trabalha. A IA é uma ferramenta de apoio, não quem decide sozinha. Casos sensíveis, sinais de segurança e situações fora dessas regras seguem para avaliação humana.',
    },
    {
      id: 'saude',
      question: 'A MOVIVO substitui o acompanhamento de um profissional de saúde?',
      answer:
        'Não. A MOVIVO oferece orientação de treino e de hábitos alimentares e não substitui consulta, avaliação ou acompanhamento de profissionais de saúde. Se você tem alguma condição de saúde ou dúvida sobre estar apto a se exercitar, converse com um profissional de saúde antes de começar.',
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
        'Sim. A MOVIVO acompanha seus registros, check-ins e a rotina que você informa para manter o plano alinhado ao que você consegue executar, com ajustes ao longo das semanas.',
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
        'Para pessoas maiores de 18 anos que querem orientação individualizada de treino e alimentação, com acompanhamento pelo WhatsApp, seja para começar a se movimentar, correr, treinar força ou se preparar para uma prova. Na anamnese você informa seu contexto, sua disponibilidade e suas limitações, e o plano parte dessas informações.',
    },
  ];
}
