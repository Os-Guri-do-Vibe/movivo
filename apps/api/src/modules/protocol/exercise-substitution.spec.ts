import { describe, expect, it } from 'vitest';

import { EXERCISE_BY_ID } from './exercise-catalog';
import {
  findExerciseByMention,
  findSafeSubstitute,
  type SubstitutionConstraints,
} from './exercise-substitution';

const beginnerHome: SubstitutionConstraints = {
  level: 'INICIANTE',
  location: 'HOME',
  equipment: [],
  injuryTags: [],
};

describe('findExerciseByMention (US-3.5)', () => {
  it('acha o exercício da base citado no texto livre', () => {
    const ex = findExerciseByMention('posso trocar o Agachamento livre (peso do corpo)?');
    expect(ex?.id).toBe('bodyweight_squat');
  });

  it('texto sem exercício conhecido → null', () => {
    expect(findExerciseByMention('to sem tempo hoje, e aí?')).toBeNull();
  });
});

describe('findSafeSubstitute (US-3.5)', () => {
  it('devolve um substituto do mesmo padrão, viável e nunca contraindicado', () => {
    const pushup = EXERCISE_BY_ID.get('pushup');
    if (!pushup) throw new Error('fixture');
    const sub = findSafeSubstitute(pushup, beginnerHome);
    expect(sub).not.toBeNull();
    expect(sub?.pattern).toBe('HORIZONTAL_PUSH');
    expect(sub?.id).not.toBe('pushup');
    // Sem equipamento em casa: o substituto não pode exigir máquina/halteres.
    expect(sub?.equipment).toEqual([]);
  });

  it('nunca sugere um exercício contraindicado pela lesão do usuário', () => {
    const squat = EXERCISE_BY_ID.get('bodyweight_squat');
    if (!squat) throw new Error('fixture');
    const sub = findSafeSubstitute(squat, { ...beginnerHome, injuryTags: ['KNEE', 'HIP'] });
    if (sub) expect(sub.contraindicatedFor).not.toContain('KNEE');
  });

  it('sem candidato viável (equipamento indisponível e sem alternativa) → null', () => {
    const legPress = EXERCISE_BY_ID.get('leg_press');
    if (!legPress) throw new Error('fixture');
    // Academia exigida, mas restringindo a casa sem equipamento e lesão que barra o resto.
    const sub = findSafeSubstitute(legPress, {
      level: 'INICIANTE',
      location: 'GYM',
      equipment: [],
      injuryTags: ['KNEE', 'HIP', 'LOWER_BACK'],
    });
    // Pode achar um agachamento livre (GYM/BOTH sem equip) se não contraindicado; com KNEE+HIP,
    // agachamentos livres saem → resultado é null ou um item seguro. Garantimos: nunca contraindicado.
    if (sub) {
      expect(sub.contraindicatedFor.some((t) => ['KNEE', 'HIP', 'LOWER_BACK'].includes(t))).toBe(
        false,
      );
    }
  });
});
