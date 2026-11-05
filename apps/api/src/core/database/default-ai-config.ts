/**
 * FAQ e guardrails L1 padrão da aplicação. Chamado no fim do `migrate.ts`, então todo ambiente
 * (dev, staging e produção) já nasce com uma base simples, sem publicar nada pelo painel.
 *
 * É carga do sistema, como as fichas dos agentes e a metodologia padrão: `created_by` fica nulo.
 * Só entra o que a equipe ainda não tem:
 *  - cada item tem uma chave fixa (`faq_key` / `rule_key`); se já existe QUALQUER versão dela (a
 *    equipe editou ou retirou), o item padrão não volta;
 *  - uma resposta de FAQ também não entra se a pergunta já tem resposta publicada com outra chave.
 * Evolução do dia a dia é pelo painel, que versiona. Os profissionais devem revisar o conteúdo
 * (lista em `docs/base-conhecimento/FAQ-E-SEGURANCA-PADRAO.md`).
 *
 * ## Como o FAQ e o guardrail agem (para escrever bem o padrão)
 * - FAQ: só responde se a mensagem do aluno for EXATAMENTE a pergunta (sem acento, caixa nem
 *   pontuação final). Resposta pronta, sem modelo. Não pode conter "diagnóstico", "tratamento",
 *   "cura" nem "garantido", nem em negação.
 * - Guardrail L1: a ação é só FLAG. A mensagem fica retida para a equipe revisar (o aluno recebe o
 *   aviso padrão de que a equipe vai ver). Por isso as frases são específicas, para não gerar ruído
 *   na fila. Sinais de saúde (dor, gestação, transtorno alimentar...) já são da sentinela fixa do
 *   código e não se repetem aqui.
 */
import type postgres from 'postgres';

import { normalizeFaqQuestion } from '../attendance-rules/faq.service';

export interface DefaultFaq {
  /** Chave fixa: identifica a resposta entre versões. Não troque depois de publicada. */
  faqKey: string;
  question: string;
  answer: string;
}

export interface DefaultGuardrail {
  /** Chave fixa: identifica a regra entre versões. Não troque depois de publicada. */
  ruleKey: string;
  label: string;
  scope: 'INPUT' | 'OUTPUT' | 'BOTH';
  phrases: string[];
}

const TEAM =
  'Profissionais da MOVIVO (Educação Física, Nutrição e Medicina) supervisionam o meu trabalho';

export const DEFAULT_FAQS: readonly DefaultFaq[] = [
  {
    faqKey: 'f2494907-4086-4752-abb5-8ca1a6b11205',
    question: 'O que é a MOVIVO?',
    answer:
      'A MOVIVO é uma assessoria de treino e nutrição pelo WhatsApp. Eu sou a assistente de inteligência artificial da equipe e acompanho você seguindo a metodologia dos nossos profissionais de Educação Física, Nutrição e Medicina.',
  },
  {
    faqKey: 'd5659e59-8ac6-46a3-885b-fa8b63f209c2',
    question: 'Como funciona a MOVIVO?',
    answer:
      'Eu monto o seu plano de treino e de alimentação com base nas suas respostas, mando o treino do dia e acompanho o seu progresso por aqui. Se a sua semana mudar (pouco tempo, viagem, falta de equipamento), é só me contar que eu ajusto.',
  },
  {
    faqKey: '1e47d25b-9793-4f5e-8ebf-38a6c1d15d0d',
    question: 'Você é uma pessoa ou uma IA?',
    answer: `Sou uma inteligência artificial, e não uma pessoa. ${TEAM}. Se você quiser falar com alguém da equipe, é só pedir por aqui.`,
  },
  {
    faqKey: '1cafb40c-185d-4f0a-8335-5f95809b8c0c',
    question: 'Você é um robô?',
    answer: `Sou uma inteligência artificial, e não uma pessoa. ${TEAM}. Se você quiser falar com alguém da equipe, é só pedir por aqui.`,
  },
  {
    faqKey: 'e50e5b7b-f1ac-46a3-824b-0d1b362b7572',
    question: 'A MOVIVO substitui um médico?',
    answer:
      'Não. Eu oriento treino e alimentação, mas não substituo consulta médica nem exames. Se você sentir dor forte, tontura, falta de ar ou qualquer sintoma diferente, pare de treinar e procure atendimento médico.',
  },
  {
    faqKey: '29ae2775-3846-4792-a01a-2b791375e364',
    question: 'Quais modalidades vocês atendem?',
    answer:
      'Acompanho musculação, corrida, HYROX e treino híbrido (que combina essas modalidades na mesma semana), sempre com plano de treino e de alimentação.',
  },
  {
    faqKey: '58919274-d7fb-4f06-aa0d-bb614a960c54',
    question: 'Como registro minha alimentação?',
    answer:
      'É só me contar aqui o que você comeu, em texto ou com a foto da refeição. Eu registro e uso isso para acompanhar o seu plano.',
  },
  {
    faqKey: '334202c1-1f9f-49f1-9396-3de43d132542',
    question: 'Como troco um exercício?',
    answer:
      'Me diga qual exercício você quer trocar e o motivo (falta de equipamento, incômodo, não gosta ou está difícil demais). Eu sugiro um substituto parecido que caiba no seu plano.',
  },
  {
    faqKey: 'c8ccb0cb-da6b-446c-b309-170cd73565a7',
    question: 'Meus dados estão seguros?',
    answer:
      'Seus dados de saúde são usados só para montar e acompanhar o seu plano, com o seu consentimento, e ficam protegidos com criptografia. Se quiser saber mais ou pedir algo sobre os seus dados, escreva por aqui que a equipe responde.',
  },
];

