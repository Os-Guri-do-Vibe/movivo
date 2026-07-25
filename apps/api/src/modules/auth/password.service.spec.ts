/**
 * Unit — `PasswordService` (US-1.4): hashing Argon2id e verificação.
 */
import { describe, expect, it } from 'vitest';

import { PasswordService } from './password.service';

const service = new PasswordService();

describe('PasswordService', () => {
  it('hash gera um encoded Argon2id e verify confirma a senha correta', async () => {
    const hash = await service.hash('senha-forte-123');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await service.verify(hash, 'senha-forte-123')).toBe(true);
  });

  it('verify recusa senha errada', async () => {
    const hash = await service.hash('senha-forte-123');
    expect(await service.verify(hash, 'senha-errada')).toBe(false);
  });

  it('verify com hash nulo retorna false (conta inexistente) sem lançar', async () => {
    expect(await service.verify(null, 'qualquer')).toBe(false);
  });

  it('verify com hash malformado retorna false sem lançar', async () => {
    expect(await service.verify('nao-e-um-hash', 'qualquer')).toBe(false);
  });
});
