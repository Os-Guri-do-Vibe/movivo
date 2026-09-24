import { describe, expect, it } from 'vitest';

import type { AppConfigService } from '../../core/config';
import { CheckoutTokenService } from './checkout-token.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function service(): CheckoutTokenService {
  return new CheckoutTokenService({
    pgcryptoKey: 'test-key-with-enough-entropy',
  } as AppConfigService);
}

describe('CheckoutTokenService', () => {
  it('emite token opaco, validável e com expiração', () => {
    const now = new Date('2026-09-23T12:00:00.000Z');
    const issued = service().issue(USER_ID, now);
    expect(issued.token).not.toContain(USER_ID);
    expect(service().verify(issued.token, now)?.userId).toBe(USER_ID);
    expect(service().verify(issued.token, new Date(issued.expiresAt.getTime() + 1))).toBeNull();
  });

  it('rejeita adulteração sem vazar erro criptográfico', () => {
    const token = service().issue(USER_ID).token;
    // Muda um caractere com bits integralmente significativos. O último caractere de base64url
    // pode carregar padding implícito e, em alguns comprimentos, outra letra decodifica igual.
    const index = Math.floor(token.length / 2);
    const tampered = `${token.slice(0, index)}${token[index] === 'A' ? 'B' : 'A'}${token.slice(index + 1)}`;
    expect(service().verify(tampered)).toBeNull();
    expect(service().verify('não-é-token')).toBeNull();
  });

  it('rejeita payload autenticado cujo titular não é um UUID', () => {
    const token = service().issue('titular-inválido').token;
    expect(service().verify(token)).toBeNull();
  });

  it('regeneração produz outro token para o mesmo titular', () => {
    const tokens = new Set([service().issue(USER_ID).token, service().issue(USER_ID).token]);
    expect(tokens.size).toBe(2);
  });
});
