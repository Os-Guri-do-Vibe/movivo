/**
 * Compromissos do aluno: o passo combinado na conversa da semana, o prazo e o que aconteceu.
 * Cada especialista só enxerga e reavalia os seus. Roda sob a sessão RLS do próprio aluno.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, lte } from 'drizzle-orm';

import { studentCommitments } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { addDays } from '../planning/calc/week-planner';
import {
  COMMITMENT_WINDOW_DAYS,
  type CommitmentReview,
  type CommitmentSource,
  type OpenCommitment,
} from './commitments';

/** Quantos dias depois de combinado o aluno recebe o lembrete do meio da semana. */
export const NUDGE_AFTER_DAYS = 3;
const MAX_OPEN = 3;

export interface NudgeableCommitment extends OpenCommitment {
  source: CommitmentSource;
}

@Injectable()
export class CommitmentService {
  constructor(private readonly db: TenantDatabase) {}

  /** Passos em aberto combinados antes de hoje: os que o especialista precisa reavaliar agora. */
  async openForReview(
    userId: string,
    sources: readonly CommitmentSource[],
    today: string,
  ): Promise<OpenCommitment[]> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(studentCommitments)
        .where(
          and(
            eq(studentCommitments.userId, userId),
            eq(studentCommitments.status, 'OPEN'),
            inArray(studentCommitments.source, [...sources]),
            lt(studentCommitments.createdOn, today),
          ),
        )
        .orderBy(desc(studentCommitments.createdOn))
        .limit(MAX_OPEN),
    );
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      createdOn: r.createdOn,
      dueOn: r.dueOn,
    }));
  }

  /** Registra o novo passo; o anterior da mesma origem que ficou sem veredito é encerrado. */
  async record(
    userId: string,
    source: CommitmentSource,
    text: string,
    today: string,
  ): Promise<string | null> {
    const clean = text.trim().slice(0, 240);
    if (clean.length < 10) return null;
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx
        .update(studentCommitments)
        .set({ status: 'DROPPED', reviewedAt: new Date() })
        .where(
          and(
            eq(studentCommitments.userId, userId),
            eq(studentCommitments.source, source),
            eq(studentCommitments.status, 'OPEN'),
          ),
        );
      const [row] = await tx
        .insert(studentCommitments)
        .values({
          userId,
          source,
          text: clean,
          createdOn: today,
          dueOn: addDays(today, COMMITMENT_WINDOW_DAYS),
        })
        .returning({ id: studentCommitments.id });
      return row?.id ?? null;
    });
  }

  async applyReview(userId: string, review: CommitmentReview): Promise<number> {
    if (review.length === 0) return 0;
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      for (const item of review) {
        await tx
          .update(studentCommitments)
          .set({ status: item.verdict, evidence: item.evidence, reviewedAt: new Date() })
          .where(
            and(
              eq(studentCommitments.id, item.id),
              eq(studentCommitments.userId, userId),
              eq(studentCommitments.status, 'OPEN'),
            ),
          );
      }
    });
    return review.length;
  }

  /** Passos com 3 dias ou mais de vida, ainda dentro do prazo e sem lembrete. */
  async dueForNudge(userId: string, today: string): Promise<NudgeableCommitment[]> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(studentCommitments)
        .where(
          and(
            eq(studentCommitments.userId, userId),
            eq(studentCommitments.status, 'OPEN'),
            isNull(studentCommitments.nudgedAt),
            lte(studentCommitments.createdOn, addDays(today, -NUDGE_AFTER_DAYS)),
          ),
        )
        .orderBy(asc(studentCommitments.createdOn))
        .limit(1),
    );
    return rows
      .filter((r) => r.dueOn >= today)
      .map((r) => ({
        id: r.id,
        source: r.source as CommitmentSource,
        text: r.text,
        createdOn: r.createdOn,
        dueOn: r.dueOn,
      }));
  }

  async markNudged(userId: string, id: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(studentCommitments)
        .set({ nudgedAt: new Date() })
        .where(and(eq(studentCommitments.id, id), eq(studentCommitments.userId, userId))),
    );
  }
}
