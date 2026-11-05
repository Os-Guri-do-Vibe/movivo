import { describe, expect, it } from 'vitest';

import { type EvalCase, evaluatePath, scoreCase, valuesAt } from './eval-case';

const output = {
  strategy: { energyStrategy: 'RECOMPOSITION', rationale: ['proteína alta', 'déficit leve'] },
  sessions: [
    { modality: 'STRENGTH', minutes: 50 },
    { modality: 'RUNNING', minutes: 40 },
  ],
};

const baseCase: EvalCase = {
  id: 'caso',
  taskId: 't',
  title: 'Caso',
  safetyCritical: false,
  minScore: 0.5,
  state: {},
  input: {},
  assertions: [],
};

describe('asserções de caminho', () => {
  it('lê caminhos aninhados e expande arrays com *', () => {
    expect(valuesAt(output, 'sessions.*.modality')).toEqual(['STRENGTH', 'RUNNING']);
    expect(valuesAt(output, 'sessions.1.minutes')).toEqual([40]);
    expect(valuesAt(output, 'nada.aqui')).toEqual([]);
  });

  it('com *, todos os valores precisam passar (exceto contains)', () => {
    const all = evaluatePath(output, {
      kind: 'path',
      path: 'sessions.*.minutes',
      op: 'lte',
      value: 45,
      description: 'sessões até 45 min',
    });
    expect(all.pass).toBe(false);
    const some = evaluatePath(output, {
      kind: 'path',
      path: 'sessions.*.modality',
      op: 'contains',
      value: 'RUNNING',
      description: 'tem corrida',
    });
    expect(some.pass).toBe(true);
  });

  it('eq, in, contains em texto (sem diferenciar maiúsculas) e existência', () => {
    const check = (path: string, op: never, value?: unknown) =>
      evaluatePath(output, { kind: 'path', path, op, value, description: path }).pass;
    expect(check('strategy.energyStrategy', 'eq' as never, 'RECOMPOSITION')).toBe(true);
    expect(check('strategy.energyStrategy', 'in' as never, ['DEFICIT', 'RECOMPOSITION'])).toBe(
      true,
    );
    expect(check('strategy.rationale.*', 'contains' as never, 'PROTEÍNA')).toBe(true);
    expect(check('strategy.surplus', 'notExists' as never)).toBe(true);
    expect(check('strategy.surplus', 'eq' as never, 1)).toBe(false);
  });
});

describe('nota do caso', () => {
  const results = [
    { description: 'a', pass: true, detail: '' },
    { description: 'b', pass: false, detail: '' },
  ];
  it('passa com a fração mínima de asserções', () => {
    expect(scoreCase(baseCase, results)).toEqual({ score: 0.5, pass: true });
  });
  it('caso de segurança exige 100%', () => {
    expect(scoreCase({ ...baseCase, safetyCritical: true }, results).pass).toBe(false);
  });
});
