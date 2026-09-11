/**
 * `ProtocolRenewalScheduler` — detecta o vencimento do mesociclo vigente e dispara o
 * formulário de troca de protocolo.
 *
 * Mesmo desenho de `CheckinScheduler`: cron diário (`SCAN`) que varre `protocols`
 * `ACTIVE` com `endDate` já alcançado, cria a sessão do formulário
 * (`protocol_renewal_sessions`) e enfileira o convite por WhatsApp. Vive dentro de
 * `ProtocolModule` (não em `ProtocolRenewalModule`) porque lê/decide sobre `protocols` —
 * a regra de fronteira (§12.5) é sobre módulos de domínio não se importarem uns aos
 * outros via NestJS DI, não sobre não ler a tabela de outro domínio via schema
 * (`CheckinService` já lê `protocols` do mesmo jeito).
 *
 * Decisão do fundador: dispara exatamente na data de vencimento (`endDate <= now`), não
 * dias antes — e o protocolo vencido continua `ACTIVE` até o próximo ser assinado/
 * auto-liberado (`ProtocolRepository.autoRelease`/`supersedePreviousActiveProtocols`),
 * então o titular nunca fica sem protocolo vigente durante a espera.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { CONSENT_TEXTS } from '@movivo/shared';

import { AppConfigService } from '../../core/config';
import {
  consents,
  protocolRenewalSessions,
  protocols,
  subscriptions,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { mesocycleRenewalMessage } from '../whatsapp/message-templates';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';

type RenewalScanJob = { kind: 'SCAN' };

/** TTL do link do formulário — mais longo que o da anamnese (14 dias): o titular já é
 *  conhecido e precisa poder retomar de qualquer dispositivo em dias diferentes. */
const RENEWAL_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class ProtocolRenewalScheduler implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProtocolRenewalScheduler.name);
  }

  async onModuleInit(): Promise<void> {
    this.workers.create<RenewalScanJob>(QUEUE.protocolRenewalScan, () => this.scan());

    await this.queues
      .get(QUEUE.protocolRenewalScan)
      .upsertJobScheduler(
        'protocol-renewal-scan',
        { pattern: '0 9 * * *', tz: 'America/Sao_Paulo' },
        { name: 'protocol-renewal-scan', data: { kind: 'SCAN' } satisfies RenewalScanJob },
      );
  }

  async scan(): Promise<{ status: string; created: number }> {
    const now = new Date();
    const eligible = await this.db.runAsSystem((tx) =>
      tx
        .selectDistinct({
          userId: protocols.userId,
          protocolId: protocols.id,
          name: users.name,
        })
        .from(protocols)
        .innerJoin(users, eq(users.id, protocols.userId))
        .innerJoin(subscriptions, eq(subscriptions.userId, protocols.userId))
        .innerJoin(
          consents,
          and(
            eq(consents.userId, protocols.userId),
            eq(consents.consentType, 'HEALTH_DATA'),
            eq(consents.version, CONSENT_TEXTS.HEALTH_DATA.version),
            eq(consents.accepted, true),
            isNull(consents.revokedAt),
          ),
        )
        .where(
          and(
            eq(protocols.status, 'ACTIVE'),
            lte(protocols.endDate, now),
            inArray(subscriptions.status, ['ACTIVE', 'TRIALING']),
          ),
        ),
    );

    let created = 0;
    for (const row of eligible) {
      const startedRenewal = await this.startRenewal(row.userId, row.protocolId, row.name);
      if (startedRenewal) created += 1;
    }
    this.logger.info(
      { event: 'protocol_renewal_scan_completed', eligible: eligible.length, created },
      'scan de vencimento de mesociclo concluído',
    );
    return { status: 'SCANNED', created };
  }

  /**
   * `onConflictDoNothing` no índice único de `previousProtocolId` é a idempotência real:
   * mesmo que o scan rode mais de uma vez sobre o mesmo protocolo vencido (retry de fila,
   * reexecução manual), nunca cria uma segunda sessão nem manda um segundo convite.
   */
  private async startRenewal(
    userId: string,
    protocolId: string,
    name: string | null,
  ): Promise<boolean> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RENEWAL_SESSION_TTL_MS);

    const created = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .insert(protocolRenewalSessions)
        .values({ userId, previousProtocolId: protocolId, token, expiresAt })
        .onConflictDoNothing({ target: protocolRenewalSessions.previousProtocolId })
        .returning({ id: protocolRenewalSessions.id });
      return row;
    });
    if (!created) return false;

    const link = `${this.config.whatsapp.publicSiteUrl}/mesociclo/${token}`;
    const firstName = name?.trim().split(/\s+/)[0] ?? null;
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'mesocycle-renewal-invite',
      {
        userId,
        type: 'MESOCYCLE_RENEWAL_INVITE',
        dedupeId: `renewal-invite-${created.id}`,
        text: mesocycleRenewalMessage(firstName, link),
      },
      { jobId: `wa-renewal-invite-${created.id}` },
    );
    this.logger.info(
      { event: 'protocol_renewal_started', userId, protocolId, renewalSessionId: created.id },
      'convite de renovação de mesociclo enfileirado',
    );
    return true;
  }
}
