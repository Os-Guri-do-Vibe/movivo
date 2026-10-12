import { describe, expect, it } from 'vitest';

import { buildResponseCorrection, CORRECTION_HEADER } from './response-correction';

describe('buildResponseCorrection', () => {
  it('promessa de prazo: instrui a não prometer retorno, sem ecoar o texto barrado', () => {
    const correction = buildResponseCorrection([{ rule: 'HANDOFF_SLA_PROMISE' }]);
    expect(correction).toContain(CORRECTION_HEADER);
    expect(correction).toContain('Não prometa prazo');
  });

  it('exercício fora da lista: repete a lista autorizada, pelo nome exato', () => {
    const correction = buildResponseCorrection(
      [{ rule: 'EXERCISE_NOT_ALLOWED' }],
      ['Remada Cavalinho', 'Remada Baixa'],
    );
    expect(correction).toContain('Remada Cavalinho; Remada Baixa');
  });

  it('exercício fora da lista, sem lista: proíbe citar exercício', () => {
    const correction = buildResponseCorrection([{ rule: 'EXERCISE_NOT_ALLOWED' }], []);
    expect(correction).toContain('Não cite nenhum exercício');
  });

  it('várias regras viram várias instruções, sem repetir a mesma regra', () => {
    const correction = buildResponseCorrection([
      { rule: 'DIAGNOSIS' },
      { rule: 'PROMISE' },
      { rule: 'DIAGNOSIS' },
    ]);
    expect(correction?.match(/diagnóstico/g)).toHaveLength(1);
    expect(correction).toContain('garantido');
  });

  it.each(['PROMPT_LEAK', 'INJECTION_ECHO', 'REGRA_DESCONHECIDA'])(
    '%s não ganha segunda tentativa (nem misturada a regras corrigíveis)',
    (rule) => {
      expect(buildResponseCorrection([{ rule }])).toBeNull();
      expect(buildResponseCorrection([{ rule: 'PROMISE' }, { rule }])).toBeNull();
    },
  );

  it('sem violações não há o que corrigir', () => {
    expect(buildResponseCorrection([])).toBeNull();
  });
});
