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
import { ShortLinkService } from '../short-link/short-link.service';

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
    private readonly shortLinks: ShortLinkService,
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
          renewalSessionId: protocolRenewalSessions.id,
          renewalStatus: protocolRenewalSessions.status,
          renewalExpiresAt: protocolRenewalSessions.expiresAt,
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
        // LEFT JOIN (não INNER): a maioria dos protocolos vencidos ainda não tem sessão
        // nenhuma — é exatamente o caso que cria uma pela primeira vez.
        .leftJoin(
          protocolRenewalSessions,
          eq(protocolRenewalSessions.previousProtocolId, protocols.id),
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
      if (!this.needsInvite(row.renewalStatus, row.renewalExpiresAt, now)) continue;
      const startedRenewal = await this.startOrReissueRenewal(
        row.userId,
        row.protocolId,
        row.name,
        row.renewalSessionId,
      );
      if (startedRenewal) created += 1;
    }
    this.logger.info(
      { event: 'protocol_renewal_scan_completed', eligible: eligible.length, created },
      'scan de vencimento de mesociclo concluído',
    );
    return { status: 'SCANNED', created };
  }

  /**
   * Achado 2026-09-11 (ADR-008 §8.1) — bug de ciclo de vida corrigido aqui: o convite era
   * irrepetível (`onConflictDoNothing` sozinho travava para sempre depois da 1ª sessão).
   * Sem sessão nenhuma → convite novo. Sessão `EXPIRED` → reconvite. Sessão `IN_PROGRESS`
   * cujo TTL já passou mas que ainda não foi acessada (a marcação de `EXPIRED` é
   * preguiçosa, só acontece no acesso — `ProtocolRenewalService.assertActive`) → mesmo
   * tratamento de `EXPIRED`. `IN_PROGRESS` dentro do TTL ou `SUBMITTED` → nada a fazer,
   * não reenvia convite pra quem já está respondendo ou já respondeu.
   */
  private needsInvite(status: string | null, expiresAt: Date | null, now: Date): boolean {
    if (status === null) return true;
    if (status === 'EXPIRED') return true;
    return status === 'IN_PROGRESS' && expiresAt !== null && expiresAt.getTime() < now.getTime();
  }

  /**
   * Cria a sessão de renovação (1ª vez) ou reconvida sobre a MESMA linha quando ela já
   * expirou (`existingSessionId` presente) — o índice único de `previous_protocol_id`
   * exige isto: nunca pode existir uma SEGUNDA linha para o mesmo protocolo vencido.
   * `onConflictDoNothing` continua sendo a idempotência real do caminho de criação: um
   * retry de fila/reexecução manual sobre o MESMO protocolo, na MESMA passagem do scan,
   * nunca cria uma segunda sessão nem manda um segundo convite.
   */
  private async startOrReissueRenewal(
    userId: string,
    protocolId: string,
    name: string | null,
    existingSessionId: string | null,
  ): Promise<boolean> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RENEWAL_SESSION_TTL_MS);

    const sessionId = await this.db.runAsSystem(async (tx) => {
      if (existingSessionId) {
        const [row] = await tx
          .update(protocolRenewalSessions)
          .set({ token, expiresAt, status: 'IN_PROGRESS' })
          .where(eq(protocolRenewalSessions.id, existingSessionId))
          .returning({ id: protocolRenewalSessions.id });
        return row?.id ?? null;
      }
      const [row] = await tx
        .insert(protocolRenewalSessions)
        .values({ userId, previousProtocolId: protocolId, token, expiresAt })
        .onConflictDoNothing({ target: protocolRenewalSessions.previousProtocolId })
        .returning({ id: protocolRenewalSessions.id });
      return row?.id ?? null;
    });
    if (!sessionId) return false;

    const longLink = `${this.config.whatsapp.publicSiteUrl}/mesociclo/${token}`;
    const code = await this.shortLinks.create(longLink, expiresAt);
    const link = `${this.config.whatsapp.publicSiteUrl}/renovacao/${code}`;
    const firstName = name?.trim().split(/\s+/)[0] ?? null;
    // `dedupeId`/`jobId` levam o token (novo a cada reconvite) — nunca colidem com o job
    // do convite anterior à mesma sessão, que já foi processado/mantido no histórico do
    // BullMQ; sem isso, um reconvite reusando o `jobId` original seria descartado como
    // "já existe" e o WhatsApp nunca sairia.
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'mesocycle-renewal-invite',
      {
        userId,
        type: 'MESOCYCLE_RENEWAL_INVITE',
        dedupeId: `renewal-invite-${sessionId}-${token}`,
        text: mesocycleRenewalMessage(firstName, link),
      },
      { jobId: `wa-renewal-invite-${sessionId}-${token}` },
    );
    this.logger.info(
      {
        event: existingSessionId ? 'protocol_renewal_reissued' : 'protocol_renewal_started',
        userId,
        protocolId,
        renewalSessionId: sessionId,
      },
      existingSessionId
        ? 'reconvite de renovação de mesociclo enfileirado (sessão anterior expirada)'
        : 'convite de renovação de mesociclo enfileirado',
    );
    return true;
  }
}