export const DEFAULT_GUARDRAILS: readonly DefaultGuardrail[] = [
  {
    ruleKey: '67d64003-4ab4-44b5-b7e3-e853c17f01d4',
    label: 'Anabolizantes e hormônios',
    scope: 'BOTH',
    phrases: [
      'anabolizante',
      'anabolizantes',
      'esteroide',
      'esteroides',
      'testosterona',
      'hormônio do crescimento',
      'oxandrolona',
      'trembolona',
      'stanozolol',
      'clenbuterol',
      'sarms',
    ],
  },
  {
    ruleKey: 'a005278b-0f47-4497-9979-ac08f54ed30f',
    label: 'Remédios e canetas para emagrecer',
    scope: 'BOTH',
    phrases: [
      'ozempic',
      'mounjaro',
      'wegovy',
      'saxenda',
      'semaglutida',
      'tirzepatida',
      'liraglutida',
      'sibutramina',
      'orlistate',
      'inibidor de apetite',
      'remédio para emagrecer',
      'remédio pra emagrecer',
      'caneta para emagrecer',
      'caneta pra emagrecer',
    ],
  },
  {
    ruleKey: '1841b185-4841-4ee7-8a7d-5c303f7b17e2',
    label: 'Menor de idade',
    scope: 'INPUT',
    phrases: [
      'menor de idade',
      'sou menor',
      'ainda sou menor',
      'tenho menos de 18 anos',
      'sou adolescente',
    ],
  },
  {
    ruleKey: '10b17ef1-ddae-4d0d-a51f-c26e32b45189',
    label: 'Dieta ou desidratação extrema',
    scope: 'INPUT',
    phrases: [
      'jejum de 36 horas',
      'jejum de 48 horas',
      'jejum de 72 horas',
      'dieta de 500 calorias',
      'dieta de 800 calorias',
      'sauna para emagrecer',
      'diurético',
      'laxante',
      'cortar a água',
      'desidratar para pesar',
    ],
  },
  {
    ruleKey: '5fad5de9-7ba2-4fc6-b3dc-e474257bc00b',
    label: 'Reclamação formal ou jurídica',
    scope: 'INPUT',
    phrases: [
      'procon',
      'advogado',
      'vou processar vocês',
      'vou processar a movivo',
      'vou te processar',
      'entrar na justiça',
      'danos morais',
      'reclame aqui',
      'denunciar no cref',
      'denunciar no crn',
      'ação judicial',
    ],
  },
  {
    ruleKey: '799be654-62a0-47df-888c-8c1986fa5111',
    label: 'Pedido sobre dados pessoais (LGPD)',
    scope: 'INPUT',
    phrases: [
      'lgpd',
      'apagar meus dados',
      'excluir meus dados',
      'deletar meus dados',
      'remover meus dados',
      'quero meus dados',
      'cópia dos meus dados',
    ],
  },
];

const CHANGE_NOTE = 'Padrão da MOVIVO (carga do sistema no deploy), a evoluir pelo painel.';

/** Grava as respostas e regras padrão que faltam. Devolve quantas entraram nesta execução. */
export async function seedDefaultAiConfig(
  sql: postgres.Sql,
): Promise<{ faq: number; guardrails: number }> {
  let faq = 0;
  for (const entry of DEFAULT_FAQS) {
    const rows = await sql`
      INSERT INTO faq_entries (
        faq_key, canonical_question, normalized_question, answer, version, status, change_note,
        created_by
      )
      SELECT ${entry.faqKey}::uuid, ${entry.question}, ${normalizeFaqQuestion(entry.question)},
        ${entry.answer}, 1, 'PUBLISHED', ${CHANGE_NOTE}, NULL
      WHERE NOT EXISTS (SELECT 1 FROM faq_entries WHERE faq_key = ${entry.faqKey}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM faq_entries WHERE normalized_question = ${normalizeFaqQuestion(entry.question)}
        )
      RETURNING id`;
    faq += rows.length;
  }
  let guardrails = 0;
  for (const rule of DEFAULT_GUARDRAILS) {
    const rows = await sql`
      INSERT INTO ai_guardrail_rules (
        rule_key, label, scope, phrases, action, version, status, change_note, created_by
      )
      SELECT ${rule.ruleKey}::uuid, ${rule.label}, ${rule.scope}::ai_guardrail_scope,
        ${JSON.stringify(rule.phrases)}::jsonb, 'FLAG'::ai_guardrail_action, 1,
        'PUBLISHED'::ai_guardrail_status, ${CHANGE_NOTE}, NULL
      WHERE NOT EXISTS (SELECT 1 FROM ai_guardrail_rules WHERE rule_key = ${rule.ruleKey}::uuid)
      RETURNING id`;
    guardrails += rows.length;
  }
  return { faq, guardrails };
}
