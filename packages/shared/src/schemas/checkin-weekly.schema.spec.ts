import { describe, expect, it } from 'vitest';
import { checkinWeeklyChangeSchema, checkinWeeklySubmitSchema } from './checkin-weekly.schema';

const valid = {
  sleepQuality: 'BOA',
  mood: 'FELIZ',
  nutritionScore: 5,
  adherenceScore: 8,
  durationFit: 'ADEQUADA',
};

describe('check-in — limites de entrada', () => {
  it('aceita todas as escolhas disponíveis e continua exigindo explicação de OUTRAS', () => {
    expect(
      checkinWeeklySubmitSchema.safeParse({
        ...valid,
        changesNoticed: checkinWeeklyChangeSchema.options,
        changesOther: 'Mais disposição',
      }).success,
    ).toBe(true);
    expect(
      checkinWeeklySubmitSchema.safeParse({ ...valid, changesNoticed: ['OUTRAS'] }).success,
    ).toBe(false);
  });

  it('recusa lista maior que as escolhas possíveis', () => {
    expect(
      checkinWeeklySubmitSchema.safeParse({ ...valid, changesNoticed: Array(1000).fill('FORCA') })
        .success,
    ).toBe(false);
  });
});
