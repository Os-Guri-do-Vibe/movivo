/**
 * Consentimento LGPD — textos versionados + contrato.
 *
 * Fonte jurídica: `docs/juridico/consentimento-e-parq.md` (Alexandre) — §1 para as
 * versões históricas e **§5 (onboarding v2 / Sprint 6)** para as versões vigentes.
 * Os textos abaixo são cópia **verbatim** daquele documento e vivem aqui — no pacote
 * compartilhado — por um motivo específico: o frontend renderiza EXATAMENTE o
 * texto que o backend registra em `consents.version`. Se o texto morasse só no
 * frontend, nada impediria a UI de exibir uma redação e o banco registrar outra
 * versão — e o registro deixaria de ser prova (§3.1 do relatório de Alexandre).
 *
 * **Regra de ouro:** texto novo ⇒ versão nova. Nunca edite o corpo de uma versão
 * já publicada; crie `...-v3`. É isso que torna `consents.version` uma prova.
 *
 * As finalidades são INDEPENDENTES: um aceite jamais implica o outro, e o de saúde
 * jamais é inferido do aceite dos Termos.
 *
 * ## O que a Sprint 6 mudou (Alexandre §5.8)
 * - `TERMS_OF_SERVICE` → `terms-2026-08-v2` (passa a cobrir a entrega via WhatsApp e
 *   as finalidades de dado pessoal comum sob base contratual — art. 7º, V).
 * - `HEALTH_DATA` → `consent-health-2026-08-v3` (escopo ampliado: dor localizada,
 *   diagnóstico informado, acompanhamento, recomendação de evitação).
 * - **`AI_DISCLOSURE` (novo)** — ciência do uso de IA com supervisão CREF. Não é
 *   autorização: é dever de informação. **Bloqueante e NÃO revogável** — o serviço
 *   recusa `revoke(userId, 'AI_DISCLOSURE')`, não apenas esconde o botão.
 * - `MARKETING` → `consent-marketing-2026-08-v2` (passa a cobrir e-mail além do WhatsApp).
 * - **`WHATSAPP_OPERATIONAL_NOTICE` NÃO é consentimento** e **não entra no enum**:
 *   é aviso exibido na Etapa 1, sem checkbox e sem linha em `consents` (§5.2).
 */
import { z } from 'zod';

/** Identificadores de versão imutáveis (o que vai para `consents.version`). */
export const CONSENT_VERSIONS = {
  HEALTH_DATA: 'consent-health-2026-08-v3',
  MARKETING: 'consent-marketing-2026-08-v2',
  TERMS_OF_SERVICE: 'terms-2026-08-v2',
  AI_DISCLOSURE: 'ai-disclosure-2026-08-v1',
} as const;

export type ConsentTypeWithText = keyof typeof CONSENT_VERSIONS;

/** Tipos que aceitam revogação. `AI_DISCLOSURE` fica de fora por natureza jurídica (§5.4). */
export const REVOCABLE_CONSENT_TYPES = ['HEALTH_DATA', 'MARKETING'] as const;
export type RevocableConsentType = (typeof REVOCABLE_CONSENT_TYPES)[number];

export function isRevocableConsent(type: ConsentTypeWithText): type is RevocableConsentType {
  return (REVOCABLE_CONSENT_TYPES as readonly string[]).includes(type);
}

/**
 * Placeholder do registro do Responsável Técnico.
 *
 * Alexandre §1.1/§5.3: **não pode ir a produção com o traço**. Quando o número real
 * do RT for definido, ele congela no texto e isso vira uma NOVA versão — não uma
 * edição da v3.
 */
export const RT_CREF_PLACEHOLDER = 'CREF nº ____';

