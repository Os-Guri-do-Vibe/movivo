import { describe, expect, it } from 'vitest';

import {
  MAX_NEW_PER_CALL,
  MAX_PER_KIND,
  normalizeMemory,
  planMemoryWrites,
  type ActiveMemory,
  type MemoryItem,
} from './student-memory';

const item = (text: string, over: Partial<MemoryItem> = {}): MemoryItem => ({
  kind: 'ROUTINE',
  text,
  importance: 2,
  origin: 'CONVERSATION',
  ...over,
});
const active = (id: string, text: string, over: Partial<ActiveMemory> = {}): ActiveMemory => ({
  id,
  kind: 'ROUTINE',
  text,
  importance: 2,
  ...over,
});

describe('planMemoryWrites', () => {
  it('fato repetido não duplica e pode subir a importância', () => {
    const plan = planMemoryWrites(
      [active('a', 'Treina de manhã, antes do trabalho.')],
      [item('treina de manha antes do trabalho', { importance: 3 })],
    );
    expect(plan.insert).toEqual([]);
    expect(plan.bump).toEqual([{ id: 'a', importance: 3 }]);
  });

  it('fato novo entra; texto curto demais e repetido na chamada são ignorados', () => {
    const plan = planMemoryWrites(
      [],
      [item('Viaja a trabalho toda terça.'), item('viaja a trabalho toda terca'), item('ok')],
    );
    expect(plan.insert.map((i) => i.text)).toEqual(['Viaja a trabalho toda terça.']);
  });

  it('limita quantos fatos novos entram de uma vez', () => {
    const many = Array.from({ length: 8 }, (_, i) => item(`Fato número ${i} sobre a rotina dele`));
    expect(planMemoryWrites([], many).insert).toHaveLength(MAX_NEW_PER_CALL);
  });

  it('só retira ids que são da lista do próprio aluno', () => {
    const plan = planMemoryWrites(
      [active('a', 'Fato antigo da rotina')],
      [],
      ['a', 'de-outro-aluno'],
    );
    expect(plan.retire).toEqual(['a']);
  });

  it('no teto por tipo, sai o menos importante e mais antigo', () => {
    const current = Array.from({ length: MAX_PER_KIND }, (_, i) =>
      active(`m${i}`, `Rotina ${i} do aluno`, { importance: i === MAX_PER_KIND - 1 ? 1 : 2 }),
    );
    const plan = planMemoryWrites(current, [item('Passou a treinar à noite agora')]);
    expect(plan.retire).toEqual([`m${MAX_PER_KIND - 1}`]);
    expect(plan.insert).toHaveLength(1);
  });
});

describe('normalizeMemory', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalizeMemory('  Treina, de MANHÃ! ')).toBe('treina de manha');
  });
});
