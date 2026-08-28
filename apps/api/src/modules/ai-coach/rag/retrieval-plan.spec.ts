import { describe, expect, it } from 'vitest';

import { buildRetrievalPlan } from './retrieval-plan';

describe('buildRetrievalPlan', () => {
  it('mantém uma única busca para pergunta simples', () => {
    expect(buildRetrievalPlan('Quanto descanso entre as séries?')).toEqual({
      mode: 'SINGLE_HOP',
      queries: ['Quanto descanso entre as séries?'],
    });
  });

  it('decompõe pergunta composta sem perder a consulta original', () => {
    const plan = buildRetrievalPlan(
      'Quanto descanso entre séries? Além disso, como progrido a carga com segurança?',
    );
    expect(plan.mode).toBe('MULTI_HOP');
    expect(plan.queries[0]).toContain('Quanto descanso');
    expect(plan.queries.length).toBeGreaterThan(1);
  });
});
