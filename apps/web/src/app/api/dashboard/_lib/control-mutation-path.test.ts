import { describe, expect, it } from 'vitest';

import { isAllowedControlMutationPath, isAllowedControlPutPath } from './control-mutation-path';

const ID = '11111111-1111-4111-8111-111111111111';

describe('allowlist de mutações do Control Center', () => {
  it.each([
    'ai/knowledge/review',
    'ai/taco/import',
    `ai/knowledge/${ID}/retry`,
    `ai/knowledge/${ID}/archive`,
    `ai/knowledge/${ID}/delete`,
    // Fila de exceções: as quatro ações do profissional, sempre com UUID.
    `exceptions/${ID}/claim`,
    `exceptions/${ID}/approve`,
    `exceptions/${ID}/reject`,
    `exceptions/${ID}/resolve`,
    `exceptions/${ID}/request-adjustment`,
    'agents/profiles/HYROX/drafts',
    'agents/profiles/PERSONA_FEMALE/drafts',
    'agents/profiles/PERSONA_MALE/drafts',
    `methodology/documents/${ID}/test/cancel`,
    `agents/profiles/documents/${ID}/update`,
    `agents/profiles/documents/${ID}/test`,
    `agents/profiles/documents/${ID}/publish`,
    `agents/profiles/documents/${ID}/discard`,
    'ai/simulate',
    'ai/guardrails',
    'ai/exercise-catalog',
    'ai/exercise-catalog/retire',
    // Favoritos do RT: sem estas duas entradas o BFF devolvia 404 e a estrela nunca
    // gravava em produção (bug 2026-09-29).
    'ai/exercise-catalog/favorite',
    'ai/exercise-catalog/unfavorite',
    `conversations/${ID}/ai-attendance`,
    `conversations/${ID}/messages`,
    `conversations/${ID}/read`,
    'scripts/workout-daily-scan/run',
    'scripts/exercise-catalog-refresh/run',
  ])('autoriza somente a mutação conhecida %s', (path) => {
    expect(isAllowedControlMutationPath(path)).toBe(true);
  });

  it.each([
    'overview',
    'ai/knowledge/delete-all',
    'ai/knowledge/upload', // multipart: rota própria, nunca o proxy JSON
    'ai/knowledge/not-a-uuid/archive',
    `ai/knowledge/${ID}/content`,
    // Metodologia antiga (prosa) e persona saíram; o estúdio tem as suas rotas.
    'ai/methodology',
    `ai/methodology/${ID}/publish`,
    'ai/persona',
    `exceptions/${ID}`,
    `exceptions/${ID}/delete`,
    `exceptions/${ID}/approve/extra`,
    'agents/profiles/hyrox/drafts',
    'agents/profiles/PERSONA_OUTRA/drafts',
    'agents/profiles/HYROX_/drafts',
    'agents/profiles/documents/not-a-uuid/publish',
    `agents/profiles/documents/${ID}/delete`,
    `methodology/documents/${ID}/test/estimate`, // consulta (GET), nunca mutação
    `methodology/documents/${ID}/test/cancel/extra`,
    'exceptions/not-a-uuid/approve',
    // Parecidos com os de favorito, mas não listados: a allowlist é por igualdade exata.
    'ai/exercise-catalog/favorites',
    'ai/exercise-catalog/favorite/extra',
    'ai/exercise-catalog/unfavorite-all',
    'ai/exercise-catalog/Favorite',
    // Conversas: só as duas ações conhecidas, e só com UUID.
    'conversations',
    `conversations/${ID}`,
    `conversations/${ID}/photo`,
    `conversations/${ID}/messages/extra`,
    `conversations/${ID}/read/extra`,
    `conversations/${ID}/unread`,
    `conversations/${ID}/delete`,
    'conversations/not-a-uuid/messages',
    'ai/exercise-catalog/delete',
    // Scripts: só `<id>/run`, com id em minúsculas/hífen.
    'scripts',
    'scripts/run',
    'scripts//run',
    'scripts/workout-daily-scan',
    'scripts/workout-daily-scan/run/extra',
    'scripts/Workout/run',
    'scripts/../run',
    'scripts/a_b/run',
  ])('recusa o caminho não autorizado %s', (path) => {
    expect(isAllowedControlMutationPath(path)).toBe(false);
  });
});

describe('allowlist de PUT do Control Center', () => {
  it.each(['FAST', 'STANDARD', 'REASONING', 'VISION'])(
    'autoriza trocar as rotas do nível %s',
    (tier) => {
      expect(isAllowedControlPutPath(`agents/tiers/${tier}`)).toBe(true);
    },
  );

  it('autoriza editar o protocolo em revisão de um caso (só com UUID)', () => {
    expect(isAllowedControlPutPath(`exceptions/${ID}/protocol`)).toBe(true);
  });

  it.each([
    'agents/tiers',
    'agents/tiers/fast',
    'agents/tiers/TRANSCRIBE',
    'agents/tiers/FAST/extra',
    'agents/costs',
    'exceptions/abc/approve',
    'exceptions/not-a-uuid/protocol',
    `exceptions/${ID}/protocol/extra`,
    `exceptions/${ID}/approve`,
  ])('recusa o caminho %s', (path) => {
    expect(isAllowedControlPutPath(path)).toBe(false);
  });
});
