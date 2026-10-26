/**
 * `ConversationMediaStorage` — guarda áudio e imagem das conversas do WhatsApp (aba "Conversas").
 *
 * A mídia do aluno é tão sensível quanto o texto (uma foto pode mostrar o corpo, um áudio
 * relata dor ou lesão), então NADA vai em claro para o disco: o arquivo é o envelope do
 * `HealthCipherService` (Vault Transit em produção). O nome é um UUID gerado aqui — nunca o
 * id do titular nem o da mensagem — e só esse formato é aceito na leitura (sem path traversal).
 * A autorização de quem lê vive no `ConversationsService`, sob a RLS do ator.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AppConfigService } from '../config';
import { HealthCipherService } from './health-cipher.service';

/** Teto do arquivo guardado — a EvolutionAPI já limita a resposta a 12 MB de base64. */
export const CONVERSATION_MEDIA_MAX_BYTES = 8 * 1024 * 1024;

const FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/;

/** Formatos que o painel sabe tocar/exibir. O tipo é decidido AQUI, nunca pelo cliente. */
const ALLOWED_MIME = /^(?:image\/(?:jpeg|png|webp)|audio\/(?:ogg|mpeg|mp4|aac|amr|webm|x-m4a))$/;

/** `audio/ogg; codecs=opus` → `audio/ogg`. */
export function baseMime(mimetype: string): string {
  return (mimetype.split(';')[0] ?? '').trim().toLowerCase();
}

export function isAllowedConversationMime(mimetype: string): boolean {
  return ALLOWED_MIME.test(baseMime(mimetype));
}

@Injectable()
export class ConversationMediaStorage {
  constructor(
    private readonly config: AppConfigService,
    private readonly cipher: HealthCipherService,
  ) {}

  private dir(): string {
    return resolve(this.config.conversationMediaDir);
  }

  /** Cifra e grava. Devolve o nome do arquivo (guardar em `conversations.media_path`). */
  async save(bytes: Buffer): Promise<string> {
    if (bytes.length === 0 || bytes.length > CONVERSATION_MEDIA_MAX_BYTES) {
      throw new Error('Mídia vazia ou acima do limite.');
    }
    const sealed = await this.cipher.encryptBytes(bytes);
    await mkdir(this.dir(), { recursive: true, mode: 0o700 });
    await chmod(this.dir(), 0o700);
    const filename = `${randomUUID()}.bin`;
    await writeFile(join(this.dir(), filename), sealed, { flag: 'wx', mode: 0o600 });
    return filename;
  }

  /** Decifra o arquivo, ou `null` se o nome é inválido ou o arquivo não existe/não abre. */
  async read(filename: string): Promise<Buffer | null> {
    if (!FILENAME_RE.test(filename)) return null;
    try {
      return await this.cipher.decryptBytes(await readFile(join(this.dir(), filename)));
    } catch {
      return null;
    }
  }

  async delete(filename: string): Promise<void> {
    if (!FILENAME_RE.test(filename)) return;
    await rm(join(this.dir(), filename), { force: true });
  }
}
