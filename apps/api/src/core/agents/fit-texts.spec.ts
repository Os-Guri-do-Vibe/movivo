import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { cutAtSentence, fitLongTexts } from './fit-texts';

describe('texto longo demais', () => {
  it('corta na última frase completa que cabe', () => {
    const text =
      'Primeira frase completa. Segunda frase completa e um pouco maior. Terceira frase que estoura.';
    const cut = cutAtSentence(text, 70);
    expect(cut).toBe('Primeira frase completa. Segunda frase completa e um pouco maior.');
    expect(cut.length).toBeLessThanOrEqual(70);
  });

  it('sem frase que caiba, corta na última palavra com reticências, sempre dentro do limite', () => {
    const text =
      'uma frase única sem ponto final que continua e continua por muito mais tempo do que cabe';
    for (const max of [20, 33, 50]) {
      const cut = cutAtSentence(text, max);
      expect(cut.length).toBeLessThanOrEqual(max);
      expect(cut.endsWith('…')).toBe(true);
      expect(cut).not.toMatch(/\s…$/);
    }
  });

  it('texto que cabe não muda', () => {
    expect(cutAtSentence('  Cabe bem.  ', 50)).toBe('Cabe bem.');
  });

  const schema = z.object({
    summary: z.string().max(60),
    notes: z.array(z.string().max(40)).max(6),
    session: z.discriminatedUnion('modality', [
      z.object({ modality: z.literal('A'), label: z.string().max(25) }),
      z.object({ modality: z.literal('B'), label: z.string().max(80) }),
    ]),
    count: z.number(),
  });
  const json = z.toJSONSchema(schema) as Parameters<typeof fitLongTexts>[1];

  it('corta cada texto no limite do seu campo, inclusive em lista e em união discriminada', () => {
    const long = 'Isto é uma frase. E esta é outra frase bem mais comprida que não cabe no campo.';
    const out = fitLongTexts(
      {
        summary: long,
        notes: ['curta', long, long],
        session: { modality: 'A', label: long },
        count: 3,
      },
      json,
    ) as z.infer<typeof schema>;
    expect(out.summary.length).toBeLessThanOrEqual(60);
    expect(out.notes[0]).toBe('curta');
    expect(out.notes.every((note) => note.length <= 40)).toBe(true);
    expect(out.session.label.length).toBeLessThanOrEqual(25);
    expect(out.count).toBe(3);
    expect(schema.safeParse(out).success).toBe(true);
  });

  it('o ramo certo da união vale: o campo de 80 caracteres só é cortado em 80', () => {
    const text = 'x'.repeat(70);
    const out = fitLongTexts(
      { summary: 'ok', notes: [], session: { modality: 'B', label: text }, count: 1 },
      json,
    ) as z.infer<typeof schema>;
    expect(out.session.label).toBe(text);
  });

  it('só texto: lista grande demais e número fora da faixa continuam recusados', () => {
    const out = fitLongTexts(
      {
        summary: 'ok',
        notes: Array(8).fill('n'),
        session: { modality: 'A', label: 'a' },
        count: 1,
      },
      json,
    );
    expect(schema.safeParse(out).success).toBe(false);
  });
});
