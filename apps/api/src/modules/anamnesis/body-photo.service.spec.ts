import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { BodyPhotoService, detectPhotoFormat, MAX_PHOTO_BYTES } from './body-photo.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

describe('detectPhotoFormat', () => {
  it('reconhece JPEG, PNG e WebP pelos primeiros bytes', () => {
    expect(detectPhotoFormat(JPEG)).toBe('jpeg');
    expect(detectPhotoFormat(PNG)).toBe('png');
    expect(detectPhotoFormat(WEBP)).toBe('webp');
  });

  it('não confia em nada além da assinatura do arquivo', () => {
    expect(detectPhotoFormat(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectPhotoFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectPhotoFormat(Buffer.from('RIFF0000WAVEfmt '))).toBeNull();
    expect(detectPhotoFormat(Buffer.alloc(0))).toBeNull();
  });
});

function makeService(
  options: { session?: boolean; health?: boolean; photos?: boolean; userId?: string | null } = {},
) {
  const { session = true, health = true, photos = true, userId = null } = options;
  const inserted: unknown[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(session ? [{ id: 'sess-1', userId }] : []),
          then: (resolve: (rows: unknown[]) => unknown) => resolve([{ angle: 'FRONT' }]),
        }),
      }),
    }),
    insert: () => ({
      values: (value: unknown) => {
        inserted.push(value);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  const db = {
    runAsSystem: (cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)),
    runAsTokenScoped: (_id: string, cb: (t: typeof tx) => unknown) => Promise.resolve(cb(tx)),
  };
  const cipher = { encryptHealth: vi.fn(() => Promise.resolve(Buffer.from('cifrado'))) };
  const consents = {
    hasValidSessionConsent: vi.fn((_id: string, type: string) =>
      Promise.resolve(type === 'HEALTH_DATA' ? health : photos),
    ),
  };
  const healthConsent = { hasActiveForUser: vi.fn(() => Promise.resolve(false)) };
  const service = new BodyPhotoService(
    db as never,
    cipher as never,
    consents as never,
    healthConsent as never,
  );
  return { service, cipher, inserted, healthConsent };
}

describe('BodyPhotoService.put', () => {
  it('cifra a imagem (em base64) e grava a posição', async () => {
    const { service, cipher, inserted } = makeService();
    await expect(service.put('tok', 'FRONT', JPEG)).resolves.toEqual({ angle: 'FRONT' });
    expect(cipher.encryptHealth).toHaveBeenCalledWith(JPEG.toString('base64'));
    expect(inserted[0]).toMatchObject({
      anamnesisSessionId: 'sess-1',
      angle: 'FRONT',
      format: 'jpeg',
      sizeBytes: JPEG.length,
      content: Buffer.from('cifrado'),
    });
  });

  it('recusa vazio, grande demais e formato desconhecido antes de tocar no banco', async () => {
    const { service, cipher } = makeService();
    await expect(service.put('tok', 'FRONT', Buffer.alloc(0))).rejects.toThrow(/Envie uma imagem/);
    await expect(
      service.put('tok', 'FRONT', Buffer.alloc(MAX_PHOTO_BYTES + 1, 0xff)),
    ).rejects.toThrow(/5 MB/);
    await expect(service.put('tok', 'FRONT', Buffer.from('%PDF-1.7'))).rejects.toThrow(
      /JPG, PNG ou WebP/,
    );
    expect(cipher.encryptHealth).not.toHaveBeenCalled();
  });

  it('sessão inexistente ou vencida não aceita foto', async () => {
    const { service } = makeService({ session: false });
    await expect(service.put('tok', 'BACK', PNG)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem o consentimento próprio das fotos, ou sem o de saúde, não grava', async () => {
    const noPhotos = makeService({ photos: false });
    await expect(noPhotos.service.put('tok', 'LEFT', WEBP)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(noPhotos.cipher.encryptHealth).not.toHaveBeenCalled();
    const noHealth = makeService({ health: false });
    await expect(noHealth.service.put('tok', 'LEFT', WEBP)).rejects.toThrow(/Autorize/);
  });

  it('aluno que já existe vale pelo consentimento de saúde vigente do titular', async () => {
    const { service, healthConsent } = makeService({ health: false, userId: 'user-1' });
    healthConsent.hasActiveForUser.mockResolvedValue(true);
    await expect(service.put('tok', 'RIGHT', PNG)).resolves.toEqual({ angle: 'RIGHT' });
  });
});

describe('BodyPhotoService.remove e anglesOf', () => {
  it('apaga a posição e lista só as posições que têm foto', async () => {
    const { service } = makeService();
    await expect(service.remove('tok', 'BACK')).resolves.toEqual({ angle: 'BACK' });
    await expect(service.anglesOf('sess-1')).resolves.toEqual(['FRONT']);
  });
});
