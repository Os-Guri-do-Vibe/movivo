/** Persistência da conversa (cifrada) e leitura do titular, sob RLS. */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { conversations, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ConversationEventsService } from '../../core/event-bus/conversation-events.service';

@Injectable()
export class ConversationStore {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly events: ConversationEventsService,
  ) {}

  async persistTurn(input: {
    userId: string;
    direction: 'INBOUND' | 'OUTBOUND';
    content: string;
    validationPassed?: boolean;
    modelUsed?: string | null;
  }): Promise<void> {
    const content = await this.cipher.encryptText(input.content);
    await this.db.runAsUser(input.userId, 'USER', (tx) =>
      tx.insert(conversations).values({
        userId: input.userId,
        direction: input.direction,
        origin: input.direction === 'INBOUND' ? 'STUDENT' : 'COACH',
        // O turno agregado do aluno é contexto: o painel mostra cada mensagem pelo espelho do webhook.
        hiddenInPanel: input.direction === 'INBOUND',
        content,
        validationPassed: input.validationPassed ?? null,
        modelUsed: input.modelUsed ?? null,
      }),
    );
    if (input.direction === 'OUTBOUND') this.events.emitMessage(input.userId, 'OUTBOUND');
  }

  async loadUser(userId: string): Promise<{ firstName: string | null; timezone: string }> {
    const [user] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId)),
    );
    return {
      firstName: user?.name?.trim().split(/\s+/)[0] ?? null,
      timezone: user?.timezone ?? 'America/Sao_Paulo',
    };
  }
}
