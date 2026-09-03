/**
 * Unit — `AccountService`: leitura/edição da própria conta interna (tela "Minha
 * Conta"). Banco, senha e storage de avatar são mockados; o foco é RLS por `runAsUser`
 * (nunca `runAsSystem` — isto é autoatendimento, não gestão de terceiro), e-mail
 * permanecer intocável, e o mapeamento de conflito de telefone (Postgres 23505) para
 * `ConflictException`.
 */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from './account.service';

/** Chain builder thenable que imita o query builder do Drizzle e resolve para `result`. */
function q<T>(result: T) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set']) {
    b[m] = () => b;
  }
  b.then = (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return b as never;
}

/** Mesma forma, mas rejeita — simula erro de constraint do Postgres. */
function qReject(error: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set']) {
    b[m] = () => b;
  }
  b.then = (_resolve: unknown, reject: (e: unknown) => unknown) =>
    Promise.reject(error).catch(reject);
  return b as never;
}

let tx: { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
let db: { runAsUser: ReturnType<typeof vi.fn>; runAsSystem: ReturnType<typeof vi.fn> };
let config: { avatarUrl: ReturnType<typeof vi.fn> };
let passwords: { verify: ReturnType<typeof vi.fn>; hash: ReturnType<typeof vi.fn> };
let avatarStorage: { save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
let service: AccountService;

const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
const USER_ID = '11111111-1111-4111-8111-111111111111';

const PROFILE_ROW = {
  name: 'Ana Souza',
  email: 'ana@movivo.app',
  phoneNumber: '+5511999999999',
  avatarPath: 'abc.jpg',
};

beforeEach(() => {
  tx = { select: vi.fn(), update: vi.fn() };
  db = {
    runAsUser: vi.fn(async (_u: string, _r: string, cb: (t: unknown) => unknown) => cb(tx)),
    runAsSystem: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  config = {
    avatarUrl: vi.fn((path: string | null) => (path ? `https://api.test/${path}` : null)),
  };
  passwords = { verify: vi.fn(), hash: vi.fn() };
  avatarStorage = { save: vi.fn(), delete: vi.fn(async () => undefined) };
  service = new AccountService(
    logger as never,
    db as never,
    config as never,
    passwords as never,
    avatarStorage as never,
  );
});

describe('getProfile', () => {
  it('devolve o perfil com a URL de avatar montada pela config', async () => {
    tx.select.mockReturnValueOnce(q([PROFILE_ROW]));

    const profile = await service.getProfile(USER_ID, 'ADMIN');

    expect(profile).toEqual({
      name: 'Ana Souza',
      email: 'ana@movivo.app',
      phoneNumber: '+5511999999999',
      avatarUrl: 'https://api.test/abc.jpg',
      role: 'ADMIN',
    });
    expect(db.runAsUser).toHaveBeenCalledWith(USER_ID, 'ADMIN', expect.any(Function));
  });

  it('lança UnauthorizedException quando a conta não existe', async () => {
    tx.select.mockReturnValueOnce(q([]));
    await expect(service.getProfile(USER_ID, 'ADMIN')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('updateProfile', () => {
  it('atualiza só os campos enviados e nunca toca em e-mail', async () => {
    tx.update.mockReturnValueOnce(q(undefined));
    tx.select.mockReturnValueOnce(q([PROFILE_ROW]));

    await service.updateProfile(USER_ID, 'ADMIN', { name: 'Novo Nome' });

    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('propaga conflito de telefone duplicado como ConflictException (erro cru)', async () => {
    tx.update.mockReturnValueOnce(qReject({ code: '23505' }));

    await expect(
      service.updateProfile(USER_ID, 'ADMIN', { phoneNumber: '+5511988887777' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('propaga conflito de telefone duplicado como ConflictException (DrizzleQueryError embrulhado)', async () => {
    // Drizzle 0.45.2 embrulha o erro do driver: o código real vira `error.cause.code`,
    // não `error.code` — ver o comentário de `isUniqueViolation`.
    tx.update.mockReturnValueOnce(qReject({ message: 'Failed query', cause: { code: '23505' } }));

    await expect(
      service.updateProfile(USER_ID, 'ADMIN', { phoneNumber: '+5511988887777' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('relança erro que não é violação de unicidade', async () => {
    const boom = new Error('boom');
    tx.update.mockReturnValueOnce(qReject(boom));

    await expect(service.updateProfile(USER_ID, 'ADMIN', { name: 'X' })).rejects.toBe(boom);
  });
});

describe('changePassword', () => {
  it('verifica a senha atual, faz o hash da nova e atualiza', async () => {
    tx.select.mockReturnValueOnce(q([{ passwordHash: 'hash-atual' }]));
    passwords.verify.mockResolvedValueOnce(true);
    passwords.hash.mockResolvedValueOnce('hash-novo');
    tx.update.mockReturnValueOnce(q(undefined));

    await service.changePassword(USER_ID, 'ADMIN', {
      currentPassword: 'senha-atual',
      newPassword: 'senha-nova-123',
    });

    expect(passwords.verify).toHaveBeenCalledWith('hash-atual', 'senha-atual');
    expect(passwords.hash).toHaveBeenCalledWith('senha-nova-123');
  });

  it('lança UnauthorizedException quando a senha atual está incorreta', async () => {
    tx.select.mockReturnValueOnce(q([{ passwordHash: 'hash-atual' }]));
    passwords.verify.mockResolvedValueOnce(false);

    await expect(
      service.changePassword(USER_ID, 'ADMIN', {
        currentPassword: 'errada',
        newPassword: 'senha-nova-123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('updateAvatar', () => {
  it('salva o novo arquivo, atualiza a conta e apaga o avatar antigo', async () => {
    tx.select.mockReturnValueOnce(q([{ avatarPath: 'antigo.jpg' }]));
    avatarStorage.save.mockResolvedValueOnce('novo.jpg');
    tx.update.mockReturnValueOnce(q(undefined));
    tx.select.mockReturnValueOnce(q([{ ...PROFILE_ROW, avatarPath: 'novo.jpg' }]));

    const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg' };
    const profile = await service.updateAvatar(USER_ID, 'ADMIN', file);

    expect(avatarStorage.save).toHaveBeenCalledWith(file);
    expect(avatarStorage.delete).toHaveBeenCalledWith('antigo.jpg');
    expect(profile.avatarUrl).toBe('https://api.test/novo.jpg');
  });

  it('não tenta apagar avatar antigo quando a conta não tinha um', async () => {
    tx.select.mockReturnValueOnce(q([{ avatarPath: null }]));
    avatarStorage.save.mockResolvedValueOnce('novo.jpg');
    tx.update.mockReturnValueOnce(q(undefined));
    tx.select.mockReturnValueOnce(q([PROFILE_ROW]));

    await service.updateAvatar(USER_ID, 'ADMIN', {
      buffer: Buffer.from('x'),
      mimetype: 'image/jpeg',
    });

    expect(avatarStorage.delete).not.toHaveBeenCalled();
  });
});
