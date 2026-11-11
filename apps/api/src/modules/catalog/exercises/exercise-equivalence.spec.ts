import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_ID, EXERCISE_CATALOG } from './exercise-catalog';
import { rankEquivalents } from './exercise-equivalence';

const target = EXERCISE_BY_ID.get('agachamento_barra');
const constraints = {
  level: 'INTERMEDIARIO' as const,
  location: 'FULL_GYM' as const,
  equipment: [],
  injuryTags: [],
};
const none = { disliked: new Set<string>(), liked: new Set<string>() };

describe('equivalentes de exercício', () => {
  it('só oferece o mesmo padrão de movimento, curados primeiro', () => {
    if (!target) throw new Error('catálogo sem agachamento_barra');
    const ranked = rankEquivalents(target, constraints, EXERCISE_CATALOG, none);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((e) => e.pattern === 'SQUAT')).toBe(true);
    expect(target.substitutes).toContain(ranked[0]?.id);
  });

  it('nunca oferece o que o aluno rejeitou e prioriza o que ele gosta', () => {
    if (!target) throw new Error('catálogo sem agachamento_barra');
    const all = rankEquivalents(target, constraints, EXERCISE_CATALOG, none);
    const disliked = all[0]?.id as string;
    const liked = all.at(-1)?.id as string;
    const ranked = rankEquivalents(target, constraints, EXERCISE_CATALOG, {
      disliked: new Set([disliked]),
      liked: new Set([liked]),
    });
    expect(ranked.map((e) => e.id)).not.toContain(disliked);
    expect(ranked[0]?.id).toBe(liked);
  });

  it('respeita contraindicações registradas', () => {
    if (!target) throw new Error('catálogo sem agachamento_barra');
    const ranked = rankEquivalents(
      target,
      { ...constraints, injuryTags: ['KNEE'] },
      EXERCISE_CATALOG,
      none,
    );
    expect(ranked.every((e) => !e.contraindicatedFor.includes('KNEE'))).toBe(true);
  });
});
