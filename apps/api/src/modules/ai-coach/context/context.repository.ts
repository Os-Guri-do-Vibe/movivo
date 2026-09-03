/**
 * ContextRepository (US-3.2) — I/O de banco da episodic memory, sob `SET LOCAL`/RLS.
 *
 * Isolado do `ContextService` (lógica pura) pelo mesmo motivo do `AiJobRepository`: é
 * mapeamento Drizzle sem ramo, escopado por titular via `runAsUser`, provado pelo teste de
 * integração contra Postgres real — por isso fica fora da cobertura unitária (vitest.config).
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { anamnesisStructuredSchema, type ProtocolStructure } from '@movivo/shared';

import { HealthCipherService } from '../../../core/database/health-cipher.service';
import {
  anamnesisSessions,
  checkins,
  coachingSessions,
  protocols,
  users,
  workoutCompletions,
} from '../../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../../core/database/tenant-database.service';
import { healthBlockSchema } from '../../anamnesis/health-block';
import type { ScrubUser } from '../llm/llm.types';

export interface EpisodicMemory {
  scrubUser: ScrubUser;
  /** Estado do aluno como JSON estruturado (protocolo/semana/fase/constraints). */
  state: Record<string, unknown>;
  summary: string | null;
}

@Injectable()
export class ContextRepository {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
  ) {}

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
          anamnesisSessionId: protocols.anamnesisSessionId,
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

      // Achado 2026-09-02 (decisão do fundador): o Coach passa a receber o protocolo
      // COMPLETO (todas as sessões/exercícios, não só objetivo/fase resumidos) e a
      // anamnese estruturada que o originou — ele é o Coach individual deste aluno, então
      // "conhecimento individualizado" inclui o que o aluno respondeu no formulário, não só
      // o que foi derivado dele. Revoga a minimização anterior (que só valia pro ciphertext
      // de check-in, mantida abaixo) para este caso específico.
      const anamnese = proto?.anamnesisSessionId
        ? await this.loadAnamneseSummary(tx, proto.anamnesisSessionId)
        : null;

      const state: Record<string, unknown> = proto
        ? {
            temProtocoloAtivo: true,
            semanaAtual: proto.currentWeek,
            totalSemanas: proto.totalWeeks,
            restricoes: c.injuryTags ?? [],
            equipamentos: c.equipment ?? [],
            protocoloCompleto: content,
            anamnese,
            eventosRecentes: {
              treinosConcluidos: recentWorkouts,
              checkins: recentCheckins,
            },
          }
        : {
            temProtocoloAtivo: false,
            anamnese,
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

  /**
   * Anamnese estruturada (dados_bloco_3, jsonb em claro) + dor/PAR-Q (dados_bloco_2,
   * cifrado) da sessão que originou o protocolo ativo do titular. Melhor esforço, no
   * mesmo padrão de `fallbackParqTags` do worker de geração: se o bloco cifrado não abrir
   * ou não bater no schema, devolve `null` naquele pedaço — a conversa segue sem essa
   * parte do contexto em vez de falhar a resposta inteira por causa dela.
   */
  private async loadAnamneseSummary(
    tx: TenantTransaction,
    anamnesisSessionId: string,
  ): Promise<Record<string, unknown> | null> {
    const [session] = await tx
      .select({
        dataBlock2: anamnesisSessions.dataBlock2,
        dataBlock3: anamnesisSessions.dataBlock3,
      })
      .from(anamnesisSessions)
      .where(eq(anamnesisSessions.id, anamnesisSessionId))
      .limit(1);
    if (!session) return null;

    const structured = anamnesisStructuredSchema.safeParse(session.dataBlock3);

    let health: { pain?: unknown; parq?: unknown } | null = null;
    if (session.dataBlock2) {
      try {
        const parsed = healthBlockSchema.parse(
          JSON.parse(await this.cipher.decryptHealth(session.dataBlock2)),
        );
        health = { pain: parsed.pain, parq: parsed.parq };
      } catch {
        health = null;
      }
    }

    return {
      respostasFormulario: structured.success ? structured.data : null,
      dor: health?.pain ?? null,
      parq: health?.parq ?? null,
    };
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
