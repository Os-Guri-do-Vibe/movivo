/**
 * Avaliação física por foto na ficha do aluno (Control Center), para AUDITORIA.
 *
 * O profissional confere o que a IA leu nas fotos; ele não atende o aluno. Por isso a leitura
 * sai pronta para a tela (texto e etiquetas) e as imagens, os ids das fotos e os caminhos de
 * armazenamento nunca entram no payload.
 *
 * Duas barreiras, nesta ordem:
 *  1. Consentimento próprio das fotos (`BODY_PHOTOS`, aceito e não revogado). O profissional não
 *     lê `consents` pela RLS, então a checagem é um booleano em contexto de sistema, o mesmo
 *     critério de `PhysiqueAssessmentService`. Sem ele, nenhuma linha de avaliação é lida.
 *  2. A leitura das avaliações roda no contexto de quem abriu a ficha (`runAsUser`): a RLS de
 *     `body_assessments` exige o consentimento de saúde vigente do titular, como nas demais
 *     partes da seção `health`.
 *
 * Quem chama só invoca isto com `STUDENTS_HEALTH_READ`; sem a capability a seção nem existe.
 */
import {
  photoAssessmentPhysiqueAuditSchema,
  type PhotoAssessmentAudit,
  type PhotoAssessmentPhysiqueAudit,
  type StudentPhotoAssessments,
} from '@movivo/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { bodyAssessments, consents } from '../../core/database/schema';
import type { TenantDatabase, TenantRole } from '../../core/database/tenant-database.service';

/** Linha de `body_assessments` como a ficha a lê (sem o modelo e sem as fotos em si). */
export interface PhotoAssessmentRow {
  id: string;
  assessedOn: string;
  photoIds: unknown;
  result: unknown;
}

const EMPTY: StudentPhotoAssessments = { latest: null, previous: null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function texts(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function fatRange(value: unknown): PhotoAssessmentAudit['bodyFatRange'] {
  const range = record(value);
  const { min, max } = range;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return { min, max };
}

/** A parte completa só entra se estiver íntegra; avaliação antiga (sem ela) vira `null`. */
function physique(value: unknown): PhotoAssessmentPhysiqueAudit | null {
  if (value == null) return null;
  const parsed = photoAssessmentPhysiqueAuditSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Converte o `result` gravado (jsonb) na leitura da tela. Tolerante de propósito: a ficha
 * precisa abrir avaliações de qualquer época, inclusive as anteriores à avaliação completa.
 */
export function toPhotoAssessmentAudit(row: PhotoAssessmentRow): PhotoAssessmentAudit {
  const result = record(row.result);
  const comparison = record(result.comparison);
  return {
    id: row.id,
    assessedOn: row.assessedOn,
    photoCount: Array.isArray(row.photoIds) ? row.photoIds.length : 0,
    confidence: result.confidence === 'MEDIUM' ? 'MEDIUM' : 'LOW',
    bodyFatRange: fatRange(result.bodyFatRange),
    comparisonSummary:
      typeof comparison.summary === 'string' && comparison.summary.trim() !== ''
        ? comparison.summary
        : null,
    observationsForProfessional: texts(result.observationsForProfessional),
    limitations: texts(result.limitations),
    physique: physique(result.physique),
  };
}

/** Monta o par "mais recente + anterior" a partir das linhas já ordenadas (mais nova primeiro). */
export function toStudentPhotoAssessments(
  rows: readonly PhotoAssessmentRow[],
): StudentPhotoAssessments {
  const [latest, previous] = rows;
  return {
    latest: latest ? toPhotoAssessmentAudit(latest) : null,
    previous: previous ? toPhotoAssessmentAudit(previous) : null,
  };
}

export async function readStudentPhotoAssessments(
  db: TenantDatabase,
  actor: { userId: string; role: TenantRole },
  studentId: string,
): Promise<StudentPhotoAssessments> {
  const [consent] = await db.runAsSystem((tx) =>
    tx
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.userId, studentId),
          eq(consents.consentType, 'BODY_PHOTOS'),
          eq(consents.accepted, true),
          isNull(consents.revokedAt),
        ),
      )
      .limit(1),
  );
  if (!consent) return EMPTY;

  const rows = await db.runAsUser(actor.userId, actor.role, (tx) =>
    tx
      .select({
        id: bodyAssessments.id,
        assessedOn: bodyAssessments.assessedOn,
        photoIds: bodyAssessments.photoIds,
        result: bodyAssessments.result,
      })
      .from(bodyAssessments)
      .where(eq(bodyAssessments.userId, studentId))
      .orderBy(desc(bodyAssessments.assessedOn), desc(bodyAssessments.createdAt))
      .limit(2),
  );
  return toStudentPhotoAssessments(rows);
}
