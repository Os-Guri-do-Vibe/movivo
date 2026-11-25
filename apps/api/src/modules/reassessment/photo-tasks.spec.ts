import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  photoComparisonValidators,
  type PhotoComparison,
  type PhotoComparisonInput,
} from './photo-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };
const input: PhotoComparisonInput = {
  order: [
    { angle: 'FRONT', when: 'START' },
    { angle: 'FRONT', when: 'NOW' },
  ],
  daysBetween: 84,
  biologicalSex: 'FEMALE',
};
const reading = (over: Partial<PhotoComparison> = {}): PhotoComparison => ({
  comparable: true,
  visibleChanges: ['Mais definição na região dos ombros e braços.'],
  bodyFatRange: { min: 24, max: 29 },
  confidence: 'LOW',
  observationsForProfessional: [],
  limitations: ['A luz das fotos de início e de agora é diferente.'],
  physique: {
    muscleGroups: [{ region: 'SHOULDERS', status: 'STRENGTH', note: 'Ombros bem definidos.' }],
    posture: [],
    symmetry: null,
    strengths: [],
    attentionPoints: [],
  },
  ...over,
});
const run = async (output: PhotoComparison) =>
  (await Promise.all(photoComparisonValidators.map((v) => v(input, output, ctx)))).flat();

describe('photoComparisonValidators', () => {
  it('aceita comparação com faixa ampla e limitação', async () => {
    expect(await run(reading())).toEqual([]);
  });

  it('a faixa de gordura tem margem de pelo menos 4 pontos', async () => {
    const narrow = await run(reading({ bodyFatRange: { min: 25, max: 26 } }));
    expect(narrow.map((v) => v.path)).toContain('bodyFatRange');
  });

  it('fotos que não dá para comparar não trazem mudanças nem faixa', async () => {
    const violations = await run(reading({ comparable: false }));
    expect(violations.map((v) => v.path)).toContain('comparable');
    // Sem comparação não há avaliação física: o conjunto todo fica vazio.
    const empty = {
      muscleGroups: [],
      posture: [],
      symmetry: null,
      strengths: [],
      attentionPoints: [],
    };
    expect(
      await run(
        reading({ comparable: false, visibleChanges: [], bodyFatRange: null, physique: empty }),
      ),
    ).toEqual([]);
    expect(
      (await run(reading({ comparable: false, visibleChanges: [], bodyFatRange: null }))).map(
        (v) => v.path,
      ),
    ).toContain('physique');
  });

  it('sem julgamento estético', async () => {
    const harsh = await run(
      reading({ visibleChanges: ['A região da barriga continua gorda demais.'] }),
    );
    expect(harsh.map((v) => v.path)).toContain('visibleChanges');
  });
});
