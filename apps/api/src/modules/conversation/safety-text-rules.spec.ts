import { describe, expect, it } from 'vitest';

import { textSignals } from './safety-text-rules';

const kinds = (text: string) => textSignals(text).map((s) => s.kind);

describe('regras de texto da sentinela (red-team)', () => {
  it.each([
    ['senti uma dor no peito forte durante a corrida', 'CHEST_PAIN'],
    ['to com aperto no peito desde ontem', 'CHEST_PAIN'],
    ['meu coração tá doendo quando subo escada', 'CHEST_PAIN'],
    ['quase desmaiei depois do treino', 'FAINTING_OR_DIZZINESS'],
    ['minha vista escureceu e tive que sentar', 'FAINTING_OR_DIZZINESS'],
    ['fiquei com falta de ar no meio da série', 'SHORTNESS_OF_BREATH'],
    ['não consigo respirar direito', 'SHORTNESS_OF_BREATH'],
    ['a dor no joelho é insuportável', 'SEVERE_PAIN'],
    ['é uma dor de 9 no ombro', 'SEVERE_PAIN'],
    ['torci o tornozelo e senti um estalo', 'NEW_INJURY'],
    ['descobri que estou grávida', 'PREGNANCY'],
    ['fiz uma cirurgia no joelho semana passada', 'RECENT_SURGERY'],
    ['comecei um remédio novo pra pressão', 'MEDICATION_CHANGE'],
    ['depois de comer eu provoco vômito', 'EATING_DISORDER_SIGNS'],
    ['passo o dia sem comer pra emagrecer', 'EATING_DISORDER_SIGNS'],
    ['às vezes penso em me matar', 'MENTAL_DISTRESS'],
    ['não vejo mais saída', 'MENTAL_DISTRESS'],
  ])('"%s" → %s', (text, expected) => {
    expect(kinds(text)).toContain(expected);
  });

  it.each([
    'hoje só tenho 20 minutos pra treinar',
    'não tenho barra em casa, troca o agachamento?',
    'estou cansado mas vou treinar',
    'o peito do pé tá um pouco cansado',
    'treino de peito hoje foi ótimo',
    'quanta proteína devo comer?',
    'essa semana só posso terça e quinta',
    'minha dor muscular de ontem já passou',
    'tomei café e almocei arroz com feijão',
  ])('"%s" não aciona nada', (text) => {
    expect(kinds(text)).toEqual([]);
  });

  it('devolve só o trecho que casou, um sinal por tipo', () => {
    const [signal] = textSignals('Senti dor no peito. Depois dor no peito de novo.');
    expect(signal?.evidence.length).toBeLessThanOrEqual(120);
    expect(
      textSignals('dor no peito, dor no peito').filter((s) => s.kind === 'CHEST_PAIN'),
    ).toHaveLength(1);
  });
});
