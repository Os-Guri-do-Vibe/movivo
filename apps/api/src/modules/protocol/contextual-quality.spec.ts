import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  assessQualityReview,
  CONTEXTUAL_QUALITY_VERSION,
  QUALITY_CRITERIA,
  qualityCorrectionMessage,
  qualityFacts,
  qualityNotices,
  qualityReviewSchema,
  qualityUnavailable,
} from './contextual-quality';
import type { CatalogExercise } from './exercise-catalog';
import type { UserConstraints } from './user-constraints';

const catalog: CatalogExercise[] = [
  {
    id: 'core',
    name: 'Core sintético',
    pattern: 'CORE',
    muscleGroups: ['core'],
    equipment: [],
    locations: ['HOME'],
    levels: ['INICIANTE'],
    contraindicatedFor: ['LOWER_BACK'],
    substitutes: [],
  },
  {
    id: 'lower',
    name: 'Inferior sintético',
    pattern: 'ISOLATION',
    muscleGroups: ['glúteo'],
    equipment: [],
    locations: ['HOME'],
    levels: ['INICIANTE'],
    contraindicatedFor: [],
    substitutes: [],
  },
  {
    id: 'push',
    name: 'Empurrada sintética',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito', 'tríceps'],
    equipment: [],
    locations: ['HOME'],
    levels: ['INICIANTE'],
    contraindicatedFor: [],
    substitutes: [],
  },
];
const constraints: UserConstraints = {
  goal: 'LOSE_FAT',
  level: 'INICIANTE',
  trainingStatus: 'OCCASIONAL',
  daysPerWeek: 2,
  preferredDays: [],
  location: 'HOME',
  equipment: [],
  emphasis: ['core', 'glúteo'],
  avoid: [],
  injuryTags: [],
  injuriesRaw: [],
  requiresProfessionalReview: false,
  parqTags: [],
  parqTriggered: [],
};
function structure(ids: string[]): ProtocolStructure {
  return {
    promptVersion: 'teste',
    goal: 'LOSE_FAT',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 2,
    sessions: [
      {
        dayLabel: 'Sessão',
        focus: 'Core e corpo inteiro',
        exercises: ids.map((exerciseId) => ({
          exerciseId,
          name: exerciseId,
          sets: 3,
          reps: { min: 10, max: 12 },
          loadStrategy: 'BODYWEIGHT',
          restSeconds: 60,
        })),
      },
    ],
  };
}
function review(status: 'MET' | 'ADAPTED' | 'GAP' = 'MET') {
  return qualityReviewSchema.parse(
    Object.fromEntries(
      QUALITY_CRITERIA.map((criterion) => [
        criterion,
        {
          status,
          methodologyExcerpt: 'Individualize o programa.',
          observation: 'Achado sintético.',
          adjustment: status === 'GAP' ? 'Redistribua a seleção.' : null,
        },
      ]),
    ),
  );
}

