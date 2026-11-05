import { describe, expect, it } from 'vitest';

import { bodyIndicators } from './body';
import { nutritionRules } from './params';

const rules = nutritionRules({
  recomposition: {
    bodyFatThresholdPct: { FEMALE: { pct: 32 }, MALE: { pct: 22 } },
    waistToHeightThreshold: 0.55,
  },
});

describe('bodyIndicators — adiposidade', () => {
  it('gordura medida vale mais que a foto', () => {
    const result = bodyIndicators(
      { WEIGHT: { latest: 80 }, BODY_FAT_PERCENT: { latest: 12 } },
      178,
      'MALE',
      rules,
      { min: 28, max: 34 },
    );
    expect(result.adiposity).toBe('LOW');
    expect(result.adiposityBasis).toBe('MEASURED_BODY_FAT');
  });

  it('sem medida, a faixa estimada pela foto (ponto médio) classifica a adiposidade', () => {
    const high = bodyIndicators({ WEIGHT: { latest: 90 } }, 178, 'MALE', rules, {
      min: 24,
      max: 30,
    });
    expect(high.adiposity).toBe('HIGH');
    expect(high.adiposityBasis).toBe('PHOTO_ESTIMATE');
    const low = bodyIndicators({ WEIGHT: { latest: 70 } }, 178, 'MALE', rules, { min: 9, max: 13 });
    expect(low.adiposity).toBe('LOW');
  });

  it('sem medida nem foto, cintura/altura; sem nada, desconhecida', () => {
    const waist = bodyIndicators(
      { WEIGHT: { latest: 90 }, WAIST: { latest: 100 } },
      170,
      'MALE',
      rules,
      null,
    );
    expect(waist.adiposityBasis).toBe('WAIST_TO_HEIGHT');
    expect(waist.adiposity).toBe('HIGH');
    expect(bodyIndicators({}, null, 'MALE', rules, null)).toMatchObject({
      adiposity: 'UNKNOWN',
      adiposityBasis: null,
    });
  });
});
