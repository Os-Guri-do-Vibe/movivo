/**
 * Persistência da conversa do Coach sob RLS (US-3.5).
 *
 * Grava cada turno em `conversations` (INBOUND do aluno, OUTBOUND de MOVI) no contexto do
 * titular. Também lê o `ScrubUser` que o worker precisa sob RLS (para o PII Scrubber). Sem
 * ramo de negócio — I/O puro, coberto pelo teste de integração (fora da cobertura unitária,
 * como os outros repos).
 *
 * Achado 2026-09-02: `loadConstraints` (só as `constraints` do protocolo ativo) saiu daqui —
 * o fluxo de substituição agora precisa do protocolo INTEIRO (`content` estruturado, não só
 * `constraints`), e passou a usar `ProtocolSubstitutionRepository.loadActiveProtocol`
 * diretamente, que já lê a mesma linha com tudo junto.
 */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { BiologicalSex } from '@movivo/shared';

import { conversations, handoffAlerts, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { ScrubUser } from '../ai-coach/llm/llm.types';

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
    documentVersion?: number;
    documentSha256?: string;
    publicationEventId?: string;
    evidenceId?: string;
    claimIds?: string[];
    verifierModel?: string;
  }>;
}

@Injectable()
export class ConversationRepository {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queueEvents: DashboardQueueEventsService,
  ) {}

  /**
   * Uma leitura de `users` por job, sob RLS, com tudo que o worker precisa do titular: a
   * PII para o scrubber e o `biologicalSex` que decide QUAL persona o atende (Sprint 11).
   *
   * As duas coisas juntas de propósito — eram uma query só antes do slot existir, e continuam
   * sendo uma query só. `biologicalSex` nulo é normal (titular anterior à coluna, ou que
   * nunca submeteu anamnese) e nunca derruba a resposta: a resolução da persona trata
   * `null` como "sem titular em contexto" e cai no empréstimo entre slots.
   */
  async loadRuntimeUser(userId: string): Promise<{
    scrubUser: ScrubUser;
    biologicalSex: BiologicalSex | null;
  }> {
    const [user] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          name: users.name,
          phoneNumber: users.phoneNumber,
          email: users.email,
          biologicalSex: users.biologicalSex,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    );
    return {
      scrubUser: {
        name: user?.name ?? null,
        phoneNumber: user?.phoneNumber ?? null,
        email: user?.email ?? null,
      },
      biologicalSex: user?.biologicalSex ?? null,
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
