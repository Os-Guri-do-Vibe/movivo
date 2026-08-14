/**
 * Persistência da conversa do Coach sob RLS (US-3.5).
 *
 * Grava cada turno em `conversations` (INBOUND do aluno, OUTBOUND de MOVI) no contexto do
 * titular. Também lê o que o worker precisa sob RLS: `ScrubUser` (para o PII Scrubber) e as
 * `constraints` do protocolo ativo (para a substituição segura). Sem ramo de negócio — I/O
 * puro, coberto pelo teste de integração (fora da cobertura unitária, como os outros repos).
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { conversations, handoffAlerts, protocols, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';
import type { SubstitutionConstraints } from '../protocol/exercise-substitution';

export interface PersistTurnInput {
  userId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  validationPassed?: boolean;
  modelUsed?: string | null;
  latencyMs?: number | null;
  ragSources?: Array<{
    chunkId: string;
    documentId: string | null;
    title: string;
    sourceUrl?: string;
  }>;
}

@Injectable()
export class ConversationRepository {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queueEvents: DashboardQueueEventsService,
  ) {}

  async loadScrubUser(userId: string): Promise<ScrubUser> {
    const [user] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ name: users.name, phoneNumber: users.phoneNumber, email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    return {
      name: user?.name ?? null,
      phoneNumber: user?.phoneNumber ?? null,
      email: user?.email ?? null,
    };
  }

  /** Constraints do protocolo ativo (para a substituição). `null` = sem protocolo ativo. */
  async loadConstraints(userId: string): Promise<SubstitutionConstraints | null> {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ constraints: protocols.constraints })
        .from(protocols)
        .where(and(eq(protocols.userId, userId), eq(protocols.status, 'ACTIVE')))
        .limit(1),
    );
    if (!row?.constraints) return null;
    const c = row.constraints as Partial<SubstitutionConstraints>;
    return {
      level: c.level ?? 'INICIANTE',
      // Protocolo anterior ao catálogo v3 não tem local dos 4 novos valores. `FULL_GYM` é
      // o default MENOS permissivo em termos de equipamento presumido? Não: é o mais amplo.
      // Aqui o default seguro é `HOME` — sugerir um substituto de máquina para quem treina
      // em casa é pior do que sugerir um de peso do corpo para quem está na academia.
      location: c.location ?? 'HOME',
      equipment: c.equipment ?? [],
      injuryTags: c.injuryTags ?? [],
    };
  }

  /** Persiste um alerta de handoff consultável sob RLS (US-3.6). Consumido no painel (Sprint 5). */
  async persistHandoff(userId: string, level: 'ALERT' | 'SAFETY', reason: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx.insert(handoffAlerts).values({ userId, level, reason });
    });
    this.queueEvents.emit('handoff');
  }

  async persistTurn(input: PersistTurnInput): Promise<void> {
    await this.db.runAsUser(input.userId, 'USER', async (tx) => {
      await tx.insert(conversations).values({
        userId: input.userId,
        direction: input.direction,
        content: input.content,
        validationPassed: input.validationPassed ?? null,
        modelUsed: input.modelUsed ?? null,
        latencyMs: input.latencyMs ?? null,
        ragSources: input.ragSources?.length ? input.ragSources : null,
      });
    });
  }
}
