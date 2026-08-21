import { sql } from 'drizzle-orm';

import type { TenantTransaction } from '../../core/database/tenant-database.service';

export type KnowledgeStatus =
  | 'QUARANTINED'
  | 'PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'INDEXING'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'FAILED'
  | 'ARCHIVED';

export interface KnowledgeState {
  status: KnowledgeStatus;
  stage: string;
  errorCode: string | null;
}

export function lockKnowledgeDocument(tx: TenantTransaction, documentId: string) {
  return tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge:${documentId}`}, 0))`,
  );
}

export async function currentKnowledgeState(
  tx: TenantTransaction,
  documentId: string,
): Promise<KnowledgeState | null> {
  const rows = (await tx.execute(sql`
    SELECT status, stage, error_code
    FROM knowledge_document_events
    WHERE document_id = ${documentId}::uuid
    ORDER BY sequence DESC, created_at DESC, id DESC LIMIT 1
  `)) as unknown as Array<{
    status: KnowledgeStatus;
    stage: string;
    error_code: string | null;
  }>;
  const row = rows[0];
  return row ? { status: row.status, stage: row.stage, errorCode: row.error_code } : null;
}

export async function appendKnowledgeEvent(
  tx: TenantTransaction,
  input: {
    documentId: string;
    status: KnowledgeStatus;
    stage: string;
    actorId?: string | null;
    errorCode?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO knowledge_document_events (
      document_id, sequence, status, stage, actor_id, error_code, note
    )
    SELECT ${input.documentId}::uuid, COALESCE(max(sequence), 0) + 1,
      ${input.status}::knowledge_document_status, ${input.stage},
      ${input.actorId ?? null}::uuid, ${input.errorCode ?? null}, ${input.note ?? null}
    FROM knowledge_document_events
    WHERE document_id = ${input.documentId}::uuid
  `);
}
