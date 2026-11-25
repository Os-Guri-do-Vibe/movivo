/**
 * Fotos da reavaliação de ciclo: envio (cifrado, com o consentimento próprio das fotos), entrada
 * na galeria de evolução e comparação início × agora pela visão. As imagens nunca voltam ao
 * cliente e só são lidas, decifradas, para a comparação.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import type { PhotoAngle } from '@movivo/shared';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  anamnesisSessionPhotos,
  bodyAssessments,
  bodyPhotos,
  consents,
  cycleReassessmentPhotos,
  cycleReassessments,
  REASSESSMENT_PHOTO_PATH_PREFIX,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConsentService } from '../anamnesis/consent.service';
import { MAX_PHOTO_BYTES } from '../anamnesis/body-photo.service';
import { sniffImage, type ImageMediaType } from '../nutrition/image-guard';
import { photoComparisonTask, type PhotoComparison } from './photo-tasks';

const FORMAT_OF: Record<ImageMediaType, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MEDIA_OF = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

export interface PhotosState {
  /** O aluno autorizou o uso de fotos (consentimento próprio vigente). */
  allowed: boolean;
  angles: PhotoAngle[];
}

@Injectable()
export class ReassessmentPhotosService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consents: ConsentService,
    private readonly healthConsent: HealthConsentService,
    private readonly runner: AgentRunner,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ReassessmentPhotosService.name);
  }

  async state(userId: string, reassessmentId: string): Promise<PhotosState> {
    const allowed = await this.allowed(userId);
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ angle: cycleReassessmentPhotos.angle })
        .from(cycleReassessmentPhotos)
        .where(
          and(
            eq(cycleReassessmentPhotos.userId, userId),
            eq(cycleReassessmentPhotos.reassessmentId, reassessmentId),
          ),
        ),
    );
    return { allowed, angles: rows.map((row) => row.angle as PhotoAngle) };
  }

  async put(
    userId: string,
    reassessmentId: string,
    angle: PhotoAngle,
    bytes: Buffer,
  ): Promise<void> {
    if (bytes.length === 0) throw new BadRequestException('Envie uma imagem.');
    if (bytes.length > MAX_PHOTO_BYTES) throw new BadRequestException('A imagem passa de 5 MB.');
    const mediaType = sniffImage(bytes);
    if (!mediaType) throw new BadRequestException('Use uma imagem JPG, PNG ou WebP.');
    await this.assertOpen(userId, reassessmentId);
    if (!(await this.allowed(userId))) {
      throw new BadRequestException('Autorize o uso das fotos antes de enviar.');
    }
    const content = await this.cipher.encryptHealth(bytes.toString('base64'));
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(cycleReassessmentPhotos)
        .values({
          userId,
          reassessmentId,
          angle,
          format: FORMAT_OF[mediaType],
          sizeBytes: bytes.length,
          content,
        })
        .onConflictDoUpdate({
          target: [cycleReassessmentPhotos.reassessmentId, cycleReassessmentPhotos.angle],
          set: {
            format: FORMAT_OF[mediaType],
            sizeBytes: bytes.length,
            content,
            updatedAt: new Date(),
          },
        }),
    );
  }

  async remove(userId: string, reassessmentId: string, angle: PhotoAngle): Promise<void> {
    await this.assertOpen(userId, reassessmentId);
    await this.db.runAsSystem((tx) =>
      tx
        .delete(cycleReassessmentPhotos)
        .where(
          and(
            eq(cycleReassessmentPhotos.userId, userId),
            eq(cycleReassessmentPhotos.reassessmentId, reassessmentId),
            eq(cycleReassessmentPhotos.angle, angle),
          ),
        ),
    );
  }

  /** As fotos enviadas entram na galeria de evolução do aluno (presas ao consentimento vigente). */
  async adopt(userId: string, reassessmentId: string, takenOn: string): Promise<string[]> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const photos = await tx
        .select({ id: cycleReassessmentPhotos.id, angle: cycleReassessmentPhotos.angle })
        .from(cycleReassessmentPhotos)
        .where(
          and(
            eq(cycleReassessmentPhotos.userId, userId),
            eq(cycleReassessmentPhotos.reassessmentId, reassessmentId),
          ),
        );
      if (photos.length === 0) return [];
      const [consent] = await tx
        .select({ id: consents.id })
        .from(consents)
        .where(
          and(
            eq(consents.userId, userId),
            eq(consents.consentType, 'BODY_PHOTOS'),
            eq(consents.accepted, true),
            isNull(consents.revokedAt),
          ),
        )
        .limit(1);
      if (!consent) return [];
      const paths = photos.map((photo) => `${REASSESSMENT_PHOTO_PATH_PREFIX}${photo.id}`);
      // Retomar a análise não duplica a galeria: o que já entrou fica.
      const existing = await tx
        .select({ id: bodyPhotos.id, path: bodyPhotos.storagePath })
        .from(bodyPhotos)
        .where(and(eq(bodyPhotos.userId, userId), inArray(bodyPhotos.storagePath, paths)));
      const known = new Set(existing.map((row) => row.path));
      const fresh = photos.filter(
        (photo) => !known.has(`${REASSESSMENT_PHOTO_PATH_PREFIX}${photo.id}`),
      );
      const inserted =
        fresh.length === 0
          ? []
          : await tx
              .insert(bodyPhotos)
              .values(
                fresh.map((photo) => ({
                  userId,
                  angle: photo.angle,
                  takenOn,
                  storagePath: `${REASSESSMENT_PHOTO_PATH_PREFIX}${photo.id}`,
                  consentId: consent.id,
                })),
              )
              .returning({ id: bodyPhotos.id });
      return [...existing, ...inserted].map((row) => row.id);
    });
  }

  /**
   * Compara início × agora. Sem fotos novas, sem fotos de início ou sem leitura válida, devolve
   * `null`: a análise do ciclo segue sem a parte visual.
   */
  async compare(
    userId: string,
    reassessmentId: string,
    biologicalSex: string | null,
    today: string,
    galleryIds: readonly string[],
  ): Promise<PhotoComparison | null> {
    const images = await this.imagesFor(userId, reassessmentId);
    if (!images) return null;
    try {
      const run = await this.runner.run(
        photoComparisonTask,
        { order: images.order, daysBetween: images.daysBetween, biologicalSex },
        {
          userId,
          sources: {
            methodology: async () => ({ text: '', versions: {} }),
            state: async () => ({ slices: {}, version: 0 }),
          },
          images: images.parts,
        },
      );
      const result = run.output;
      if (result.comparable) {
        await this.db.runAsUser(userId, 'USER', (tx) =>
          tx.insert(bodyAssessments).values({
            userId,
            assessedOn: today,
            photoIds: [...galleryIds],
            modelRunId: run.modelRunIds[0] ?? null,
            result: {
              bodyFatRange: result.bodyFatRange,
              confidence: result.confidence,
              comparison: null,
              observationsForProfessional: [
                ...result.visibleChanges,
                ...result.observationsForProfessional,
              ].slice(0, 5),
              limitations: result.limitations,
              physique: result.physique,
            },
          }),
        );
      }
      return result;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'fotos sem comparação válida');
      return null;
    }
  }

  private async imagesFor(userId: string, reassessmentId: string) {
    const loaded = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const now = await tx
        .select()
        .from(cycleReassessmentPhotos)
        .where(
          and(
            eq(cycleReassessmentPhotos.userId, userId),
            eq(cycleReassessmentPhotos.reassessmentId, reassessmentId),
          ),
        );
      const start = await tx
        .select()
        .from(anamnesisSessionPhotos)
        .where(eq(anamnesisSessionPhotos.userId, userId))
        .orderBy(desc(anamnesisSessionPhotos.createdAt));
      const [reassessment] = await tx
        .select({ sentAt: cycleReassessments.sentAt })
        .from(cycleReassessments)
        .where(eq(cycleReassessments.id, reassessmentId));
      return { now, start, sentAt: reassessment?.sentAt ?? null };
    });
    const order: Array<{ angle: PhotoAngle; when: 'START' | 'NOW' }> = [];
    const parts: Array<{ type: 'image'; mediaType: ImageMediaType; base64: string }> = [];
    let earliest: Date | null = null;
    for (const photo of loaded.now) {
      const before = loaded.start.find((s) => s.angle === photo.angle);
      if (!before) continue;
      for (const [row, when] of [
        [before, 'START'],
        [photo, 'NOW'],
      ] as const) {
        parts.push({
          type: 'image',
          mediaType: MEDIA_OF[row.format as keyof typeof MEDIA_OF],
          base64: await this.cipher.decryptHealth(row.content),
        });
        order.push({ angle: photo.angle as PhotoAngle, when });
      }
      if (!earliest || before.createdAt < earliest) earliest = before.createdAt;
    }
    if (parts.length === 0) return null;
    const daysBetween =
      earliest && loaded.sentAt
        ? Math.round((loaded.sentAt.getTime() - earliest.getTime()) / 86_400_000)
        : null;
    return { order, parts, daysBetween };
  }

  private async allowed(userId: string): Promise<boolean> {
    const types = await this.consents.acceptedTypesForUser(userId);
    return types.includes('BODY_PHOTOS') && (await this.healthConsent.hasActiveForUser(userId));
  }

  private async assertOpen(userId: string, reassessmentId: string): Promise<void> {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ status: cycleReassessments.status })
        .from(cycleReassessments)
        .where(
          and(eq(cycleReassessments.id, reassessmentId), eq(cycleReassessments.userId, userId)),
        ),
    );
    if (!row) throw new NotFoundException();
    if (row.status !== 'SENT') throw new BadRequestException('Reavaliação já respondida.');
  }
}
