import { describe, expect, it } from 'vitest';

import { coachingActionTypeSchema, safetySignalKindSchema } from '../coaching/coaching.schema';
import {
  METHODOLOGY_DOMAIN_SPECS,
  methodologyDomainSchema,
  methodologyDomainSpec,
} from './domains';
import { domainParametersSchema, exampleParameters, plausibilityIssues } from './fields';

describe('documentos de metodologia', () => {
  it('existe exatamente um documento por domínio', () => {
    expect(METHODOLOGY_DOMAIN_SPECS.map((s) => s.domain).sort()).toEqual(
      [...methodologyDomainSchema.options].sort(),
    );
  });

  it.each(METHODOLOGY_DOMAIN_SPECS.map((spec) => [spec.domain, spec] as const))(
    '%s: os exemplos passam no schema e todo campo tem rótulo',
    (_domain, spec) => {
      const result = domainParametersSchema(spec).safeParse(exampleParameters(spec));
      expect(result.success, JSON.stringify(result.error?.issues?.slice(0, 3))).toBe(true);
      for (const section of spec.sections) {
        for (const field of Object.values(section.fields)) expect(field.label).toBeTruthy();
      }
    },
  );

  it('autonomia cobre todas as ações e segurança cobre todos os sinais', () => {
    const autonomy = methodologyDomainSpec('AUTONOMY').sections[0]?.fields.byAction;
    const safety = methodologyDomainSpec('SAFETY').sections[1]?.fields.bySignal;
    expect(autonomy?.kind === 'table' && autonomy.rows.map((r) => r.key).sort()).toEqual(
      [...coachingActionTypeSchema.options].sort(),
    );
    expect(safety?.kind === 'table' && safety.rows.map((r) => r.key).sort()).toEqual(
      [...safetySignalKindSchema.options].sort(),
    );
  });
});

describe('validação de parâmetros', () => {
  const spec = methodologyDomainSpec('STRENGTH');

  it('valor fora do limite duro é recusado', () => {
    const params = exampleParameters(spec);
    params.volume = { ...params.volume, maxSetsPerMusclePerSession: 99 };
    expect(domainParametersSchema(spec).safeParse(params).success).toBe(false);
  });

  it('valor fora da faixa plausível é aceito, mas aparece para justificativa', () => {
    const params = exampleParameters(spec);
    params.volume = {
      ...params.volume,
      weeklySets: {
        BEGINNER: { sets: { min: 10, max: 30 } },
        INTERMEDIATE: { sets: { min: 10, max: 16 } },
        ADVANCED: { sets: { min: 12, max: 20 } },
      },
    };
    expect(domainParametersSchema(spec).safeParse(params).success).toBe(true);
    expect(plausibilityIssues(spec, params)).toEqual([
      expect.objectContaining({ path: 'volume.weeklySets.BEGINNER.sets', plausible: [4, 25] }),
    ]);
  });
});
