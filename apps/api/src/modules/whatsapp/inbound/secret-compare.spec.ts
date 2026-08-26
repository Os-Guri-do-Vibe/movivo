import { describe, expect, it } from 'vitest';

import { constantTimeEquals } from './secret-compare';

describe('constantTimeEquals', () => {
  it('tokens iguais → true', () => {
    expect(constantTimeEquals('token-abc', 'token-abc')).toBe(true);
  });

  it('tokens diferentes de mesmo tamanho → false', () => {
    expect(constantTimeEquals('token-abc', 'token-abd')).toBe(false);
  });

  it('tokens de tamanhos diferentes → false, sem lançar', () => {
    expect(constantTimeEquals('curto', 'um-token-bem-mais-longo-que-o-outro')).toBe(false);
  });

  it('undefined de qualquer lado → false (fail-closed)', () => {
    expect(constantTimeEquals(undefined, 'token-abc')).toBe(false);
    expect(constantTimeEquals('token-abc', undefined)).toBe(false);
    expect(constantTimeEquals(undefined, undefined)).toBe(false);
  });

  it('string vazia não é curinga', () => {
    expect(constantTimeEquals('', 'token-abc')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
