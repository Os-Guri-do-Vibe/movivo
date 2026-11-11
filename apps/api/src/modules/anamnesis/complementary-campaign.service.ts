import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { CONSENT_TEXTS } from '@movivo/shared';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { anamnesisSessions, consents, subscriptions, users } from '../../core/database/schema';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { ComplementaryInviteService } from './complementary-invite.service';

export interface CampaignResult {
  invited: number;
  failed: number;
}

/** Texto do convite: sem promessa de resultado e com o motivo do novo aceite. */
export function complementaryInviteMessage(firstName: string | null, url: string): string {
  const greeting = firstName ? `Oi, ${firstName}!` : 'Oi!';
  return (
    `${greeting} A MOVIVO ficou mais completa: agora o seu plano reúne treino e alimentação, ` +
    'com profissionais de cada área e a IA como apoio. Para continuar recebendo as suas sessões, ' +
    'revise os textos atualizados e responda algumas perguntas novas (leva poucos minutos). ' +
    `Seus dados anteriores já vêm preenchidos: ${url}`
  );
}

/**
 * Campanha da anamnese complementar: convida, uma vez, cada aluno ativo que ainda não aceitou os
 * textos vigentes. Quem revogou o consentimento de saúde não é convidado, e quem já recebeu um
 * link ainda válido não recebe outro. O envio usa `CONSENT_STATUS` (aviso), único tipo que sai
 * antes de existir consentimento vigente.
 */
@Injectable()
export class ComplementaryCampaignService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly invites: ComplementaryInviteService,
    private readonly queues: QueueManager,
  ) {}

  async run(): Promise<CampaignResult> {
    const targets = await this.targets();
    let invited = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        const { url, expiresAt } = await this.invites.createLink(target.id);
        await this.queues.enqueue(
          QUEUE.whatsappOutbound,
          'complementary-invite',
          {
            userId: target.id,
            type: 'CONSENT_STATUS',
            dedupeId: `complementary-invite-${expiresAt.getTime()}`,
            text: complementaryInviteMessage(target.name?.trim().split(/\s+/)[0] ?? null, url),
          },
          { jobId: `complementary-invite_${target.id}_${expiresAt.getTime()}` },
        );
        invited += 1;
      } catch {
        failed += 1;
      }
    }
    return { invited, failed };
  }

  private async targets(): Promise<Array<{ id: string; name: string | null }>> {
    return this.db.runAsSystem((tx) =>
      tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          and(
            eq(users.role, 'USER'),
            isNull(users.anonymizedAt),
            sql`exists (select 1 from ${subscriptions} where ${subscriptions.userId} = ${users.id}
              and ${inArray(subscriptions.status, ['ACTIVE', 'TRIALING', 'PAST_DUE'])})`,
            // Sem aceite vigente do texto de saúde...
            notExists(
              tx
                .select({ one: sql`1` })
                .from(consents)
                .where(
                  and(
                    eq(consents.userId, users.id),
                    eq(consents.consentType, 'HEALTH_DATA'),
                    eq(consents.version, CONSENT_TEXTS.HEALTH_DATA.version),
                    eq(consents.accepted, true),
                    isNull(consents.revokedAt),
                  ),
                ),
            ),
            // ...e sem revogação: quem revogou escolheu parar.
            notExists(
              tx
                .select({ one: sql`1` })
                .from(consents)
                .where(
                  and(
                    eq(consents.userId, users.id),
                    eq(consents.consentType, 'HEALTH_DATA'),
                    sql`${consents.revokedAt} is not null`,
                  ),
                ),
            ),
            // ...e sem convite ainda válido.
            notExists(
              tx
                .select({ one: sql`1` })
                .from(anamnesisSessions)
                .where(
                  and(
                    eq(anamnesisSessions.userId, users.id),
                    eq(anamnesisSessions.flow, 'COMPLEMENTARY'),
                    eq(anamnesisSessions.status, 'IN_PROGRESS'),
                    gt(anamnesisSessions.expiresAt, new Date()),
                  ),
                ),
            ),
          ),
        ),
    );
  }
}