describe('qualidade contextual — cobertura real e sem regras universais', () => {
  it('não aceita título prometendo core quando só seleciona glúteos', () => {
    const facts = qualityFacts(structure(['lower', 'lower']), constraints, catalog, catalog);
    expect(facts.emphasisCoverage).toEqual([
      { group: 'core', selectedSlots: 0, eligibleOptions: 1 },
      { group: 'glúteo', selectedSlots: 2, eligibleOptions: 1 },
    ]);
    expect(facts.patternDistribution).toContainEqual({
      pattern: 'ISOLATION',
      eligibleOptions: 1,
      selectedSlots: 2,
      sessionArraySets: 6,
    });
    expect(facts.patternDistribution).toContainEqual({
      pattern: 'HORIZONTAL_PUSH',
      eligibleOptions: 1,
      selectedSlots: 0,
      sessionArraySets: 0,
    });
    const result = assessQualityReview(review(), facts);
    expect(result.summary).toMatchObject({ status: 'GAPS', missingEmphasisCount: 1 });
    expect(result.summary.checks).toContainEqual({ criterion: 'PREFERENCES', status: 'GAP' });
    expect(qualityCorrectionMessage(result)).toContain('ênfase solicitada sem exercício');
  });

  it('sem opção elegível, preserva limitação para o profissional sem inventar substituto', () => {
    const lower = catalog[1];
    if (!lower) throw new Error('fixture sem exercício inferior');
    const facts = qualityFacts(structure(['lower']), constraints, catalog, [lower]);
    expect(facts.emphasisCoverage[0]?.eligibleOptions).toBe(0);
    const result = assessQualityReview(review('ADAPTED'), facts);
    expect(result.summary.status).toBe('GAPS');
    expect(qualityNotices(result.summary).join(' ')).toContain('limitações do catálogo');
  });

  it('cobertura usa padrão CORE, não grupo secundário em outro movimento', () => {
    const lower = catalog[1];
    if (!lower) throw new Error('fixture sem exercício inferior');
    const mixed = [{ ...lower, muscleGroups: ['core', 'glúteo'] }];
    const facts = qualityFacts(structure(['lower']), constraints, mixed, mixed);
    expect(facts.emphasisCoverage[0]?.selectedSlots).toBe(0);
  });

  it('não impõe agachamento ou hinge para todo perfil; adaptações justificadas são possíveis', () => {
    const facts = qualityFacts(structure(['core', 'lower']), constraints, catalog, catalog);
    const result = assessQualityReview(review('ADAPTED'), facts);
    expect(result.summary.status).toBe('PASS');
    expect(qualityNotices(result.summary)).toHaveLength(QUALITY_CRITERIA.length);
  });

  it('outras ênfases usam grupos reais e normalizam acentos, sem ler nome inventado', () => {
    const facts = qualityFacts(
      structure(['push', 'unknown']),
      { ...constraints, emphasis: ['PEITO', 'triceps'] },
      catalog,
      catalog,
    );
    expect(facts.emphasisCoverage.every((coverage) => coverage.selectedSlots === 1)).toBe(true);
    expect(facts.sessions[0]?.exercises[1]?.pattern).toBe('UNKNOWN');
    expect(assessQualityReview(review(), facts).summary.status).toBe('PASS');
  });

  it('sem ênfase declarada não inventa obrigação de focar uma região', () => {
    const result = assessQualityReview(
      review(),
      qualityFacts(structure(['push']), { ...constraints, emphasis: [] }, catalog, catalog),
    );
    expect(result.summary.status).toBe('PASS');
    expect(qualityNotices(result.summary)).toEqual([]);
  });

  it('lacuna metodológica do parecer segue para correção mesmo com todas as ênfases presentes', () => {
    const result = assessQualityReview(
      review('GAP'),
      qualityFacts(structure(['core', 'lower']), constraints, catalog, catalog),
    );
    expect(result.summary.status).toBe('GAPS');
    expect(qualityCorrectionMessage(result)).toContain('Redistribua a seleção');
    expect(qualityNotices(result.summary)[0]).toContain('metodologia vigente');
  });

  it('parecer parcial ou GAP sem ação não é uma avaliação válida', () => {
    expect(qualityReviewSchema.safeParse({}).success).toBe(false);
    const invalid = review('GAP');
    invalid.FEASIBILITY.adjustment = null;
    expect(qualityReviewSchema.safeParse(invalid).success).toBe(false);
  });

  it('não cria avisos em legado e não esconde diagnóstico inválido/indisponível', () => {
    expect(qualityNotices(undefined)).toEqual([]);
    expect(qualityNotices({ version: 'inválida' })[0]).toContain('não foi concluída');
    expect(qualityNotices(qualityUnavailable('LLM_UNAVAILABLE').summary)[0]).toContain(
      'profissional CREF',
    );
    expect(
      JSON.stringify(
        assessQualityReview(
          review(),
          qualityFacts(structure(['core', 'lower']), constraints, catalog, catalog),
        ).summary,
      ),
    ).not.toContain('Achado sintético');
    expect(qualityUnavailable('INVALID_REVIEW').summary.version).toBe(CONTEXTUAL_QUALITY_VERSION);
  });
});
