import { describe, expect, it } from 'vitest';

import { trainingLocationSchema } from './anamnesis.schema';
import { catalogExerciseCandidateSchema } from './exercise-catalog.schema';

describe('locais do catálogo de exercícios', () => {
  const schema = catalogExerciseCandidateSchema.shape.locations;

  it('aceita todos os locais distintos disponíveis', () => {
    expect(schema.parse(trainingLocationSchema.options)).toEqual(trainingLocationSchema.options);
  });

  it('aceita apenas um local disponível', () => {
    expect(schema.safeParse(['HOME']).success).toBe(true);
  });

  it.each([[], ['HOME', 'HOME'], Array(100).fill('HOME'), ['INEXISTENTE']])(
    'rejeita coleção vazia, duplicada, acima do limite ou fora do enum: %s',
    (locations) => {
      expect(schema.safeParse(locations).success).toBe(false);
    },
  );
});
