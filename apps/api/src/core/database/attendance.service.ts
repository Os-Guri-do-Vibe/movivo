import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { users } from './schema';
import { TenantDatabase } from './tenant-database.service';

/**
 * Pausa do atendimento automático, por titular (aba "Conversas" do painel).
 *
 * Fica no CORE porque três domínios precisam do mesmo estado e nenhum pode importar o outro
 * (`ARQUITETURA.md` §12.5): o inbound do WhatsApp (não enfileira a IA), o worker da IA
 * (descarta um job já enfileirado) e o painel (liga/desliga). Pausado, a mensagem do aluno é
 * só registrada no histórico e quem responde é um humano.
 */
@Injectable()
export class AttendanceService {
  constructor(private readonly db: TenantDatabase) {}

  async isPaused(userId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), isNotNull(users.attendancePausedAt)))
        .limit(1),
    );
    return rows.length > 0;
  }

  /**
   * Pausa (`true`) ou reativa (`false`). Idempotente: pausar de novo não renova a data de
   * início. Devolve `true` quando o estado de fato mudou.
   */
  async setPaused(userId: string, paused: boolean): Promise<boolean> {
    const changed = await this.db.runAsSystem((tx) =>
      tx
        .update(users)
        .set(
          paused
            ? { attendancePausedAt: new Date(), updatedAt: new Date() }
            : { attendancePausedAt: null, updatedAt: new Date() },
        )
        .where(
          and(
            eq(users.id, userId),
            eq(users.role, 'USER'),
            paused ? isNull(users.attendancePausedAt) : isNotNull(users.attendancePausedAt),
          ),
        )
        .returning({ id: users.id }),
    );
    return changed.length > 0;
  }
}