/** Artefato imutável da v1 de saúde; preserva exatamente o texto histórico aceito. */
export const HEALTH_DATA_CONSENT_V1 = {
  version: 'consent-health-2026-07-v1',
  title: 'Agora vamos falar da sua saúde',
  body: [
    'Para montar um treino seguro e adaptado a você, precisamos de algumas informações de saúde: histórico de lesões, respostas a um questionário de prontidão para atividade física (PAR-Q) e medicações de uso contínuo, se houver.',
    '**Para que usamos:** exclusivamente para elaborar e adaptar o seu protocolo de treino individualizado.',
    `**Quem acessa:** você e o profissional de Educação Física responsável, registrado no ${RT_CREF_PLACEHOLDER}, que usa inteligência artificial apenas como ferramenta de apoio — **a decisão e a supervisão são sempre do profissional**.`,
    '**Como protegemos:** seus dados de saúde são criptografados e isolados; ninguém fora da equipe responsável tem acesso.',
    '**Por quanto tempo:** mantemos seus dados de saúde enquanto você for cliente e, após o encerramento, pelo prazo necessário para cumprir obrigações legais e para defesa em eventual reclamação (até 5 anos). Depois disso, eles são anonimizados ou eliminados.',
    '**Você no controle:** pode revogar esta autorização quando quiser, sem custo, pelo WhatsApp da MOVIVO ou pelo e-mail do nosso Encarregado de Dados (informado na Política de Privacidade). A revogação interrompe novos tratamentos daqui pra frente.',
  ],
  label:
    'Autorizo a MOVIVO a tratar os meus dados de saúde para a finalidade de elaborar e adaptar o meu treino, conforme descrito acima e na Política de Privacidade.',
  required: true,
} as const;

/**
 * Aviso operacional do WhatsApp (Alexandre §5.2) — **art. 7º, V, execução de contrato**.
 *
 * NÃO é consentimento: não tem checkbox, não gera linha em `consents` e não entra no
 * enum `consent_type`. A UI exibe; a prova de exibição é a paridade versão↔tela, e o
 * carimbo temporal correspondente é o do `TERMS_OF_SERVICE` da mesma tela.
 */
export const WHATSAPP_OPERATIONAL_NOTICE = {
  id: 'WHATSAPP_OPERATIONAL_NOTICE',
  version: 'aviso-whatsapp-operacional-2026-08-v1',
  title: 'Como a MOVIVO fala com você',
  body: [
    'Seu treino, os check-ins e a conversa com o Coach acontecem no WhatsApp — é assim que a MOVIVO funciona. Ao continuar, você passa a receber neste número as mensagens necessárias para o serviço funcionar: seu protocolo de treino, respostas do Coach, check-ins, avisos de segurança, recados do profissional de Educação Física responsável e informações da sua assinatura.',
    'Isso não é propaganda e não tem como ser desligado separadamente — sem essas mensagens não existe treino. Novidades e ofertas são outra coisa, e ficam por sua conta na última opção abaixo.',
  ],
} as const;

/**
 * Corpo + label de cada consentimento, na versão correspondente acima.
 *
 * A ordem das chaves é a ordem de exibição na Etapa 1 (§5.8): Termos → Saúde →
 * Ciência de IA → Marketing (opcional, visualmente separado).
 */
