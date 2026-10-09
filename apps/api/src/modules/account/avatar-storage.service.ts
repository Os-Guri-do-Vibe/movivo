/**
 * `AvatarStorageService` — grava/lê/apaga fotos de perfil no disco persistente da VPS.
 *
 * Decisão de infra do MVP (2026-09-02, decisão do fundador): sem S3/R2 ainda — a
 * arquitetura de referência do MVP é uma única VPS (`ARQUITETURA.md` — "Infra MVP"),
 * sem object storage decidido. O nome do arquivo salvo é um UUID gerado aqui, nunca o
 * `userId`: evita expor o identificador do titular. A leitura exige autenticação;
 * o regex estrito do nome também impede path traversal.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AppConfigService } from '../../core/config';

export interface UploadedAvatarFile {
  readonly buffer: Buffer;
  readonly mimetype: string;
  readonly originalname?: string;
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

/** Identificação por assinatura; não é decodificação ou sanitização completa da imagem. */
function hasImageSignature(buffer: Buffer, mimetype: string): boolean {
  if (mimetype === 'image/jpeg') {
    return (
      buffer.length > 5 &&
      buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) &&
      buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]))
    );
  }
  if (mimetype === 'image/png') {
    return (
      buffer.length > 20 &&
      buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      buffer.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
    );
  }
  return (
    mimetype === 'image/webp' &&
    buffer.length > 16 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16)) &&
    buffer.readUInt32LE(4) === buffer.length - 8
  );
}

/**
 * Teto absoluto lido pelo `FileInterceptor` do multer, que precisa do número na
 * decoração da rota (antes da DI resolver `AppConfigService`). É só a rede de
 * segurança contra abuso grosseiro de memória — o limite de verdade, configurável via
 * `AVATAR_UPLOAD_MAX_BYTES`, é checado no controller e novamente aqui contra os bytes reais do buffer.
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
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
      throw new BadRequestException('Envie um arquivo de imagem não vazio.');
    }
    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Formato de imagem não suportado (use JPEG, PNG ou WebP).');
    }
    if (file.originalname) {
      const extension = file.originalname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
      if (!extension || !['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
        throw new BadRequestException('Extensão de imagem não suportada (use JPG, PNG ou WebP).');
      }
      if (
        extension !== EXTENSION_BY_MIME[file.mimetype] &&
        !(extension === 'jpeg' && file.mimetype === 'image/jpeg')
      ) {
        throw new BadRequestException('Extensão e conteúdo da imagem não correspondem.');
      }
    }
    if (file.buffer.length > Math.min(this.maxUploadBytes, AVATAR_UPLOAD_HARD_CEILING_BYTES)) {
      throw new BadRequestException('Arquivo excede o tamanho máximo permitido.');
    }
    if (!hasImageSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException('O conteúdo do arquivo não corresponde ao formato da imagem.');
    }
    const extension = EXTENSION_BY_MIME[file.mimetype];
    await mkdir(this.dir(), { recursive: true, mode: 0o700 });
    await chmod(this.dir(), 0o700);
    const filename = `${randomUUID()}.${extension}`;
    await writeFile(this.path(filename), file.buffer, { flag: 'wx', mode: 0o600 });
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
