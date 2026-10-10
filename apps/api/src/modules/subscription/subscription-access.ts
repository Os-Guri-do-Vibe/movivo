/**
 * Regras puras do acesso ao gerenciamento da assinatura sem token: normalização do telefone
 * digitado na página pública e reconhecimento do pedido de cancelamento no WhatsApp.
 * Sem I/O: o serviço decide o que fazer com o veredito.
 */
import { phoneE164Schema } from '@movivo/shared';

/**
 * Telefone digitado (só dígitos) → E.164 brasileiro, ou `null`. Casamento exato: nada de variante
 * com/sem o 9º dígito, porque "quase igual" é como a informação de um titular chegaria a outro.
 */
export function normalizeBrazilianPhone(digits: string): string | null {
  const clean = digits.replace(/\D/g, '');
  const withCountry =
    clean.length === 10 || clean.length === 11
      ? `55${clean}`
      : (clean.length === 12 || clean.length === 13) && clean.startsWith('55')
        ? clean
        : null;
  if (!withCountry) return null;
  const e164 = `+${withCountry}`;
  return phoneE164Schema.safeParse(e164).success ? e164 : null;
}

const BILLING_WORDS = '(assinatura|plano|cobranca|mensalidade|pagamento|renovacao|conta)';

/** Minúsculas, sem acento e sem pontuação — a comparação não depende de como a pessoa digita. */
function canonical(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INTENT_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\bcancel\\w*\\b.*\\b${BILLING_WORDS}\\b`),
  new RegExp(`\\b${BILLING_WORDS}\\b.*\\bcancel\\w*\\b`),
  new RegExp(`\\b(gerenciar|encerrar|parar|interromper)\\b.*\\b${BILLING_WORDS}\\b`),
  /\b(nao quero mais pagar|parar de pagar|para de me cobrar|parem de me cobrar)\b/,
  /\b(reembolso|estorno|estornar|arrependimento|arrependi)\b/,
  /^(quero )?(cancelar|sair)( por favor| pf| pfv)?$/,
];

/** A mensagem pede para cancelar/gerenciar a assinatura (ou estorno por arrependimento)? */
export function isSubscriptionManagementIntent(text: string): boolean {
  const normalized = canonical(text);
  if (!normalized || normalized.length > 200) return false;
  return INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

const SUBSCRIBE_PATTERNS: readonly RegExp[] = [
  /\b(assinar|reassinar|assinatura)\b.*\b(de novo|novamente|outra vez)\b/,
  /\b(quero|queria|gostaria de|vou|posso|bora|como faco para|como eu faco para) (voltar a )?(assinar|reassinar)\b/,
  /\b(reativar|renovar|retomar)\b.*\b(assinatura|plano|mensalidade)\b/,
  /\b(assinatura|plano|mensalidade)\b.*\b(reativar|renovar|retomar)\b/,
  /\bvoltar a (assinar|pagar)\b/,
  /\blink (de|do|para) (pagamento|checkout|assinatura|assinar)\b/,
  /\bcomo (eu )?(pago|assino|faco o pagamento)\b/,
];

/** A mensagem pede para assinar (ou voltar a assinar)? Cancelar tem precedência, no chamador. */
export function isSubscribeIntent(text: string): boolean {
  const normalized = canonical(text);
  if (!normalized || normalized.length > 200) return false;
  return SUBSCRIBE_PATTERNS.some((pattern) => pattern.test(normalized));
}
