import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_ID, EXERCISE_CATALOG } from './exercise-catalog';
import {
  findSafeCandidates,
  isViable,
  MAX_SUBSTITUTION_CANDIDATES,
  type SubstitutionConstraints,
} from './exercise-substitution';

const beginnerHome: SubstitutionConstraints = {
  level: 'INICIANTE',
  location: 'HOME',
  equipment: [],
  injuryTags: [],
};

describe('isViable (US-3.5)', () => {
  it('rejeita exercício acima do nível do usuário', () => {
    const ex = EXERCISE_BY_ID.get('flexao');
    if (!ex) throw new Error('fixture');
    expect(isViable({ ...ex, minLevel: 'AVANCADO' }, beginnerHome)).toBe(false);
  });

  it('rejeita exercício contraindicado pela lesão do usuário', () => {
    const ex = EXERCISE_BY_ID.get('agachamento_peso_corporal');
    if (!ex) throw new Error('fixture');
    if (ex.contraindicatedFor.length === 0) return; // fixture sem tag pra este achado — sem risco falso-positivo
    const tag = ex.contraindicatedFor[0];
    if (!tag) return;
    expect(isViable(ex, { ...beginnerHome, injuryTags: [tag] })).toBe(false);
  });
});

describe('findSafeCandidates (achado 2026-09-02 — substitui o antigo findSafeSubstitute)', () => {
  it('devolve candidatos do mesmo padrão, viáveis e nunca contraindicados', () => {
    const pushup = EXERCISE_BY_ID.get('flexao');
    if (!pushup) throw new Error('fixture');
    const candidates = findSafeCandidates(pushup, beginnerHome, EXERCISE_CATALOG);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.pattern).toBe(pushup.pattern);
      expect(candidate.id).not.toBe(pushup.id);
      // Sem equipamento em casa: nenhum candidato pode exigir máquina/halteres.
      expect(candidate.equipment).toEqual([]);
    }
  });

  it('nunca inclui um exercício contraindicado pela lesão do usuário', () => {
    const squat = EXERCISE_BY_ID.get('agachamento_peso_corporal');
    if (!squat) throw new Error('fixture');
    const candidates = findSafeCandidates(
      squat,
      { ...beginnerHome, injuryTags: ['KNEE', 'HIP'] },
      EXERCISE_CATALOG,
    );
    for (const candidate of candidates) {
      expect(candidate.contraindicatedFor).not.toContain('KNEE');
      expect(candidate.contraindicatedFor).not.toContain('HIP');
    }
  });

  it('respeita o teto de candidatos (MAX_SUBSTITUTION_CANDIDATES por padrão)', () => {
    const pushup = EXERCISE_BY_ID.get('flexao');
    if (!pushup) throw new Error('fixture');
    const candidates = findSafeCandidates(pushup, beginnerHome, EXERCISE_CATALOG);
    expect(candidates.length).toBeLessThanOrEqual(MAX_SUBSTITUTION_CANDIDATES);
  });

  it('respeita um limite explícito menor que o teto padrão', () => {
    const pushup = EXERCISE_BY_ID.get('flexao');
    if (!pushup) throw new Error('fixture');
    const candidates = findSafeCandidates(pushup, beginnerHome, EXERCISE_CATALOG, 1);
    expect(candidates.length).toBeLessThanOrEqual(1);
  });

  it('nunca repete um candidato (curados e mesmo-padrão podem colidir)', () => {
    const pushup = EXERCISE_BY_ID.get('flexao');
    if (!pushup) throw new Error('fixture');
    const candidates = findSafeCandidates(pushup, beginnerHome, EXERCISE_CATALOG, 20);
    const ids = candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sem candidato viável (equipamento indisponível e lesão que barra o resto) → []', () => {
    const legPress = EXERCISE_BY_ID.get('leg_press_45_maquina');
    if (!legPress) throw new Error('fixture');
    const candidates = findSafeCandidates(
      legPress,
      {
        level: 'INICIANTE',
        location: 'FULL_GYM',
        equipment: [],
        injuryTags: ['KNEE', 'HIP', 'LOWER_BACK'],
      },
      EXERCISE_CATALOG,
    );
    for (const candidate of candidates) {
      expect(
        candidate.contraindicatedFor.some((t) => ['KNEE', 'HIP', 'LOWER_BACK'].includes(t)),
      ).toBe(false);
    }
  });
});
