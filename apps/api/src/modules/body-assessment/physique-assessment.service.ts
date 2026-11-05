/**
 * Avaliação física inicial por foto: roda uma vez, depois da anamnese e antes do primeiro
 * protocolo, com as fotos que o aluno enviou (cifradas, com o consentimento próprio das fotos).
 * O resultado vira dado (`body_assessments`) e chega aos agentes de treino, alimentação e
 * recuperação pela fatia `bodyComposition`. Sem fotos, sem consentimento ou sem leitura válida,
 * o plano segue sem a parte visual: nada aqui trava o protocolo.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import {
  PHYSIQUE_MUSCLE_LABELS,
  POSTURE_REGION_LABELS,
  type BodyAssessmentResult,
  type PhotoAngle,
} from '@movivo/shared';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  ANAMNESIS_PHOTO_PATH_PREFIX,
  anamnesisSessionPhotos,
  bodyAssessments,
  bodyPhotos,
  consents,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { ImageMediaType } from '../nutrition/image-guard';
import { parseStateView, type StateView } from '../planning/state-view';
import { StudentStateReader } from '../student-state/student-state.reader';
import { physiqueTask, type PhysiqueInput, type PhysiqueOutput } from './physique-tasks';

const MEDIA_OF = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
/** Ordem fixa de leitura: frente, lados e costas. */
const ANGLE_ORDER: readonly PhotoAngle[] = ['FRONT', 'LEFT', 'RIGHT', 'BACK'];

/** Pontos para o profissional confirmar: o que a avaliação de postura e simetria observou. */
export function observationsOf(output: PhysiqueOutput): string[] {
  const { physique } = output;
  const posture = physique.posture
    .filter((p) => p.degree !== 'NONE_VISIBLE')
    .map((p) => `${POSTURE_REGION_LABELS[p.region]}: ${p.finding}`);
  const muscles = physique.muscleGroups
    .filter((g) => g.status === 'TO_DEVELOP')
    .map((g) => `${PHYSIQUE_MUSCLE_LABELS[g.region]} a desenvolver: ${g.note}`);
  return [...posture, ...(physique.symmetry ? [physique.symmetry] : []), ...muscles]
    .map((text) => text.slice(0, 200))
    .slice(0, 5);
}

/** Resumo do aluno para a leitura: idade, sexo, medidas, objetivo, modalidades, rotina e queixa. */
export function profileOf(view: StateView): PhysiqueInput['profile'] {
  const days = new Set(view.availability?.windows.map((w) => w.weekday)).size;
  const sports = view.training.externalSports.map((s) => s.label);
  const routine = [
    days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} por semana para treinar` : null,
    sports.length > 0 ? `pratica ${sports.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('; ');
  const complaint = view.safety.records
    .map((record) => record.summary)
    .filter(Boolean)
    .slice(0, 3)
    .join('; ');
  return {
    ageYears: view.identity.ageYears,
    biologicalSex: view.identity.biologicalSex,
    heightCm: view.identity.heightCm,
    weightKg: view.body['WEIGHT']?.latest ?? null,
    goal: view.goal?.declared.primary ?? null,
    modalities: view.training.modalities.map((m) => m.modality),
    routine: routine || null,
    complaint: complaint ? complaint.slice(0, 300) : null,
  };
}

@Injectable()
export class PhysiqueAssessmentService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly healthConsent: HealthConsentService,
    private readonly runner: AgentRunner,
    private readonly stateReader: StudentStateReader,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PhysiqueAssessmentService.name);
  }

  /**
   * Avalia as fotos da anamnese, uma única vez. Devolve `true` quando gravou uma avaliação nova
   * (quem chamou deve reler o estado do aluno).
   */
  async assessInitial(userId: string, today: string): Promise<boolean> {
    try {
      if (!(await this.healthConsent.hasActiveForUser(userId))) return false;
      const loaded = await this.db.runAsUser(userId, 'USER', async (tx) => {
        const [existing] = await tx
          .select({ id: bodyAssessments.id })
          .from(bodyAssessments)
          .where(eq(bodyAssessments.userId, userId))
          .limit(1);
        if (existing) return null;
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
        if (!consent) return null;
        const photos = await tx
          .select()
          .from(anamnesisSessionPhotos)
          .where(eq(anamnesisSessionPhotos.userId, userId))
          .orderBy(asc(anamnesisSessionPhotos.createdAt));
        if (photos.length === 0) return null;
        const gallery = await tx
          .select({ id: bodyPhotos.id })
          .from(bodyPhotos)
          .where(
            and(
              eq(bodyPhotos.userId, userId),
              isNull(bodyPhotos.deletedAt),
              inArray(
                bodyPhotos.storagePath,
                photos.map((photo) => `${ANAMNESIS_PHOTO_PATH_PREFIX}${photo.id}`),
              ),
            ),
          )
          .orderBy(desc(bodyPhotos.createdAt));
        return { photos, galleryIds: gallery.map((row) => row.id) };
      });
      if (!loaded) return false;

      const ordered = [...loaded.photos].sort(
        (a, b) =>
          ANGLE_ORDER.indexOf(a.angle as PhotoAngle) - ANGLE_ORDER.indexOf(b.angle as PhotoAngle),
      );
      const parts: Array<{ type: 'image'; mediaType: ImageMediaType; base64: string }> = [];
      for (const photo of ordered) {
        const base64 = await this.cipher.decryptHealth(photo.content);
        parts.push({
          type: 'image',
          mediaType: MEDIA_OF[photo.format as keyof typeof MEDIA_OF],
          base64,
        });
      }

      const state = await this.stateReader.read(userId, [
        'identity',
        'goals',
        'body',
        'training',
        'availability',
        'safety',
      ]);
      const view = parseStateView(state.slices as Record<string, unknown>);
      const run = await this.runner.run(
        physiqueTask,
        { order: ordered.map((p) => ({ angle: p.angle as PhotoAngle })), profile: profileOf(view) },
        {
          userId,
          sources: {
            methodology: async () => ({ text: '', versions: {} }),
            state: async () => ({ slices: {}, version: 0 }),
          },
          images: parts,
        },
      );
      const output = run.output;
      if (!output.analyzable) {
        this.logger.info({ userId, event: 'physique_not_analyzable' }, 'fotos sem leitura válida');
        return false;
      }
      const result: BodyAssessmentResult = {
        bodyFatRange: output.bodyFatRange,
        confidence: output.confidence,
        comparison: null,
        observationsForProfessional: observationsOf(output),
        limitations: output.limitations,
        physique: output.physique,
      };
      await this.db.runAsUser(userId, 'USER', (tx) =>
        tx.insert(bodyAssessments).values({
          userId,
          assessedOn: today,
          photoIds: loaded.galleryIds,
          modelRunId: run.modelRunIds[0] ?? null,
          result,
        }),
      );
      this.logger.info({ userId, event: 'physique_assessed' }, 'avaliação física inicial gravada');
      return true;
    } catch (error) {
      // A avaliação é um complemento: qualquer falha (visão, foto ilegível) deixa o plano seguir.
      this.logger.warn(
        { userId, err: error instanceof AgentTaskError ? error.taskId : error },
        'avaliação física inicial não concluída',
      );
      return false;
    }
  }
}
