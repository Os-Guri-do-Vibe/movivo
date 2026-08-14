/** Leitura runtime do FAQ publicado, com match determinístico e cache curto. */
import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';

import { DRIZZLE } from '../database/database.constants';
import type { DrizzleClient } from '../database/database.module';
import { faqEntries } from '../database/schema';

export interface PublishedFaqMatch {
  id: string;
  faqKey: string;
  version: number;
  answer: string;
}

export function normalizeFaqQuestion(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/[?!.]+$/u, '')
    .replace(/\s+/gu, ' ');
}

@Injectable()
export class FaqService {
  private cached: { entries: Map<string, PublishedFaqMatch>; expiresAt: number } | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleClient) {}

  invalidate(): void {
    this.cached = null;
  }

  async match(message: string): Promise<PublishedFaqMatch | null> {
    const entries = await this.currentEntries();
    return entries.get(normalizeFaqQuestion(message)) ?? null;
  }

  async currentEntries(): Promise<Map<string, PublishedFaqMatch>> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.entries;

    const rows = await this.db
      .select({
        id: faqEntries.id,
        faqKey: faqEntries.faqKey,
        normalizedQuestion: faqEntries.normalizedQuestion,
        answer: faqEntries.answer,
        version: faqEntries.version,
        status: faqEntries.status,
      })
      .from(faqEntries)
      .orderBy(desc(faqEntries.version), desc(faqEntries.createdAt));

    const latestKeys = new Set<string>();
    const entries = new Map<string, PublishedFaqMatch>();
    for (const row of rows) {
      if (latestKeys.has(row.faqKey)) continue;
      latestKeys.add(row.faqKey);
      if (row.status === 'RETIRED') continue;
      entries.set(row.normalizedQuestion, {
        id: row.id,
        faqKey: row.faqKey,
        version: row.version,
        answer: row.answer,
      });
    }
    this.cached = { entries, expiresAt: Date.now() + 60_000 };
    return entries;
  }
}
