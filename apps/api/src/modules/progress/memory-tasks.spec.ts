import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  memoryCurationValidators,
  type MemoryCuration,
  type MemoryCurationInput,
} from './memory-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };
const EXISTING_ID = '11111111-1111-4111-8111-111111111111';

const input: MemoryCurationInput = {
  existing: [{ id: EXISTING_ID, kind: 'ROUTINE', text: 'Treina à noite' }],
  turns: [
    { from: 'coach', text: 'Como foi a semana? Conseguiu treinar?' },
    { from: 'student', text: 'Passei a treinar de manhã, antes de levar meu filho na escola.' },
  ],
};

const run = async (output: MemoryCuration) =>
  (await Promise.all(memoryCurationValidators.map((v) => v(input, output, ctx)))).flat();

describe('memoryCurationValidators', () => {
  it('aceita fato com citação literal da fala do aluno e aposenta o que ele desmentiu', async () => {
    expect(
      await run({
        add: [
          {
            kind: 'ROUTINE',
            text: 'Treina de manhã, antes de levar o filho à escola',
            importance: 3,
            quote: 'treinar de manhã, antes de levar meu filho',
          },
        ],
        retire: [EXISTING_ID],
      }),
    ).toEqual([]);
  });

  it('recusa citação que o aluno não escreveu (nem a que é fala do coach)', async () => {
    const fromCoach = await run({
      add: [
        {
          kind: 'PERSONAL',
          text: 'Conseguiu treinar na semana',
          importance: 1,
          quote: 'Conseguiu treinar?',
        },
      ],
      retire: [],
    });
    expect(fromCoach.map((v) => v.path)).toContain('add.0.quote');
    const invented = await run({
      add: [
        {
          kind: 'PERSONAL',
          text: 'Mora sozinho no centro da cidade',
          importance: 2,
          quote: 'moro sozinho no centro',
        },
      ],
      retire: [],
    });
    expect(invented.map((v) => v.path)).toContain('add.0.quote');
  });

  it('recusa id desconhecido e dado de contato na memória', async () => {
    const violations = await run({
      add: [
        {
          kind: 'PERSONAL',
          text: 'Prefere contato pelo e-mail ana@exemplo.com',
          importance: 1,
          quote: 'antes de levar meu filho',
        },
      ],
      retire: ['22222222-2222-4222-8222-222222222222'],
    });
    expect(violations.map((v) => v.path)).toEqual(expect.arrayContaining(['retire', 'add.0.text']));
  });
});