export const CONSENT_TEXTS = {
  TERMS_OF_SERVICE: {
    version: CONSENT_VERSIONS.TERMS_OF_SERVICE,
    title: null,
    body: [],
    label:
      'Li e aceito os [Termos de Uso](/termos) e a [Política de Privacidade](/privacidade) da MOVIVO.',
    /** Trava o `CONTINUAR` da Etapa 1. */
    required: true,
  },
  HEALTH_DATA: {
    version: CONSENT_VERSIONS.HEALTH_DATA,
    title: 'Sobre a sua saúde',
    body: [
      'Para montar um treino seguro e adaptado a você, precisamos de informações de saúde: dores atuais (região, intensidade e se estão melhorando ou piorando), lesões e cirurgias, diagnósticos que você já tenha recebido, se você faz acompanhamento com médico ou fisioterapeuta, orientações profissionais de evitar algum movimento, medicações de uso contínuo e as respostas ao questionário de prontidão para atividade física (PAR-Q).',
      '**Para que usamos:** exclusivamente para elaborar, adaptar e acompanhar o seu protocolo de treino individualizado, e para identificar quando o seu caso precisa ser analisado por uma pessoa antes de qualquer treino ser gerado.',
      `**Quem acessa:** você e o profissional de Educação Física responsável, registrado no ${RT_CREF_PLACEHOLDER}, que usa inteligência artificial apenas como ferramenta de apoio — **a decisão e a supervisão são sempre do profissional**.`,
      '**Como protegemos:** seus dados de saúde são criptografados e isolados; ninguém fora da equipe responsável tem acesso.',
      '**Por quanto tempo:** mantemos seus dados de saúde enquanto você for cliente e, após o encerramento, pelo prazo necessário para cumprir obrigações legais e para defesa em eventual reclamação (até 5 anos). Depois disso, eles são anonimizados ou eliminados.',
      '**Você no controle:** pode revogar esta autorização quando quiser, sem custo. No WhatsApp da MOVIVO, envie exatamente “REVOGAR CONSENTIMENTO DE SAÚDE”; ou contate o e-mail do nosso Encarregado de Dados (informado na Política de Privacidade). A revogação interrompe novos tratamentos daqui pra frente — e, como o treino individualizado depende desses dados, ela também interrompe a geração de novos treinos.',
    ],
    label:
      'Autorizo a MOVIVO a tratar os meus dados de saúde para elaborar, adaptar e acompanhar o meu treino, conforme descrito acima e na Política de Privacidade.',
    /** Trava o `CONTINUAR` da Etapa 1 **e** a coleta da seção 4 + Etapa 3 (PAR-Q). */
    required: true,
  },
  AI_DISCLOSURE: {
    version: CONSENT_VERSIONS.AI_DISCLOSURE,
    title: 'Como o seu treino é feito',
    body: [
      `Seu treino é montado a partir da metodologia de um profissional de Educação Física registrado no ${RT_CREF_PLACEHOLDER}, que é o responsável técnico pela MOVIVO. A inteligência artificial é a ferramenta que aplica essa metodologia ao seu caso e conversa com você no dia a dia — ela nunca decide sozinha e nunca substitui o profissional.`,
      'Sempre que as suas respostas indicarem que o seu caso precisa de um olhar humano, nenhum treino é gerado automaticamente: o profissional analisa antes. A MOVIVO não faz diagnóstico e não substitui avaliação médica.',
    ],
    /** "Estou ciente", nunca "Autorizo" — o verbo é o que mantém a natureza jurídica (§5.4). */
    label:
      'Estou ciente de que a MOVIVO usa inteligência artificial como ferramenta, com metodologia e supervisão de um profissional de Educação Física registrado no CREF.',
    required: true,
  },
  MARKETING: {
    version: CONSENT_VERSIONS.MARKETING,
    title: null,
    body: [],
    label:
      'Quero receber novidades, conteúdos e condições especiais da MOVIVO pelo WhatsApp e por e-mail. (opcional — você pode cancelar quando quiser)',
    /** Opcional: jamais condiciona o avanço do formulário (art. 9º, §3º). */
    required: false,
  },
} as const;

/** Tipos obrigatórios para o `CONTINUAR` da Etapa 1 (§5.8). */
export const REQUIRED_CONSENT_TYPES = (Object.keys(CONSENT_TEXTS) as ConsentTypeWithText[]).filter(
  (type) => CONSENT_TEXTS[type].required,
);

/**
 * Payload de registro de consentimento.
 *
 * `ip` e `userAgent` NÃO entram aqui de propósito: são derivados da requisição
 * no servidor. Aceitá-los do cliente permitiria forjar a origem da prova.
 */
export const recordConsentSchema = z.object({
  type: z.enum(['HEALTH_DATA', 'MARKETING', 'TERMS_OF_SERVICE', 'AI_DISCLOSURE']),
  /** A versão que a UI exibiu. O servidor recusa se divergir da vigente. */
  version: z.string().min(1).max(40),
  accepted: z.boolean(),
});

export type RecordConsentInput = z.infer<typeof recordConsentSchema>;

/** Aceita o lote da Etapa 1 — até 4 itens (§5.8, regra nova 3). */
export const recordConsentsSchema = z.object({
  consents: z.array(recordConsentSchema).min(1).max(4),
});

export type RecordConsentsInput = z.infer<typeof recordConsentsSchema>;
