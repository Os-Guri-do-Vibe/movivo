import { describe, expect, it } from 'vitest';

import {
  emphasisToMuscleGroups,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
} from './user-constraints';

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

describe('anamnese v2 → UserConstraints (US-6.9)', () => {
  it('experiência declarada vira nível real — fim do default INICIANTE', () => {
    expect(levelFromExperience('BEGINNER')).toBe('INICIANTE');
    expect(levelFromExperience('INTERMEDIATE')).toBe('INTERMEDIARIO');
    expect(levelFromExperience('ADVANCED')).toBe('AVANCADO');
  });

  it('ênfase vira grupo muscular do catálogo; "corpo todo" não prioriza nada', () => {
    expect(emphasisToMuscleGroups(['BACK', 'GLUTES'])).toEqual(['costas', 'glúteo']);
    expect(emphasisToMuscleGroups(['FULL_BODY'])).toEqual([]);
    expect(emphasisToMuscleGroups([])).toEqual([]);
  });

  it('dor da seção 4 vira contraindicação estruturada, sem passar por heurística de texto', () => {
    const { tags, raw } = painToConstraints({
      hasPain: true,
      trend: 'WORSENING',
      points: [
        { region: 'KNEE', intensity: 8 },
        { region: 'UPPER_BACK', intensity: 3 },
      ],
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    });
    expect(tags).toContain('KNEE');
    // A região torácica cai na mesma tag de coluna — o catálogo não separa as duas.
    expect(tags).toContain('LOWER_BACK');
    expect(raw.join(' ')).toContain('intensidade 8/10');
  });

  it('"outra região" e a recomendação profissional passam pela heurística de texto', () => {
    const { tags } = painToConstraints({
      hasPain: true,
      trend: 'STABLE',
      points: [{ region: 'OTHER', intensity: 5, regionOther: 'dor no ombro ao levantar' }],
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: true,
      avoidanceRecommendation: 'evitar carga na coluna',
    });
    expect(tags).toContain('SHOULDER');
    expect(tags).toContain('LOWER_BACK');
  });

  it('sem dor, nenhuma contraindicação e nenhum texto de saúde é derivado', () => {
    expect(
      painToConstraints({
        hasPain: false,
        points: [],
        hasProfessionalExplanation: false,
        underMedicalFollowUp: false,
        hasAvoidanceRecommendation: false,
      }),
    ).toEqual({ tags: [], raw: [] });
    expect(painToConstraints(null)).toEqual({ tags: [], raw: [] });
  });
});
