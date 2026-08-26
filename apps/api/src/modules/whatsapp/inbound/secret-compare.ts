/**
 * Comparação de segredo em tempo constante (Sato).
 *
 * `timingSafeEqual` exige buffers de MESMO tamanho — comparar tokens de tamanho variável
 * diretamente ou vaza o tamanho (pelo caminho de erro) ou lança. Hashear os dois lados com
 * SHA-256 antes normaliza o tamanho para 32 bytes sempre, então a comparação não revela
 * nem o tamanho nem o conteúdo do segredo esperado.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** `true` só quando ambos existem e são idênticos. Nunca lança. */
export function constantTimeEquals(a: string | undefined, b: string | undefined): boolean {
  // Fail-closed: token ausente nunca é igual a nada (inclusive a outro ausente).
  if (a === undefined || b === undefined) return false;
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}
