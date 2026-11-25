import { describe, expect, it } from 'vitest';

import { proposalIdsOf, withListContext } from './exception-list';

const rows: Array<{ id: string; subject: Record<string, string> }> = [
  { id: 'a', subject: { proposalId: 'p1', decisionId: 'd1' } },
  { id: 'b', subject: { proposalId: 'p2', decisionId: 'd2' } },
  { id: 'c', subject: { proposalId: 'p1', decisionId: 'd3' } },
  { id: 'd', subject: { source: 'SWAP_GAP', fromExerciseId: 'x1' } },
  { id: 'e', subject: { triggerEventId: 'manual' } },
];

describe('lista de casos com contexto curto', () => {
  it('lê cada proposta uma vez só', () => {
    expect(proposalIdsOf(rows)).toEqual(['p1', 'p2']);
    expect(proposalIdsOf([])).toEqual([]);
  });

  it('acrescenta o tipo da ação e a origem, e não expõe o subject', () => {
    const types = new Map([
      ['p1', 'PUBLISH_TRAINING_PLAN'],
      ['p2', 'PUBLISH_NUTRITION_PLAN'],
    ]);
    const listed = withListContext(rows, types);

    expect(listed).toEqual([
      { id: 'a', actionType: 'PUBLISH_TRAINING_PLAN', source: null },
      { id: 'b', actionType: 'PUBLISH_NUTRITION_PLAN', source: null },
      { id: 'c', actionType: 'PUBLISH_TRAINING_PLAN', source: null },
      { id: 'd', actionType: null, source: 'SWAP_GAP' },
      { id: 'e', actionType: null, source: null },
    ]);
    expect(listed.some((row) => 'subject' in row)).toBe(false);
  });

  it('proposta que sumiu vira tipo desconhecido, sem quebrar a lista', () => {
    expect(withListContext(rows.slice(0, 1), new Map())).toEqual([
      { id: 'a', actionType: null, source: null },
    ]);
  });
});
