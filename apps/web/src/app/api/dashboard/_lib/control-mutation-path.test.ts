import { describe, expect, it } from 'vitest';

import { isAllowedControlMutationPath } from './control-mutation-path';

const ID = '11111111-1111-4111-8111-111111111111';

describe('allowlist de mutações do Control Center', () => {
  it.each([
    'ai/knowledge/upload',
    'ai/knowledge/review',
    `ai/knowledge/${ID}/retry`,
    `ai/knowledge/${ID}/archive`,
    'ai/methodology',
    `ai/methodology/${ID}/submit`,
    `ai/methodology/${ID}/review`,
    `ai/methodology/${ID}/publish`,
    `ai/methodology/${ID}/rollback`,
    'ai/guardrails',
    'ai/exercise-catalog',
    'ai/exercise-catalog/retire',
    // Favoritos do RT: sem estas duas entradas o BFF devolvia 404 e a estrela nunca
    // gravava em produção (bug 2026-09-29).
    'ai/exercise-catalog/favorite',
    'ai/exercise-catalog/unfavorite',
  ])('autoriza somente a mutação conhecida %s', (path) => {
    expect(isAllowedControlMutationPath(path)).toBe(true);
  });

  it.each([
    'overview',
    'ai/knowledge/delete-all',
    'ai/knowledge/not-a-uuid/archive',
    `ai/knowledge/${ID}/content`,
    `ai/methodology/${ID}/delete`,
    `ai/methodology/${ID}/review/extra`,
    // Parecidos com os de favorito, mas não listados: a allowlist é por igualdade exata.
    'ai/exercise-catalog/favorites',
    'ai/exercise-catalog/favorite/extra',
    'ai/exercise-catalog/unfavorite-all',
    'ai/exercise-catalog/Favorite',
    'ai/exercise-catalog/delete',
  ])('recusa o caminho não autorizado %s', (path) => {
    expect(isAllowedControlMutationPath(path)).toBe(false);
  });
});
