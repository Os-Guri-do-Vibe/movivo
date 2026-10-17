import { describe, expect, it } from 'vitest';

import { collapseUnchanged, countWords, diffLines, diffWords } from './text-diff';

describe('diffLines', () => {
  it('textos idênticos não geram mudanças', () => {
    const diff = diffLines('a\nb\nc', 'a\nb\nc');
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.lines.every((line) => line.op === 'equal')).toBe(true);
  });

  it('marca o que entrou e o que saiu com a numeração de cada versão', () => {
    const diff = diffLines('a\nb\nc', 'a\nc\nd');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.lines.map((line) => [line.op, line.text])).toEqual([
      ['equal', 'a'],
      ['remove', 'b'],
      ['equal', 'c'],
      ['add', 'd'],
    ]);
    const removed = diff.lines.find((line) => line.op === 'remove');
    expect(removed).toMatchObject({ oldNumber: 2, newNumber: null });
    const added = diff.lines.find((line) => line.op === 'add');
    expect(added).toMatchObject({ oldNumber: null, newNumber: 4 - 1 });
  });

  it('normaliza quebras de linha do Windows', () => {
    expect(diffLines('a\r\nb', 'a\nb').added).toBe(0);
  });

  it('texto novo vazio remove tudo; base vazia adiciona tudo', () => {
    expect(diffLines('a\nb', '').removed).toBe(2);
    expect(diffLines('', 'a\nb').added).toBe(2);
  });

  it('destaca as palavras trocadas numa linha reescrita', () => {
    const diff = diffLines(
      'Treinar 3 vezes por semana com carga moderada.',
      'Treinar 4 vezes por semana com carga moderada.',
    );
    const removed = diff.lines.find((line) => line.op === 'remove');
    const added = diff.lines.find((line) => line.op === 'add');
    expect(removed?.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(['3']);
    expect(added?.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(['4']);
  });

  it('não destaca por palavra quando as linhas não têm nada em comum', () => {
    const diff = diffLines('alfa beta', 'gama delta');
    expect(diff.lines.every((line) => line.segments === undefined)).toBe(true);
  });

  it('cai para substituição aproximada em miolos gigantes sem travar', () => {
    const before = Array.from({ length: 2500 }, (_, i) => `antes ${i}`).join('\n');
    const after = Array.from({ length: 2500 }, (_, i) => `depois ${i}`).join('\n');
    const diff = diffLines(before, after);
    expect(diff.approximate).toBe(true);
    expect(diff.removed).toBe(2500);
    expect(diff.added).toBe(2500);
  });

  it('edição localizada em texto longo é exata (prefixo e sufixo são descartados)', () => {
    const base = Array.from({ length: 5000 }, (_, i) => `linha ${i}`);
    const edited = [...base];
    edited[2500] = 'linha editada';
    const diff = diffLines(base.join('\n'), edited.join('\n'));
    expect(diff.approximate).toBe(false);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
  });
});

describe('diffWords', () => {
  it('preserva o texto original em ambos os lados', () => {
    const result = diffWords('um dois três', 'um quatro três');
    expect(result?.before.map((s) => s.text).join('')).toBe('um dois três');
    expect(result?.after.map((s) => s.text).join('')).toBe('um quatro três');
  });
});

describe('collapseUnchanged', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);

  it('mantém contexto ao redor da mudança e colapsa o resto', () => {
    const edited = [...lines];
    edited[10] = 'mudou';
    const items = collapseUnchanged(diffLines(lines.join('\n'), edited.join('\n')).lines, 2);
    const gaps = items.filter((item) => item.kind === 'gap');
    expect(gaps).toHaveLength(2);
    const shown = items.filter((item) => item.kind === 'line');
    // 2 de contexto antes + remove + add + 2 depois
    expect(shown).toHaveLength(6);
  });

  it('sem mudanças devolve todas as linhas', () => {
    const items = collapseUnchanged(diffLines('a\nb', 'a\nb').lines);
    expect(items.every((item) => item.kind === 'line')).toBe(true);
  });

  it('não esconde um trecho de uma única linha', () => {
    const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const edited = [...base];
    edited[0] = 'A';
    edited[5] = 'F';
    const items = collapseUnchanged(diffLines(base.join('\n'), edited.join('\n')).lines, 1);
    expect(items.some((item) => item.kind === 'gap' && item.hidden.length === 1)).toBe(false);
  });
});

describe('countWords', () => {
  it('conta palavras ignorando espaços extras', () => {
    expect(countWords('  um  dois\ntrês ')).toBe(3);
    expect(countWords('   ')).toBe(0);
  });
});
