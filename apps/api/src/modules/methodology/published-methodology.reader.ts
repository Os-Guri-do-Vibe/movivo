import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { methodologyDomainSpec, type MethodologyDomain } from '@movivo/shared';

import type { MethodologyContext, PublishedMethodology } from '../../core/agents/agent-context';
import { methodologyDocuments } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { renderMethodology } from './methodology-render';

/**
 * API e workers rodam em processos separados: uma publicação só invalida o cache do processo
 * que publicou, então os demais enxergam a versão nova em até este tempo.
 */
const CACHE_TTL_MS = 60_000;

type PublishedDocument = typeof methodologyDocuments.$inferSelect;

/** Versão PUBLICADA de cada domínio, renderizada para o prompt dos agentes. */
@Injectable()
export class PublishedMethodologyReader implements PublishedMethodology {
  private cache: { at: number; docs: Map<string, PublishedDocument> } | null = null;

  constructor(private readonly db: TenantDatabase) {}

  async render(domains: readonly MethodologyDomain[]): Promise<MethodologyContext> {
    const published = await this.published();
    const parts: string[] = [];
    const versions: MethodologyContext['versions'] = {};
    const parameters: NonNullable<MethodologyContext['parameters']> = {};
    for (const domain of domains) {
      const doc = published.get(domain);
      if (!doc) continue;
      parts.push(
        renderMethodology(methodologyDomainSpec(domain), doc.version, doc.parameters, doc.guidance),
      );
      versions[domain] = doc.version;
      parameters[domain] = doc.parameters;
    }
    return { text: parts.join('\n\n'), versions, parameters };
  }

  async publishedOf(domain: MethodologyDomain): Promise<PublishedDocument | null> {
    return (await this.published()).get(domain) ?? null;
  }

  invalidate(): void {
    this.cache = null;
  }

  private async published(): Promise<Map<string, PublishedDocument>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.docs;
    const rows = await this.db.runAsSystem((tx) =>
      tx.select().from(methodologyDocuments).where(eq(methodologyDocuments.status, 'PUBLISHED')),
    );
    this.cache = { at: Date.now(), docs: new Map(rows.map((row) => [row.domain, row])) };
    return this.cache.docs;
  }
}
