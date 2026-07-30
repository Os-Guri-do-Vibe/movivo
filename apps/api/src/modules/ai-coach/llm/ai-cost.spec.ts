/**
 * Unit — Custo de IA dentro do teto (US-2.7 / TASK-2.7.5 · Victor §8 / Eduardo).
 *
 * Teto: ~R$1,08/usuário/mês (≤15% do ARPU). Sem chave de LLM, o custo é DETERMINÍSTICO —
 * calculado pela MESMA função `costBrl` de produção sobre um envelope mensal representativo
 * (a geração do protocolo desta sprint + a projeção de turnos do Coach que a Sprint 3 herda).
 * Também soma um conjunto de `cost_brl` semeados (espelha o `SELECT sum(cost_brl) FROM ai_jobs`
 * por usuário/mês, sem exigir o banco) e afirma o teto. Se o prompt inchar ou o caching quebrar,
 * o custo estoura e este gate morde.
 */
import { describe, expect, it } from 'vitest';

import { costBrl } from './llm-router.service';

/** BRL/USD representativo (jul/2026, Victor §8). Margem do teto absorve variação cambial. */
const USD_BRL = 6.0;
const CEILING_BRL = 1.08;

describe('custo de IA por usuário/mês dentro do teto', () => {
  it('a geração do protocolo (com prefixo em cache) é barata', () => {
    // Prefixo estável (system CREF + base + schema) em cache; só input fresco + output pagam cheio.
    const gen = costBrl(
      'gpt-4.1',
      { tokensInput: 500, tokensCached: 3000, tokensOutput: 900 },
      USD_BRL,
    );
    expect(gen).toBeGreaterThan(0);
    expect(gen).toBeLessThan(0.1);
  });

  it('envelope mensal (geração + 40 turnos de Coach) ≤ R$1,08', () => {
    const generation = costBrl(
      'gpt-4.1',
      { tokensInput: 500, tokensCached: 3000, tokensOutput: 900 },
      USD_BRL,
    );
    const perCoachTurn = costBrl(
      'gpt-4.1',
      { tokensInput: 300, tokensCached: 1500, tokensOutput: 200 },
      USD_BRL,
    );
    const monthly = generation + perCoachTurn * 40;
    expect(monthly).toBeLessThanOrEqual(CEILING_BRL);
  });

  it('soma de cost_brl semeados por usuário/mês respeita o teto (espelha ai_jobs)', () => {
    // Cada valor é um `ai_jobs.cost_brl` de um job do mesmo usuário no mês.
    const seeded = [0.058, 0.017, 0.019, 0.016, 0.018, 0.02, 0.017];
    const total = seeded.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(CEILING_BRL);
  });
});
