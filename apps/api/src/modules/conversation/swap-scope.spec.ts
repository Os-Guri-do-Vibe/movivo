import { describe, expect, it } from 'vitest';

import { declinesSwap, swapScopeOf } from './swap-scope';

describe('alcance da troca de exercício', () => {
  it.each([
    ['só hoje', 'NEXT_SESSION'],
    ['Só no próximo treino, por favor', 'NEXT_SESSION'],
    ['somente hoje', 'NEXT_SESSION'],
    ['só dessa vez', 'NEXT_SESSION'],
    ['quero no protocolo', 'PLAN'],
    ['pode trocar pra sempre', 'PLAN'],
    ['no meu plano todo', 'PLAN'],
    ['daqui pra frente', 'PLAN'],
    ['só para o treino de hoje', 'NEXT_SESSION'],
    ['atualiza o meu protocolo', 'PLAN'],
  ] as const)('"%s" → %s', (text, expected) => {
    expect(swapScopeOf(text)).toBe(expected);
  });

  it('respostas curtas só valem quando respondem à pergunta de alcance', () => {
    expect(swapScopeOf('hoje')).toBeNull();
    expect(swapScopeOf('hoje', true)).toBe('NEXT_SESSION');
    expect(swapScopeOf('protocolo', true)).toBe('PLAN');
    expect(swapScopeOf('sempre', true)).toBe('PLAN');
    expect(swapScopeOf('2', true)).toBe('PLAN');
  });

  it('mensagem ambígua ou de outro assunto não decide o alcance', () => {
    expect(swapScopeOf('só hoje ou no protocolo?', true)).toBeNull();
    expect(swapScopeOf('quanto de proteína eu devo comer?', true)).toBeNull();
    expect(swapScopeOf('oi')).toBeNull();
  });

  it('reconhece quando o aluno desiste', () => {
    expect(declinesSwap('não, deixa')).toBe(true);
    expect(declinesSwap('Melhor não')).toBe(true);
    expect(declinesSwap('só hoje')).toBe(false);
  });
});
