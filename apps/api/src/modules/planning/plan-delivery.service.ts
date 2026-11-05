/**
 * Entrega do plano ao aluno pelo WhatsApp: o link da página do plano, emitido de novo a cada
 * versão publicada. Usado tanto pela publicação automática quanto pela aprovação do profissional.
 */
import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { MOVIVO_CLUB_URL } from '@movivo/shared';

import { AppConfigService } from '../../core/config';
import { AccessLinkService } from '../../core/database/access-link.service';
import { nutritionPlans, trainingPlans } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import {
  WHATSAPP_BUBBLE_SEPARATOR,
  type WhatsappOutboundJob,
} from '../jobs/whatsapp-outbound.contract';
import type { PlanPdfKind } from './plan-pdf';

/** O link do plano vale por 90 dias (reemitido a cada versão publicada). */
const PLAN_LINK_TTL_MS = 90 * 86_400_000;

@Injectable()
export class PlanDelivery {
  constructor(
    private readonly db: TenantDatabase,
    private readonly accessLinks: AccessLinkService,
    private readonly queues: QueueManager,
    private readonly config: AppConfigService,
  ) {}

  /** Envia o link só quando treino e alimentação estão ativos: o aluno nunca recebe o plano pela metade. */
  async sendWhenComplete(userId: string): Promise<boolean> {
    const active = await this.db.runAsSystem(async (tx) => {
      const [training] = await tx
        .select({ id: trainingPlans.id })
        .from(trainingPlans)
        .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')))
        .limit(1);
      const [nutrition] = await tx
        .select({ id: nutritionPlans.id })
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')))
        .limit(1);
      return training !== undefined && nutrition !== undefined;
    });
    return active ? this.sendPlanLink(userId) : false;
  }

  /**
   * Depois de publicar um plano: o primeiro plano do aluno segue o fluxo completo (link + os dois
   * PDFs). Se ele já tinha um plano daquele domínio, é uma atualização: o aluno recebe o link e só o
   * PDF do que mudou, com a explicação de que o anterior foi substituído.
   */
  async sendAfterPublish(userId: string, domain: 'TRAINING' | 'NUTRITION'): Promise<boolean> {
    return (await this.hadPreviousPlan(userId, domain))
      ? this.sendUpdate(userId, domain)
      : this.sendWhenComplete(userId);
  }

  async sendUpdate(userId: string, domain: 'TRAINING' | 'NUTRITION'): Promise<boolean> {
    const { token } = await this.accessLinks.issue('PLAN', userId, userId, PLAN_LINK_TTL_MS);
    const url = `${this.config.whatsapp.publicSiteUrl}/plano/${token}`;
    const kind: PlanPdfKind = domain === 'TRAINING' ? 'treino' : 'alimentacao';
    const pdf = `${this.config.apiPublicUrl}/${this.config.globalPrefix}/plans/by-token/${token}/pdf/${kind}`;
    const dedupeId = `plan-updated_${domain}_${userId}_${Date.now()}`;
    const bubbles =
      domain === 'NUTRITION'
        ? [
            'Atualizei o seu plano alimentar a partir do que a gente viu no seu acompanhamento. O novo substitui o anterior.',
            `Veja por aqui: ${url}`,
            'Mandei o PDF atualizado para você guardar. Se algo não combinar com a sua rotina, é só responder que eu ajusto.',
          ]
        : [
            'Atualizei o seu protocolo de treino a partir do que a gente viu no seu acompanhamento. O novo substitui o anterior.',
            `Veja por aqui: ${url}`,
            'Mandei o PDF atualizado para você guardar. Se algo não combinar com a sua rotina, é só responder que eu ajusto.',
          ];
    const job: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      dedupeId,
      text: bubbles.join(WHATSAPP_BUBBLE_SEPARATOR),
      documents: [
        domain === 'NUTRITION'
          ? {
              url: pdf,
              fileName: 'MOVIVO-protocolo-alimentar.pdf',
              caption: 'Protocolo alimentar atualizado: metas do dia, refeições e orientações.',
            }
          : {
              url: pdf,
              fileName: 'MOVIVO-protocolo-de-treino.pdf',
              caption: 'Protocolo de treino atualizado: sua semana e cada sessão em detalhe.',
            },
      ],
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'plan-updated', job, { jobId: dedupeId });
    return true;
  }

  /** O aluno já teve um plano publicado desse domínio (ativo substituído ou ainda ativo)? */
  private async hadPreviousPlan(userId: string, domain: 'TRAINING' | 'NUTRITION') {
    const table = domain === 'TRAINING' ? trainingPlans : nutritionPlans;
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.userId, userId), inArray(table.status, ['ACTIVE', 'SUPERSEDED'])))
        .limit(2),
    );
    return rows.length >= 2;
  }

  async sendPlanLink(userId: string): Promise<boolean> {
    const { token } = await this.accessLinks.issue('PLAN', userId, userId, PLAN_LINK_TTL_MS);
    const url = `${this.config.whatsapp.publicSiteUrl}/plano/${token}`;
    // A EvolutionAPI baixa o PDF por URL: gerado na hora pela API, só com o token do link.
    const pdf = (kind: PlanPdfKind) =>
      `${this.config.apiPublicUrl}/${this.config.globalPrefix}/plans/by-token/${token}/pdf/${kind}`;
    const dedupeId = `plan-ready_${userId}_${Date.now()}`;
    const bubbles = [
      'Seu protocolo de treino e alimentação está pronto. Ele foi montado a partir do que você contou e revisado pelos profissionais de Educação Física e Nutrição da MOVIVO.',
      `Veja o plano completo aqui: ${url}`,
      'Também mandei os dois PDFs para você guardar. Se algo não combinar com a sua rotina, é só responder por aqui que a gente ajusta.',
    ];
    if (await this.isFirstDelivery(userId)) {
      bubbles.push(
        `E se ainda não entrou: o MOVIVO CLUB é a nossa comunidade no WhatsApp, com quem também está construindo consistência. ${MOVIVO_CLUB_URL}`,
      );
    }
    const job: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      dedupeId,
      text: bubbles.join(WHATSAPP_BUBBLE_SEPARATOR),
      documents: [
        {
          url: pdf('treino'),
          fileName: 'MOVIVO-protocolo-de-treino.pdf',
          caption: 'Protocolo de treino: sua semana e cada sessão em detalhe.',
        },
        {
          url: pdf('alimentacao'),
          fileName: 'MOVIVO-protocolo-alimentar.pdf',
          caption: 'Protocolo alimentar: metas do dia, refeições e orientações.',
        },
      ],
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'plan-ready', job, { jobId: dedupeId });
    return true;
  }

  /** Só a primeira versão publicada leva o convite do CLUB (ajustes depois não repetem). */
  private async isFirstDelivery(userId: string): Promise<boolean> {
    const published = await this.db.runAsSystem((tx) =>
      tx
        .select({ id: trainingPlans.id })
        .from(trainingPlans)
        .where(
          and(
            eq(trainingPlans.userId, userId),
            inArray(trainingPlans.status, ['ACTIVE', 'SUPERSEDED']),
          ),
        )
        .limit(2),
    );
    return published.length <= 1;
  }
}
