/**
 * Memória do aluno (escrita e leitura do curador). Tudo roda sob a sessão RLS do próprio aluno e
 * o texto é cifrado: um fato nunca aparece para outro aluno nem em claro no banco. Contexto de
 * saúde só é gravado com consentimento de saúde ativo.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { studentMemories } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { planMemoryWrites, type ActiveMemory, type MemoryItem } from './student-memory';

export interface MemoryWriteResult {
  inserted: number;
  bumped: number;
  retired: number;
}

@Injectable()
export class StudentMemoryService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consent: HealthConsentService,
  ) {}

  /** Fatos ativos com id (para o curador decidir o que reforçar ou aposentar). */
  async active(userId: string): Promise<ActiveMemory[]> {
    const consented = await this.consent.hasActiveForUser(userId);
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          id: studentMemories.id,
          kind: studentMemories.kind,
          content: studentMemories.content,
          importance: studentMemories.importance,
        })
        .from(studentMemories)
        .where(and(eq(studentMemories.userId, userId), isNull(studentMemories.retiredAt)))
        .orderBy(desc(studentMemories.recordedAt)),
    );
    const out: ActiveMemory[] = [];
    for (const row of rows) {
      if (row.kind === 'HEALTH_CONTEXT' && !consented) continue;
      out.push({
        id: row.id,
        kind: row.kind as ActiveMemory['kind'],
        importance: row.importance,
        text: await this.cipher.decryptHealth(row.content),
      });
    }
    return out;
  }

  async apply(
    userId: string,
    incoming: readonly MemoryItem[],
    retireIds: readonly string[] = [],
  ): Promise<MemoryWriteResult> {
    const consented = await this.consent.hasActiveForUser(userId);
    const allowed = incoming.filter((item) => item.kind !== 'HEALTH_CONTEXT' || consented);
    const plan = planMemoryWrites(await this.active(userId), allowed, retireIds);
    if (plan.insert.length === 0 && plan.bump.length === 0 && plan.retire.length === 0) {
      return { inserted: 0, bumped: 0, retired: 0 };
    }
    const encrypted = await Promise.all(
      plan.insert.map(async (item) => ({
        userId,
        kind: item.kind,
        importance: item.importance,
        origin: item.origin,
        content: await this.cipher.encryptHealth(item.text),
      })),
    );
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      if (encrypted.length > 0) await tx.insert(studentMemories).values(encrypted);
      for (const { id, importance } of plan.bump) {
        await tx
          .update(studentMemories)
          .set({ importance })
          .where(and(eq(studentMemories.id, id), eq(studentMemories.userId, userId)));
      }
      if (plan.retire.length > 0) {
        await tx
          .update(studentMemories)
          .set({ retiredAt: new Date() })
          .where(and(eq(studentMemories.userId, userId), inArray(studentMemories.id, plan.retire)));
      }
    });
    return {
      inserted: plan.insert.length,
      bumped: plan.bump.length,
      retired: plan.retire.length,
    };
  }
}
