/**
 * ContextRepository (US-3.2) — I/O de banco da episodic memory, sob `SET LOCAL`/RLS.
 *
 * Isolado do `ContextService` (lógica pura) pelo mesmo motivo do `AiJobRepository`: é
 * mapeamento Drizzle sem ramo, escopado por titular via `runAsUser`, provado pelo teste de
 * integração contra Postgres real — por isso fica fora da cobertura unitária (vitest.config).
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { ProtocolStructure } from '@movivo/shared';

import {
  checkins,
  coachingSessions,
  protocols,
  users,
  workoutCompletions,
} from '../../../core/database/schema';
import { TenantDatabase } from '../../../core/database/tenant-database.service';
import type { ScrubUser } from '../llm/llm.types';

export interface EpisodicMemory {
  scrubUser: ScrubUser;
  /** Estado do aluno como JSON estruturado (protocolo/semana/fase/constraints). */
  state: Record<string, unknown>;
  summary: string | null;
}

@Injectable()
export class ContextRepository {
  constructor(private readonly db: TenantDatabase) {}

  /** Lê usuário (para scrub) + protocolo ativo + resumo do dia, tudo sob RLS do titular. */
  async loadEpisodic(userId: string, sessionDate: string): Promise<EpisodicMemory> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, phoneNumber: users.phoneNumber, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const [proto] = await tx
        .select({
          currentWeek: protocols.currentWeek,
          totalWeeks: protocols.totalWeeks,
          content: protocols.content,
          constraints: protocols.constraints,
        })
        .from(protocols)
        .where(and(eq(protocols.userId, userId), eq(protocols.status, 'ACTIVE')))
        .limit(1);

      const [session] = await tx
        .select({ summary: coachingSessions.summary })
        .from(coachingSessions)
        .where(
          and(eq(coachingSessions.userId, userId), eq(coachingSessions.sessionDate, sessionDate)),
        )
        .limit(1);

      // Memória factual mínima: eventos imutáveis e campos estruturados. O ciphertext das
      // respostas do check-in não é aberto aqui; princípio de minimização de dado sensível.
      const recentWorkouts = await tx
        .select({
          completedAt: workoutCompletions.completedAt,
          sessionKey: workoutCompletions.sessionKey,
          weekNumber: workoutCompletions.weekNumber,
          perceivedEffort: workoutCompletions.perceivedEffort,
        })
        .from(workoutCompletions)
        .where(eq(workoutCompletions.userId, userId))
        .orderBy(desc(workoutCompletions.completedAt))
        .limit(5);

      const recentCheckins = await tx
        .select({
          weekNumber: checkins.weekNumber,
          completedAt: checkins.completedAt,
          adjustments: checkins.adjustments,
        })
        .from(checkins)
        .where(and(eq(checkins.userId, userId), isNotNull(checkins.completedAt)))
        .orderBy(desc(checkins.completedAt))
        .limit(3);

      // `constraints` lido como shape solto de propósito: ai-coach não importa o tipo do
      // domínio de protocolo (fronteira §12.5).
      const c = (proto?.constraints ?? {}) as { injuryTags?: string[]; equipment?: string[] };
      const content = proto?.content as ProtocolStructure | undefined;

      const state: Record<string, unknown> = proto
        ? {
            temProtocoloAtivo: true,
            objetivo: content?.goal,
            fase: content?.phase,
            semanaAtual: proto.currentWeek,
            totalSemanas: proto.totalWeeks,
            restricoes: c.injuryTags ?? [],
            equipamentos: c.equipment ?? [],
            eventosRecentes: {
              treinosConcluidos: recentWorkouts,
              checkins: recentCheckins,
            },
          }
        : {
            temProtocoloAtivo: false,
            eventosRecentes: {
              treinosConcluidos: recentWorkouts,
              checkins: recentCheckins,
            },
          };

      return {
        scrubUser: {
          name: user?.name ?? null,
          phoneNumber: user?.phoneNumber ?? null,
          email: user?.email ?? null,
        },
        state,
        summary: session?.summary ?? null,
      };
    });
  }

  async loadScrubUser(userId: string): Promise<ScrubUser> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, phoneNumber: users.phoneNumber, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return {
        name: user?.name ?? null,
        phoneNumber: user?.phoneNumber ?? null,
        email: user?.email ?? null,
      };
    });
  }

  async upsertSummary(userId: string, sessionDate: string, summary: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx
        .insert(coachingSessions)
        .values({ userId, sessionDate, summary })
        .onConflictDoUpdate({
          target: [coachingSessions.userId, coachingSessions.sessionDate],
          set: { summary, updatedAt: new Date() },
        });
    });
  }
}
