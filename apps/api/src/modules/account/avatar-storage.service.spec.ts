/**
 * Unit — `AvatarStorageService`: grava/lê/apaga arquivo real num diretório temporário
 * (mesmo padrão de `resolve-file-secrets.spec.ts`) — é I/O de disco puro, sem sentido
 * mockar `fs`. O que se prova: nome de arquivo sempre um UUID novo (nunca o `userId`),
 * leitura/escrita recusa tipo não suportado, e `read`/`delete` são fail-closed contra
 * nome de arquivo fora do formato esperado (defesa contra path traversal).
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { AvatarStorageService } from './avatar-storage.service';

const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8V8AAAAASUVORK5CYII=',
  'base64',
);
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

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
    const filename = await service.save({
      buffer: JPEG,
      mimetype: 'image/jpeg',
      originalname: 'minha-foto.jpeg',
    });
    expect(statSync(join(dir, filename)).mode & 0o777).toBe(0o600);
    expect(filename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/);
  });

  it('mapeia a extensão pelo mimetype (png, webp)', async () => {
    const png = await service.save({ buffer: PNG, mimetype: 'image/png' });
    const webp = await service.save({ buffer: WEBP, mimetype: 'image/webp' });
    expect(png.endsWith('.png')).toBe(true);
    expect(webp.endsWith('.webp')).toBe(true);
  });

  it('recusa mimetype não suportado', async () => {
    await expect(
      service.save({ buffer: Buffer.from('x'), mimetype: 'application/pdf' }),
    ).rejects.toThrow(/não suportado/);
  });

  it('recusa extensão executável ou incompatível com o MIME', async () => {
    await expect(
      service.save({ buffer: PNG, mimetype: 'image/png', originalname: 'foto.php' }),
    ).rejects.toThrow(/Extensão/);
    await expect(
      service.save({ buffer: PNG, mimetype: 'image/png', originalname: 'foto.jpg' }),
    ).rejects.toThrow(/Extensão/);
  });

  it('lê de volta o conteúdo salvo com o mimetype correto', async () => {
    const filename = await service.save({ buffer: PNG, mimetype: 'image/png' });
    const read = await service.read(filename);
    expect(read?.mimetype).toBe('image/png');
    expect(read?.buffer).toEqual(PNG);
  });

  it('read devolve null para nome fora do formato UUID (path traversal)', async () => {
    await expect(service.read('../../etc/passwd')).resolves.toBeNull();
    await expect(service.read('nao-e-um-uuid.jpg')).resolves.toBeNull();
  });

  it('read devolve null quando o arquivo não existe', async () => {
    await expect(service.read('11111111-1111-4111-8111-111111111111.jpg')).resolves.toBeNull();
  });

  it('delete apaga o arquivo salvo e é no-op para nome inválido', async () => {
    const filename = await service.save({ buffer: JPEG, mimetype: 'image/jpeg' });
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

describe('AvatarStorageService — validação de bytes antes de persistir', () => {
  it.each([
    { buffer: Buffer.from('<svg onload="alert(1)"></svg>'), mimetype: 'image/png' },
    { buffer: PNG, mimetype: 'image/jpeg' },
    { buffer: JPEG, mimetype: 'image/webp' },
    { buffer: Buffer.from('RIFF0000WEBPVP8 '), mimetype: 'image/webp' },
    { buffer: PNG.subarray(0, 7), mimetype: 'image/png' },
    { buffer: PNG.subarray(0, 24), mimetype: 'image/png' },
    { buffer: JPEG.subarray(0, -2), mimetype: 'image/jpeg' },
    { buffer: Buffer.alloc(0), mimetype: 'image/png' },
    { buffer: Buffer.from('html'), mimetype: 'constructor' },
  ])('recusa formato falso ou truncado sem gravar arquivo: $mimetype', async (file) => {
    const before = readdirSync(dir);
    await expect(makeService().save(file)).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(before);
  });

  it('recusa acima do teto pelos bytes reais mesmo em chamada direta ao storage', async () => {
    const before = readdirSync(dir);
    await expect(
      makeService(PNG.length - 1).save({ buffer: PNG, mimetype: 'image/png' }),
    ).rejects.toThrow(/tamanho máximo/);
    expect(readdirSync(dir)).toEqual(before);
  });

  it('rejeita conteúdo inválido antes mesmo de criar o diretório', async () => {
    const missing = join(dir, 'never-created');
    const service = new AvatarStorageService({
      avatarStorage: { uploadDir: missing, uploadMaxBytes: 1024 },
    } as never);
    await expect(
      service.save({ buffer: Buffer.from('html'), mimetype: 'image/png' }),
    ).rejects.toThrow();
    expect(existsSync(missing)).toBe(false);
  });
});
