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
import { and, desc, eq } from 'drizzle-orm';
import type { BiologicalSex } from '@movivo/shared';

import { conversations, handoffAlerts, users } from '../../core/database/schema';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
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
    private readonly cipher: HealthCipherService,
    private readonly conversationEvents: ConversationEventsService,
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
    /** Fuso do aluno: "ontem", "hoje" e a idade da pergunta pendente são locais a ele. */
    timezone: string;
  }> {
    const [user] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          name: users.name,
          phoneNumber: users.phoneNumber,
          email: users.email,
          biologicalSex: users.biologicalSex,
          timezone: users.timezone,
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
      timezone: user?.timezone ?? 'America/Sao_Paulo',
    };
  }

  /** Persiste um alerta de handoff consultável sob RLS (US-3.6). Consumido no painel (Sprint 5). */
  async persistHandoff(userId: string, level: 'ALERT' | 'SAFETY', reason: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      // O alerta precisa apontar para a pergunta que o causou. O worker mantém um lock por
      // aluno e persiste a entrada antes de avaliar a mensagem, portanto este é exatamente o
      // último turno INBOUND do caso — sem repetir o texto sensível em `handoff_alerts`.
      const [trigger] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.userId, userId), eq(conversations.direction, 'INBOUND')))
        .orderBy(desc(conversations.createdAt))
        .limit(1);
      await tx.insert(handoffAlerts).values({
        userId,
        level,
        reason,
        conversationId: trigger?.id ?? null,
      });
    });
    this.queueEvents.emit('handoff');
  }

  async persistTurn(input: PersistTurnInput): Promise<void> {
    const content = await this.cipher.encryptText(input.content);
    await this.db.runAsUser(input.userId, 'USER', async (tx) => {
      await tx.insert(conversations).values({
        userId: input.userId,
        direction: input.direction,
        origin: input.direction === 'INBOUND' ? 'STUDENT' : 'COACH',
        // O turno agregado do aluno é contexto da IA: o painel mostra cada mensagem dele pela
        // linha-espelho do webhook (sem isso a fala apareceria duas vezes).
        hiddenInPanel: input.direction === 'INBOUND',
        content,
        validationPassed: input.validationPassed ?? null,
        modelUsed: input.modelUsed ?? null,
        latencyMs: input.latencyMs ?? null,
        ragSources: input.ragSources?.length ? input.ragSources : null,
      });
    });
    // O aviso do turno do aluno já saiu quando o espelho gravou a mensagem.
    if (input.direction === 'OUTBOUND')
      this.conversationEvents.emitMessage(input.userId, 'OUTBOUND');
  }
}
