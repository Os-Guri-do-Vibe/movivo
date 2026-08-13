/**
 * Contadores de uso do RAG (US-7.5 / TASK-7.5.3).
 *
 * O retrieval não deixa rastro no Postgres de propósito — a consulta contém a
 * pergunta do aluno, que é dado potencialmente sensível, e persistir uma linha por
 * busca duplicaria a superfície de exposição que `ai_jobs` já evita. O que o painel
 * precisa é **volume** e **taxa de recuperação útil**, e isso são dois inteiros por
 * dia. Ficam no Redis, em chave global (nenhum titular, nenhum texto), com TTL: se
 * o Redis perder a chave, o painel mostra "indisponível", não um zero mentiroso.
 */
import type { RedisKeyBuilder } from '../../../core/redis';

/** 40 dias: cobre a janela de 30 do painel com folga para o dia corrente. */
export const RAG_USAGE_TTL_SECONDS = 40 * 86_400;

/** Dia civil em `America/Sao_Paulo` — mesmo fuso do envelope do Control Center. */
export function ragUsageDay(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function ragUsageKeys(keys: RedisKeyBuilder, day: string) {
  return {
    /** Consultas feitas ao corpus. */
    queries: keys.global('rag', 'queries', day),
    /** Consultas que devolveram ao menos um trecho acima do limiar (recuperação útil). */
    useful: keys.global('rag', 'useful', day),
  };
}
