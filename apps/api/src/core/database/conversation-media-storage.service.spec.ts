import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../config';
import {
  baseMime,
  CONVERSATION_MEDIA_MAX_BYTES,
  ConversationMediaStorage,
  isAllowedConversationMime,
} from './conversation-media-storage.service';
import type { HealthCipherService } from './health-cipher.service';

describe('ConversationMediaStorage', () => {
  let dir: string;
  let storage: ConversationMediaStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conv-media-'));
    const cipher = {
      encryptBytes: vi.fn(async (v: Buffer) => Buffer.from(`sealed:${v.toString('base64')}`)),
      decryptBytes: vi.fn(async (v: Buffer) =>
        Buffer.from(v.toString().replace('sealed:', ''), 'base64'),
      ),
    } as unknown as HealthCipherService;
    storage = new ConversationMediaStorage(
      { conversationMediaDir: dir } as unknown as AppConfigService,
      cipher,
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('grava só o envelope cifrado (nunca o conteúdo em claro) e devolve o original ao ler', async () => {
    const original = Buffer.from('conteúdo-sensível-do-aluno');
    const name = await storage.save(original);
    expect(name).toMatch(/^[0-9a-f-]{36}\.bin$/);
    expect((await readFile(join(dir, name))).includes(original)).toBe(false);
    await expect(storage.read(name)).resolves.toEqual(original);
  });

  it('recusa mídia vazia ou acima do teto', async () => {
    await expect(storage.save(Buffer.alloc(0))).rejects.toThrow();
    await expect(storage.save(Buffer.alloc(CONVERSATION_MEDIA_MAX_BYTES + 1))).rejects.toThrow();
  });

  it('leitura só aceita o formato de nome gerado aqui (sem path traversal)', async () => {
    await expect(storage.read('../../etc/passwd')).resolves.toBeNull();
    await expect(storage.read('nao-e-uuid.bin')).resolves.toBeNull();
    await expect(storage.read('11111111-1111-4111-8111-111111111111.bin')).resolves.toBeNull();
  });

  it('delete remove o arquivo e ignora nome inválido', async () => {
    const name = await storage.save(Buffer.from('x'));
    await storage.delete(name);
    await storage.delete('../x');
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('tipos de mídia aceitos', () => {
  it('normaliza o mimetype e aceita só áudio/imagem tocáveis', () => {
    expect(baseMime('Audio/OGG; codecs=opus')).toBe('audio/ogg');
    for (const ok of ['image/jpeg', 'image/png', 'image/webp', 'audio/ogg; codecs=opus']) {
      expect(isAllowedConversationMime(ok)).toBe(true);
    }
    for (const no of ['image/svg+xml', 'text/html', 'application/pdf', 'video/mp4', '']) {
      expect(isAllowedConversationMime(no)).toBe(false);
    }
  });
});
