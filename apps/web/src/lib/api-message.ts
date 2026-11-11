/**
 * Mensagens de erro do painel sempre em português claro. O servidor responde com uma frase
 * própria (em português) quando ela existe; quando não existe, o framework devolve texto técnico
 * em inglês ("Cannot GET /api/...", "Bad Request", "Internal Server Error"), que nunca deve chegar
 * à tela. Aqui se decide qual texto mostrar.
 */

/** Mensagem simples por status, para quando a resposta não traz frase útil em português. */
const STATUS_MESSAGE: Readonly<Record<number, string>> = {
  400: 'Alguns dados não são válidos. Confira os campos e tente de novo.',
  401: 'Sua sessão expirou. Entre de novo para continuar.',
  403: 'Seu perfil não tem permissão para fazer isso.',
  404: 'Não encontramos o que você pediu. Atualize a página e tente de novo.',
  405: 'Esta ação não está disponível no momento. Atualize a página e tente de novo.',
  408: 'A resposta demorou demais. Tente de novo.',
  409: 'Esta ação não é possível no estado atual. Atualize a página e confira.',
  413: 'O conteúdo enviado é grande demais.',
  422: 'Alguns dados não são válidos. Confira os campos e tente de novo.',
  429: 'Muitas tentativas seguidas. Aguarde um instante e tente de novo.',
  502: 'O servidor não respondeu como esperado. Tente de novo em instantes.',
  503: 'O serviço está indisponível agora. Tente de novo em instantes.',
  504: 'O servidor demorou demais para responder. Tente de novo em instantes.',
};
const SERVER_ERROR_MESSAGE = 'Algo deu errado do nosso lado. Tente de novo em instantes.';
const GENERIC_MESSAGE = 'Não foi possível concluir a operação. Tente de novo.';

/** Texto técnico em inglês que os frameworks devolvem quando nenhuma regra própria respondeu. */
const TECHNICAL_PATTERNS: readonly RegExp[] = [
  /^cannot (get|post|put|patch|delete|head|options)\b/i,
  /^(bad request|unauthorized|forbidden|forbidden resource|not found|conflict|too many requests|unprocessable entity|internal server error|bad gateway|service unavailable|gateway timeout|method not allowed|payload too large)$/i,
  /\b(econnrefused|etimedout|enotfound|socket hang up|fetch failed|unexpected token)\b/i,
  /^(error|typeerror|syntaxerror|validation failed|request failed)\b/i,
];

/** Palavras muito comuns do português: texto sem nenhuma delas (e sem acento) não é nosso. */
const PORTUGUESE_WORDS =
  /\b(não|nao|de|da|do|das|dos|para|que|com|uma|um|em|ou|este|esta|esse|essa|seu|sua|ainda|valor|versão|erro|tente|tentar|favor|sessão|dados|campo|campos|aluno|alunos|precisa|pode|possível|foi|foram|está|são)\b/i;

/** `true` quando a frase parece escrita por nós, em português. */
export function looksPortuguese(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (TECHNICAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return /[áàâãéêíóôõúç]/i.test(trimmed) || PORTUGUESE_WORDS.test(trimmed);
}

/**
 * A frase do servidor, se for em português; senão a do `fallback` (quando dada) ou a mensagem
 * padrão do status.
 */
export function friendlyMessage(status: number, raw: unknown, fallback?: string): string {
  if (typeof raw === 'string' && looksPortuguese(raw)) return raw.trim();
  return (
    fallback ?? STATUS_MESSAGE[status] ?? (status >= 500 ? SERVER_ERROR_MESSAGE : GENERIC_MESSAGE)
  );
}
