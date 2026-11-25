/**
 * Fotos do corpo enviadas durante a anamnese (etapa opcional de medidas).
 *
 * Regras que valem no servidor, não só na tela:
 *  - só com sessão ativa, consentimento de saúde E consentimento próprio `BODY_PHOTOS` vigentes;
 *  - o formato é reconhecido pelos primeiros bytes do arquivo (o `Content-Type` do cliente não
 *    é confiado) e o tamanho tem teto;
 *  - a imagem vai CIFRADA (`HealthCipherService`); nada da foto aparece em log;
 *  - uma foto por posição: enviar de novo substitui.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gt } from 'drizzle-orm';
import { CONSENT_TEXTS, type PhotoAngle } from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  anamnesisSessionPhotos,
  anamnesisSessions,
  type PhotoFormat,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConsentService } from './consent.service';

/** Teto de cada foto: celular moderno em JPEG cabe com folga e o limite protege a cifra. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Formato pela assinatura dos primeiros bytes; `null` se não for JPEG, PNG ou WebP. */
export function detectPhotoFormat(bytes: Buffer): PhotoFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

@Injectable()
export class BodyPhotoService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consents: ConsentService,
    private readonly healthConsent: HealthConsentService,
  ) {}

  /** Salva (ou substitui) a foto da posição. */
  async put(token: string, angle: PhotoAngle, bytes: Buffer): Promise<{ angle: PhotoAngle }> {
    if (bytes.length === 0) throw new BadRequestException('Envie uma imagem.');
    if (bytes.length > MAX_PHOTO_BYTES) {
      throw new BadRequestException('A imagem passa de 5 MB.');
    }
    const format = detectPhotoFormat(bytes);
    if (!format) throw new BadRequestException('Use uma imagem JPG, PNG ou WebP.');

    const { id: sessionId, userId } = await this.activeSession(token);
    await this.assertConsents(sessionId, userId);

    const content = await this.cipher.encryptHealth(bytes.toString('base64'));
    await this.db.runAsTokenScoped(sessionId, async (tx) => {
      await tx
        .insert(anamnesisSessionPhotos)
        .values({
          anamnesisSessionId: sessionId,
          angle,
          format,
          sizeBytes: bytes.length,
          content,
        })
        .onConflictDoUpdate({
          target: [anamnesisSessionPhotos.anamnesisSessionId, anamnesisSessionPhotos.angle],
          set: { format, sizeBytes: bytes.length, content, updatedAt: new Date() },
        });
    });
    return { angle };
  }

  /** Apaga a foto da posição (o aluno desistiu dela). */
  async remove(token: string, angle: PhotoAngle): Promise<{ angle: PhotoAngle }> {
    const { id: sessionId } = await this.activeSession(token);
    // O contexto anônimo não apaga (a RLS reserva DELETE ao sistema); a sessão já foi
    // resolvida pelo token, que é a credencial.
    await this.db.runAsSystem((tx) =>
      tx
        .delete(anamnesisSessionPhotos)
        .where(
          and(
            eq(anamnesisSessionPhotos.anamnesisSessionId, sessionId),
            eq(anamnesisSessionPhotos.angle, angle),
          ),
        ),
    );
    return { angle };
  }

  /** Posições que já têm foto nesta sessão (o conteúdo nunca volta ao cliente). */
  async anglesOf(sessionId: string): Promise<PhotoAngle[]> {
    const rows = await this.db.runAsTokenScoped(sessionId, (tx) =>
      tx
        .select({ angle: anamnesisSessionPhotos.angle })
        .from(anamnesisSessionPhotos)
        .where(eq(anamnesisSessionPhotos.anamnesisSessionId, sessionId)),
    );
    return rows.map((row) => row.angle as PhotoAngle);
  }

  private async activeSession(token: string): Promise<{ id: string; userId: string | null }> {
    const [session] = await this.db.runAsSystem((tx) =>
      tx
        .select({ id: anamnesisSessions.id, userId: anamnesisSessions.userId })
        .from(anamnesisSessions)
        .where(
          and(
            eq(anamnesisSessions.token, token),
            eq(anamnesisSessions.status, 'IN_PROGRESS'),
            gt(anamnesisSessions.expiresAt, new Date()),
          ),
        )
        .limit(1),
    );
    if (!session) throw new NotFoundException('Sessão de anamnese não encontrada ou expirada.');
    return session;
  }

  private async assertConsents(sessionId: string, userId: string | null): Promise<void> {
    const health =
      (userId !== null && (await this.healthConsent.hasActiveForUser(userId))) ||
      (await this.consents.hasValidSessionConsent(sessionId, 'HEALTH_DATA'));
    const photos = await this.consents.hasValidSessionConsent(sessionId, 'BODY_PHOTOS');
    if (!health || !photos) {
      throw new BadRequestException(
        `Autorize o uso das fotos (${CONSENT_TEXTS.BODY_PHOTOS.title.toLowerCase()}) antes de enviar.`,
      );
    }
  }
}
