import { describe, expect, it } from 'vitest';

import { mapInjuriesToTags } from './user-constraints';

describe('mapInjuriesToTags', () => {
  it('mapeia lesão em texto livre para a tag correta', () => {
    expect(mapInjuriesToTags(['dor no ombro direito'])).toContain('SHOULDER');
    expect(mapInjuriesToTags(['lesão no joelho'])).toContain('KNEE');
    expect(mapInjuriesToTags(['hérnia de disco lombar'])).toContain('LOWER_BACK');
  });

  it('reconhece variações com e sem acento', () => {
    expect(mapInjuriesToTags(['problema no coracao'])).toContain('CARDIAC');
    expect(mapInjuriesToTags(['pressão alta'])).toContain('CARDIAC');
  });

  it('deduplica tags quando várias lesões apontam para a mesma', () => {
    const tags = mapInjuriesToTags(['dor no ombro', 'manguito rotador']);
    expect(tags.filter((t) => t === 'SHOULDER')).toHaveLength(1);
  });

  it('ignora texto sem palavra-chave conhecida (fica visível no texto livre)', () => {
    expect(mapInjuriesToTags(['algo genérico'])).toEqual([]);
  });

  it('retorna vazio para lista vazia', () => {
    expect(mapInjuriesToTags([])).toEqual([]);
  });
});
