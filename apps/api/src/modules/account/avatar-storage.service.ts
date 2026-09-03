/**
 * `AvatarStorageService` — grava/lê/apaga fotos de perfil no disco persistente da VPS.
 *
 * Decisão de infra do MVP (2026-09-02, decisão do fundador): sem S3/R2 ainda — a
 * arquitetura de referência do MVP é uma única VPS (`ARQUITETURA.md` — "Infra MVP"),
 * sem object storage decidido. O nome do arquivo salvo é um UUID gerado aqui, nunca o
 * `userId`: evita expor o identificador do titular numa URL pública e funciona como
 * token de acesso opaco — por isso a rota de leitura (`AccountController.serveAvatar`)
 * não exige guard, e a defesa contra path traversal é o regex estrito do nome.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AppConfigService } from '../../core/config';

export interface UploadedAvatarFile {
  readonly buffer: Buffer;
  readonly mimetype: string;
}

export interface StoredAvatarFile {
  readonly buffer: Buffer;
  readonly mimetype: string;
}

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Teto absoluto lido pelo `FileInterceptor` do multer, que precisa do número na
 * decoração da rota (antes da DI resolver `AppConfigService`). É só a rede de
 * segurança contra abuso grosseiro de memória — o limite de verdade, configurável via
 * `AVATAR_UPLOAD_MAX_BYTES`, é checado explicitamente no controller contra `file.size`.
 * Mantido igual ao teto do schema (`env.schema.ts`) para nunca divergir por engano.
 */
export const AVATAR_UPLOAD_HARD_CEILING_BYTES = 5 * 1024 * 1024;

/** UUID v4 minúsculo + extensão conhecida — único formato de nome aceito, dos dois lados. */
const AVATAR_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

@Injectable()
export class AvatarStorageService {
  constructor(private readonly config: AppConfigService) {}

  get allowedMimeTypes(): readonly string[] {
    return Object.keys(EXTENSION_BY_MIME);
  }

  get maxUploadBytes(): number {
    return this.config.avatarStorage.uploadMaxBytes;
  }

  private dir(): string {
    return resolve(this.config.avatarStorage.uploadDir);
  }

  private path(filename: string): string {
    return join(this.dir(), filename);
  }

  /** Grava o arquivo com um nome novo (UUID) e devolve o nome salvo. */
  async save(file: UploadedAvatarFile): Promise<string> {
    const extension = EXTENSION_BY_MIME[file.mimetype];
    if (!extension) {
      throw new Error(
        `AvatarStorageService.save: tipo de imagem não suportado (${file.mimetype}).`,
      );
    }
    await mkdir(this.dir(), { recursive: true });
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(this.path(filename), file.buffer);
    return filename;
  }

  /** Apaga o arquivo antigo ao trocar de avatar. Best-effort: nome inválido ou ausente é no-op. */
  async delete(filename: string): Promise<void> {
    if (!AVATAR_FILENAME_RE.test(filename)) return;
    await rm(this.path(filename), { force: true });
  }

  /** Lê o arquivo para a rota pública de leitura. `null` se o nome é inválido ou não existe. */
  async read(filename: string): Promise<StoredAvatarFile | null> {
    if (!AVATAR_FILENAME_RE.test(filename)) return null;
    const extension = filename.slice(filename.lastIndexOf('.') + 1);
    const mimetype = Object.entries(EXTENSION_BY_MIME).find(([, ext]) => ext === extension)?.[0];
    if (!mimetype) return null;
    try {
      const buffer = await readFile(this.path(filename));
      return { buffer, mimetype };
    } catch {
      return null;
    }
  }
}
