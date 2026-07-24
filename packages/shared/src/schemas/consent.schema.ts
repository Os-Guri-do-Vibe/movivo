/**
 * Consentimento LGPD — textos versionados + contrato (US-1.2 / TASK-1.2.1 e 1.2.2).
 *
 * Fonte jurídica: `docs/juridico/consentimento-e-parq.md` (Alexandre). Os textos
 * abaixo são cópia **verbatim** daquele documento e vivem aqui — no pacote
 * compartilhado — por um motivo específico: o frontend renderiza EXATAMENTE o
 * texto que o backend registra em `consents.version`. Se o texto morasse só no
 * frontend, nada impediria a UI de exibir uma redação e o banco registrar outra
 * versão — e o registro deixaria de ser prova (§3.1 do relatório de Alexandre).
 *
 * **Regra de ouro:** texto novo ⇒ versão nova. Nunca edite o corpo de uma versão
 * já publicada; crie `...-v2`. É isso que torna `consents.version` uma prova.
 *
 * As três finalidades são INDEPENDENTES: um aceite jamais implica o outro, e o
 * de saúde jamais é inferido do aceite dos Termos.
 */
import { z } from 'zod';

/** Identificadores de versão imutáveis (o que vai para `consents.version`). */
export const CONSENT_VERSIONS = {
  HEALTH_DATA: 'consent-health-2026-07-v1',
  MARKETING: 'consent-marketing-2026-07-v1',
  TERMS_OF_SERVICE: 'terms-2026-07-v1',
} as const;

export type ConsentTypeWithText = keyof typeof CONSENT_VERSIONS;

/**
 * Placeholder do registro do Responsável Técnico.
 *
 * Alexandre §1.1: **não pode ir a produção com o traço**. Quando o número real
 * do RT for definido, ele congela no texto e isso vira uma NOVA versão
 * (`consent-health-2026-08-v2`) — não uma edição da v1.
 */
export const RT_CREF_PLACEHOLDER = 'CREF nº ____';

/** Corpo + label de cada consentimento, na versão correspondente acima. */
export const CONSENT_TEXTS = {
  HEALTH_DATA: {
    version: CONSENT_VERSIONS.HEALTH_DATA,
    title: 'Agora vamos falar da sua saúde',
    body: [
      'Para montar um treino seguro e adaptado a você, precisamos de algumas informações de saúde: histórico de lesões, respostas a um questionário de prontidão para atividade física (PAR-Q) e medicações de uso contínuo, se houver.',
      `**Para que usamos:** exclusivamente para elaborar e adaptar o seu protocolo de treino individualizado.`,
      `**Quem acessa:** você e o profissional de Educação Física responsável, registrado no ${RT_CREF_PLACEHOLDER}, que usa inteligência artificial apenas como ferramenta de apoio — **a decisão e a supervisão são sempre do profissional**.`,
      '**Como protegemos:** seus dados de saúde são criptografados e isolados; ninguém fora da equipe responsável tem acesso.',
      '**Por quanto tempo:** mantemos seus dados de saúde enquanto você for cliente e, após o encerramento, pelo prazo necessário para cumprir obrigações legais e para defesa em eventual reclamação (até 5 anos). Depois disso, eles são anonimizados ou eliminados.',
      '**Você no controle:** pode revogar esta autorização quando quiser, sem custo, pelo WhatsApp da MOVIVO ou pelo e-mail do nosso Encarregado de Dados (informado na Política de Privacidade). A revogação interrompe novos tratamentos daqui pra frente.',
    ],
    label:
      'Autorizo a MOVIVO a tratar os meus dados de saúde para a finalidade de elaborar e adaptar o meu treino, conforme descrito acima e na Política de Privacidade.',
    /** Trava o Bloco 2 da anamnese. Checkbox nunca pré-marcado. */
    required: true,
  },
  MARKETING: {
    version: CONSENT_VERSIONS.MARKETING,
    title: null,
    body: [],
    label:
      'Quero receber dicas de treino, novidades e ofertas da MOVIVO pelo WhatsApp. (opcional — você pode cancelar quando quiser)',
    /** Opcional: jamais condiciona o avanço do formulário. */
    required: false,
  },
  TERMS_OF_SERVICE: {
    version: CONSENT_VERSIONS.TERMS_OF_SERVICE,
    title: null,
    body: [],
    label:
      'Li e aceito os [Termos de Uso](/termos) e a [Política de Privacidade](/privacidade) da MOVIVO.',
    /** Trava a saída do Bloco 0. */
    required: true,
  },
} as const;

/**
 * Payload de registro de consentimento.
 *
 * `ip` e `userAgent` NÃO entram aqui de propósito: são derivados da requisição
 * no servidor. Aceitá-los do cliente permitiria forjar a origem da prova.
 */
export const recordConsentSchema = z.object({
  type: z.enum(['HEALTH_DATA', 'MARKETING', 'TERMS_OF_SERVICE']),
  /** A versão que a UI exibiu. O servidor recusa se divergir da vigente. */
  version: z.string().min(1).max(40),
  accepted: z.boolean(),
});

export type RecordConsentInput = z.infer<typeof recordConsentSchema>;

/** Aceita um lote (a tela-ponte envia saúde + marketing juntos). */
export const recordConsentsSchema = z.object({
  consents: z.array(recordConsentSchema).min(1).max(3),
});

export type RecordConsentsInput = z.infer<typeof recordConsentsSchema>;
