import { describe, expect, it } from 'vitest';

import type { CatalogExercise } from './exercise-catalog';
import { ExerciseCatalogProvider } from './exercise-catalog-provider.service';
import { catalogSearchTerms, searchCatalog } from './exercise-catalog-search';

const catalog = new ExerciseCatalogProvider().getAll();
const names = (found: readonly CatalogExercise[]) => found.map((exercise) => exercise.name);

describe('searchCatalog — autocomplete do editor de protocolo', () => {
  it('"abdominal prancha" encontra Prancha mesmo sem existir "Abdominal Prancha" (caso real 2026-10-15)', () => {
    const found = names(searchCatalog(catalog, 'abdominal prancha', 50));
    expect(found).toContain('Prancha');
    expect(found.some((name) => name.startsWith('Abdominal'))).toBe(true);
    expect(found).not.toContain('Abdominal Prancha');
  });

  it('prioriza quem casa mais termos', () => {
    // "Prancha Lateral" casa os dois termos; "Prancha" e "Elevação Lateral..." só um.
    const found = names(searchCatalog(catalog, 'prancha lateral', 10));
    expect(found[0]).toBe('Prancha Lateral');
    expect(found).toContain('Prancha');
  });

  it('ignora maiúsculas e acentos, nos dois sentidos', () => {
    const reference = names(searchCatalog(catalog, 'elevacao pelvica', 10));
    expect(reference.length).toBeGreaterThan(0);
    expect(names(searchCatalog(catalog, 'ELEVAÇÃO PÉLVICA', 10))).toEqual(reference);
    expect(names(searchCatalog(catalog, 'Elevação pélvica', 10))).toEqual(reference);
  });

  it('casa por parte da palavra e preserva a grafia oficial', () => {
    const found = names(searchCatalog(catalog, 'panturr', 10));
    expect(found).toContain('Panturrilha em Pé (Máquina)');
  });

  it('palavra de ligação não conta como termo ("na" casaria "máquina")', () => {
    expect(catalogSearchTerms('Abdominal na Prancha')).toEqual(['abdominal', 'prancha']);
    expect(names(searchCatalog(catalog, 'abdominal na prancha', 50))).toEqual(
      names(searchCatalog(catalog, 'abdominal prancha', 50)),
    );
  });

  it('sem correspondência devolve lista vazia; consulta só de ligação também', () => {
    expect(searchCatalog(catalog, 'xyzkwq', 10)).toEqual([]);
    expect(searchCatalog(catalog, 'de na com', 10)).toEqual([]);
  });

  it('respeita o limite pedido e o teto', () => {
    expect(searchCatalog(catalog, 'a b c abdominal', 3)).toHaveLength(3);
    expect(searchCatalog(catalog, 'abdominal', 999).length).toBeLessThanOrEqual(50);
  });

  it('nunca altera o catálogo', () => {
    const before = JSON.stringify(catalog);
    searchCatalog(catalog, 'abdominal prancha', 50);
    expect(JSON.stringify(catalog)).toBe(before);
  });
});
