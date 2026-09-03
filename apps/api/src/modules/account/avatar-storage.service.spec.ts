/**
 * Unit — `AvatarStorageService`: grava/lê/apaga arquivo real num diretório temporário
 * (mesmo padrão de `resolve-file-secrets.spec.ts`) — é I/O de disco puro, sem sentido
 * mockar `fs`. O que se prova: nome de arquivo sempre um UUID novo (nunca o `userId`),
 * leitura/escrita recusa tipo não suportado, e `read`/`delete` são fail-closed contra
 * nome de arquivo fora do formato esperado (defesa contra path traversal).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AvatarStorageService } from './avatar-storage.service';

const dir = mkdtempSync(join(tmpdir(), 'movivo-avatars-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeService(uploadMaxBytes = 2 * 1024 * 1024): AvatarStorageService {
  const config = {
    avatarStorage: { uploadDir: dir, uploadMaxBytes },
  };
  return new AvatarStorageService(config as never);
}

describe('AvatarStorageService', () => {
  let service: AvatarStorageService;

  beforeEach(() => {
    service = makeService();
  });

  it('salva com um nome UUID novo, nunca reaproveitando o nome original', async () => {
    const filename = await service.save({ buffer: Buffer.from('foto'), mimetype: 'image/jpeg' });
    expect(filename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
  });

  it('mapeia a extensão pelo mimetype (png, webp)', async () => {
    const png = await service.save({ buffer: Buffer.from('x'), mimetype: 'image/png' });
    const webp = await service.save({ buffer: Buffer.from('x'), mimetype: 'image/webp' });
    expect(png.endsWith('.png')).toBe(true);
    expect(webp.endsWith('.webp')).toBe(true);
  });

  it('recusa mimetype não suportado', async () => {
    await expect(
      service.save({ buffer: Buffer.from('x'), mimetype: 'application/pdf' }),
    ).rejects.toThrow(/não suportado/);
  });

  it('lê de volta o conteúdo salvo com o mimetype correto', async () => {
    const filename = await service.save({ buffer: Buffer.from('conteúdo'), mimetype: 'image/png' });
    const read = await service.read(filename);
    expect(read?.mimetype).toBe('image/png');
    expect(read?.buffer.toString()).toBe('conteúdo');
  });

  it('read devolve null para nome fora do formato UUID (path traversal)', async () => {
    await expect(service.read('../../etc/passwd')).resolves.toBeNull();
    await expect(service.read('nao-e-um-uuid.jpg')).resolves.toBeNull();
  });

  it('read devolve null quando o arquivo não existe', async () => {
    await expect(service.read('11111111-1111-4111-8111-111111111111.jpg')).resolves.toBeNull();
  });

  it('delete apaga o arquivo salvo e é no-op para nome inválido', async () => {
    const filename = await service.save({ buffer: Buffer.from('x'), mimetype: 'image/jpeg' });
    await expect(service.read(filename)).resolves.not.toBeNull();

    await service.delete(filename);
    await expect(service.read(filename)).resolves.toBeNull();

    await expect(service.delete('../../etc/passwd')).resolves.toBeUndefined();
  });

  it('expõe os tipos permitidos e o teto configurado de upload', () => {
    const service2 = makeService(999);
    expect(service2.allowedMimeTypes).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(service2.maxUploadBytes).toBe(999);
  });
});
