/**
 * Unit — `AccountController`: validação Zod do corpo, checagem de tipo/tamanho do
 * upload de avatar antes de tocar o storage e a leitura autenticada.
 */
import { BadRequestException } from '@nestjs/common';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountController } from './account.controller';

let account: {
  getProfile: ReturnType<typeof vi.fn>;
  updateProfile: ReturnType<typeof vi.fn>;
  changePassword: ReturnType<typeof vi.fn>;
  updateAvatar: ReturnType<typeof vi.fn>;
};
let avatarStorage: {
  allowedMimeTypes: string[];
  maxUploadBytes: number;
  read: ReturnType<typeof vi.fn>;
};
let controller: AccountController;

const REQ = { ip: '203.0.113.7', get: () => 'vitest' };
const USER = { userId: 'u1', role: 'ADMIN' as const, jti: 'j1' };

beforeEach(() => {
  account = {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(async () => undefined),
    updateAvatar: vi.fn(),
  };
  avatarStorage = {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxUploadBytes: 2 * 1024 * 1024,
    read: vi.fn(),
  };
  controller = new AccountController(account as never, avatarStorage as never);
});

describe('GET /account/profile', () => {
  it('delega ao service com o usuário autenticado', () => {
    controller.getProfile(USER);
    expect(account.getProfile).toHaveBeenCalledWith('u1', 'ADMIN');
  });
});

describe('PATCH /account/profile', () => {
  it('valida o corpo e delega ao service', () => {
    controller.updateProfile(USER, { name: 'Novo Nome' });
    expect(account.updateProfile).toHaveBeenCalledWith('u1', 'ADMIN', { name: 'Novo Nome' });
  });

  it('recusa corpo vazio (Zod exige ao menos um campo)', () => {
    expect(() => controller.updateProfile(USER, {})).toThrow();
  });

  it('recusa telefone fora do formato E.164', () => {
    expect(() => controller.updateProfile(USER, { phoneNumber: '11999999999' })).toThrow();
  });

  it.each([
    ['role', { name: 'Ana', role: 'ADMIN' }],
    ['email (imutável)', { name: 'Ana', email: 'outro@movivo.test' }],
    ['avatarPath', { name: 'Ana', avatarPath: '../../etc/passwd' }],
    ['passwordHash', { name: 'Ana', passwordHash: 'x' }],
    ['id', { name: 'Ana', id: '00000000-0000-0000-0000-000000000000' }],
  ])('rejeita (400) mass assignment de %s, sem tocar o service', (_label, body) => {
    expect(() => controller.updateProfile(USER, body)).toThrow(ZodError);
    expect(account.updateProfile).not.toHaveBeenCalled();
  });
});

describe('POST /account/password', () => {
  it('valida o corpo e delega ao service', async () => {
    await controller.changePassword(
      USER,
      { currentPassword: 'atual', newPassword: 'senha-nova-123' },
      REQ as never,
    );
    expect(account.changePassword).toHaveBeenCalledWith(
      'u1',
      'ADMIN',
      { currentPassword: 'atual', newPassword: 'senha-nova-123' },
      { ip: '203.0.113.7', userAgent: 'vitest' },
    );
  });

  it('rejeita (400) campo fora do contrato na troca de senha', async () => {
    await expect(
      controller.changePassword(
        USER,
        { currentPassword: 'atual', newPassword: 'senha-nova-123', role: 'ADMIN' },
        REQ as never,
      ),
    ).rejects.toBeInstanceOf(ZodError);
    expect(account.changePassword).not.toHaveBeenCalled();
  });

  it('recusa senha nova curta (piso de 12 caracteres)', async () => {
    await expect(
      controller.changePassword(
        USER,
        { currentPassword: 'atual', newPassword: 'curta' },
        REQ as never,
      ),
    ).rejects.toThrow();
  });
});

describe('POST /account/avatar', () => {
  it('recusa quando nenhum arquivo é enviado', async () => {
    await expect(controller.uploadAvatar(USER, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('recusa mimetype não suportado antes de chamar o service', async () => {
    const file = { mimetype: 'application/pdf', size: 100, buffer: Buffer.from('x') };
    await expect(controller.uploadAvatar(USER, file as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(account.updateAvatar).not.toHaveBeenCalled();
  });

  it('recusa arquivo acima do teto configurado antes de chamar o service', async () => {
    const file = { mimetype: 'image/png', size: 999_999_999, buffer: Buffer.from('x') };
    await expect(controller.uploadAvatar(USER, file as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(account.updateAvatar).not.toHaveBeenCalled();
  });

  it('delega ao service quando o arquivo é válido', async () => {
    const file = {
      originalname: 'foto.png',
      mimetype: 'image/png',
      size: 100,
      buffer: Buffer.from('foto'),
    };
    await controller.uploadAvatar(USER, file as never);
    expect(account.updateAvatar).toHaveBeenCalledWith('u1', 'ADMIN', {
      buffer: file.buffer,
      mimetype: 'image/png',
      originalname: 'foto.png',
    });
  });
});

describe('GET /account/avatar/:filename', () => {
  it('devolve 404 quando o arquivo não existe/nome é inválido', async () => {
    avatarStorage.read.mockResolvedValueOnce(null);
    const res = {
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
      setHeader: vi.fn(),
      send: vi.fn(),
    };

    await controller.serveAvatar('qualquer.jpg', res as never);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  it('serve o arquivo com content-type e cache privado', async () => {
    avatarStorage.read.mockResolvedValueOnce({
      buffer: Buffer.from('foto'),
      mimetype: 'image/png',
    });
    const res = {
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
      setHeader: vi.fn(),
      send: vi.fn(),
    };

    await controller.serveAvatar('11111111-1111-4111-8111-111111111111.png', res as never);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('foto'));
  });
});
