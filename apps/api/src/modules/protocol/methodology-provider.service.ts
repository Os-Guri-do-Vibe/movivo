import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { METHODOLOGY_GUIDELINES, METHODOLOGY_VERSION } from './methodology';

export interface PublishedMethodology {
  id: string;
  version: number;
  versionLabel: string;
  content: string;
  summary: string | null;
  contentSha256: string;
}

const CACHE_MS = 5 * 60_000;

/**
 * Fonte runtime única da metodologia. O literal legado só participa do bootstrap v1;
 * depois disso o gerador lê exclusivamente a versão publicada no banco.
 */
@Injectable()
export class MethodologyProvider {
  private cached: { value: PublishedMethodology; expiresAt: number } | null = null;

  constructor(private readonly db: TenantDatabase) {}

  async current(): Promise<PublishedMethodology> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.value;
    await this.ensureBootstrap();
    const value = await this.db.runAsSystem(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT version.id, version.version, version.version_label, version.content,
          version.content_sha256, version.summary
        FROM methodology_versions version
        JOIN LATERAL (
          SELECT event.status
          FROM methodology_events event
          WHERE event.methodology_version_id = version.id
          ORDER BY event.sequence DESC, event.created_at DESC, event.id DESC
          LIMIT 1
        ) latest ON latest.status = 'PUBLISHED'::methodology_status
        ORDER BY version.version DESC
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        version: number;
        version_label: string;
        content: string;
        content_sha256: string;
        summary: string | null;
      }>;
      const row = rows[0];
      if (!row) throw new Error('Nenhuma metodologia CREF publicada.');
      return {
        id: row.id,
        version: Number(row.version),
        versionLabel: row.version_label,
        content: row.content,
        summary: row.summary,
        contentSha256: row.content_sha256,
      };
    });
    this.cached = { value, expiresAt: Date.now() + CACHE_MS };
    return value;
  }

  /** Migração idempotente do hardcode histórico para a versão publicada inicial. */
  async ensureBootstrap(): Promise<void> {
    const contentSha256 = createHash('sha256').update(METHODOLOGY_GUIDELINES).digest('hex');
    await this.db.runAsSystem(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('movivo.methodology.bootstrap'))`);
      await tx.execute(sql`
        WITH inserted AS (
          INSERT INTO methodology_versions (
            version, version_label, content, content_sha256, change_note, created_by
          )
          VALUES (
            1, ${METHODOLOGY_VERSION}, ${METHODOLOGY_GUIDELINES}, ${contentSha256},
            'Migração exata da metodologia compilada legada.', NULL
          )
          ON CONFLICT (version) DO NOTHING
          RETURNING id
        )
        INSERT INTO methodology_events (
          methodology_version_id, sequence, status, actor_id, note
        )
        SELECT id, 1, 'PUBLISHED'::methodology_status, NULL,
          'MIGRATED_LEGACY: bootstrap publicado sem alterar o conteúdo.'
        FROM inserted
      `);
    });
  }

  invalidate(): void {
    this.cached = null;
  }
}
