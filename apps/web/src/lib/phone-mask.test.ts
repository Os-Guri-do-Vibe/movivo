import { describe, expect, it } from 'vitest';

import { maskBrazilianPhone, toE164BrazilianPhone } from './phone-mask';

describe('maskBrazilianPhone', () => {
  it('formata progressivamente enquanto o usuário digita um celular (9 dígitos)', () => {
    expect(maskBrazilianPhone('1')).toBe('(1');
    expect(maskBrazilianPhone('11')).toBe('(11');
    expect(maskBrazilianPhone('119')).toBe('(11) 9');
    expect(maskBrazilianPhone('11999')).toBe('(11) 999');
    expect(maskBrazilianPhone('119999999')).toBe('(11) 9999-999');
    expect(maskBrazilianPhone('1199999999')).toBe('(11) 9999-9999');
    expect(maskBrazilianPhone('11999999999')).toBe('(11) 99999-9999');
  });

  it('formata um fixo (8 dígitos) corretamente', () => {
    expect(maskBrazilianPhone('1133334444')).toBe('(11) 3333-4444');
  });

  it('converte E.164 vindo da API para o formato mascarado', () => {
    expect(maskBrazilianPhone('+5511999999999')).toBe('(11) 99999-9999');
    expect(maskBrazilianPhone('+551133334444')).toBe('(11) 3333-4444');
  });

  it('não corta um DDD legítimo 55 (Rio Grande do Sul) quando não há prefixo de país', () => {
    expect(maskBrazilianPhone('55999999999')).toBe('(55) 99999-9999');
  });

  it('ignora dígitos além do 11º', () => {
    expect(maskBrazilianPhone('11999999999999')).toBe('(11) 99999-9999');
  });

  it('devolve vazio para entrada vazia', () => {
    expect(maskBrazilianPhone('')).toBe('');
  });
});

describe('toE164BrazilianPhone', () => {
  it('converte o valor mascarado de volta para E.164', () => {
    expect(toE164BrazilianPhone('(11) 99999-9999')).toBe('+5511999999999');
    expect(toE164BrazilianPhone('(11) 3333-4444')).toBe('+551133334444');
  });

  it('lida com valor parcialmente digitado', () => {
    expect(toE164BrazilianPhone('(11) 9')).toBe('+55119');
  });
});
