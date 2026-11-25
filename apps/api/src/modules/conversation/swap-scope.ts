/**
 * Alcance de uma troca de exercício pedida no WhatsApp: só a próxima sessão ou o protocolo todo.
 * A leitura é determinística (palavras do aluno): a pergunta do Coach tem resposta curta e o
 * modelo não decide o que vai para a fila do profissional.
 */
import { fold } from '../planning/tasks/common';

export type SwapScope = 'NEXT_SESSION' | 'PLAN';

const NEXT_STRONG = [
  /\bso (por )?hoje\b/,
  /\bsomente hoje\b/,
  /\bso (no|na|pro|para o|para a) (proximo|proxima)\b/,
  /\bso (essa|esta|desta|dessa) vez\b/,
  /\buma vez so\b/,
  /\bso (agora|amanha|nesse treino|neste treino|nessa sessao|nesta sessao)\b/,
  /\b(so )?(para|pra|no|pro) (o )?treino de hoje\b/,
  /\bapenas (hoje|no proximo|na proxima)\b/,
];
const PLAN_STRONG = [
  /\b(no|em todo o?|para todo o?|pro) (meu )?(protocolo|plano)\b/,
  /\b(protocolo|plano|treino) (todo|inteiro)\b/,
  /\bpra sempre\b/,
  /\bpara sempre\b/,
  /\bde vez\b/,
  /\bdefinitiv/,
  /\bpermanente/,
  /\batualiz/,
  /\bdaqui (pra|para) frente\b/,
  /\bdaqui em diante\b/,
  /\b(em )?todos os treinos\b/,
  /\btodas as sessoes\b/,
];
/** Só valem como resposta a "só hoje ou no protocolo?": sozinhos podem ser outro assunto. */
const NEXT_ANSWER = [/^(so )?(hoje|amanha)\b/, /\bproxim[oa] (treino|sessao)\b/, /^(1|um)$/];
const PLAN_ANSWER = [/^(no )?protocolo\b/, /\bsempre\b/, /\btodos\b/, /^(2|dois)$/];

const matches = (patterns: readonly RegExp[], text: string) => patterns.some((p) => p.test(text));

/**
 * `answering`: a mensagem responde à pergunta de alcance (aceita respostas curtas como "hoje").
 * Fora disso, só frases inequívocas. Ambígua (as duas) ou sem pista: `null`.
 */
export function swapScopeOf(text: string, answering = false): SwapScope | null {
  const folded = fold(text).trim();
  const next = matches(NEXT_STRONG, folded) || (answering && matches(NEXT_ANSWER, folded));
  const plan = matches(PLAN_STRONG, folded) || (answering && matches(PLAN_ANSWER, folded));
  if (next === plan) return null;
  return next ? 'NEXT_SESSION' : 'PLAN';
}

/** O aluno desistiu da troca em vez de escolher o alcance. */
export function declinesSwap(text: string): boolean {
  return /^(nao|deixa|deixa pra la|esquece|cancela|melhor nao|nao precisa)\b/.test(
    fold(text).trim(),
  );
}
