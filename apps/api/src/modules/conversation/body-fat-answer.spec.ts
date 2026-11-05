import { describe, expect, it } from 'vitest';

import { bodyFatClaimViolations } from './tasks';

const state = {
  bodyComposition: {
    bodyFatRangePercent: { min: 20, max: 25 },
    previousBodyFatRangePercent: { min: 23, max: 28 },
  },
};

describe('percentual de gordura nas respostas do chat', () => {
  it('aceita a faixa da estimativa do aluno, em qualquer forma de escrever', () => {
    expect(
      bodyFatClaimViolations(
        'Pela análise das suas fotos, sua gordura corporal está estimada entre 20 e 25%. É uma estimativa.',
        state,
      ),
    ).toEqual([]);
    expect(
      bodyFatClaimViolations(
        'Você está com algo entre 20% e 25% de gordura, com margem de erro.',
        state,
      ),
    ).toEqual([]);
    expect(
      bodyFatClaimViolations('Antes era 23 a 28% de gordura e agora 20 a 25%.', state),
    ).toEqual([]);
  });

  it('recusa percentual que não é o da estimativa', () => {
    const found = bodyFatClaimViolations('Você tem uns 15% de gordura corporal.', state);
    expect(found[0]?.message).toContain('fora da estimativa');
  });

  it('sem avaliação por foto, não cita percentual', () => {
    const found = bodyFatClaimViolations('Você deve ter uns 18% de gordura.', {
      bodyComposition: null,
    });
    expect(found[0]?.message).toContain('não há avaliação');
    expect(
      bodyFatClaimViolations('Ainda não tenho uma avaliação por foto sua.', {
        bodyComposition: null,
      }),
    ).toEqual([]);
  });

  it('número perto de outra coisa (proteína, calorias) não conta', () => {
    expect(
      bodyFatClaimViolations('Mantenha 140 g de proteína e 70 g de gordura boa por dia.', state),
    ).toEqual([]);
  });
});
