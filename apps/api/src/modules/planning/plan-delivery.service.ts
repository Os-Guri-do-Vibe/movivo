/**
 * Entrega dos protocolos ao aluno pelo WhatsApp. Usado tanto pela publicação automática quanto
 * pela aprovação do profissional.
 *
 * Fluxo v2 (copy do Bruno, 2026-11-10): a MOVIVO entrega DOIS protocolos, treino e alimentar, como
 * dois PDFs gerados na hora do envio e mandados como arquivo. NENHUMA mensagem leva link (nem página
 * do plano, nem comunidade): o aluno guarda os PDFs e tira dúvidas respondendo a conversa.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { nutritionPlans, trainingPlans, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { PlanDocumentRegistry, type PlanDocumentKind } from '../jobs/plan-document.registry';
import { QueueManager } from '../jobs/queue-manager.service';
import {
  WHATSAPP_BUBBLE_SEPARATOR,
  type WhatsappDocument,
  type WhatsappOutboundJob,
} from '../jobs/whatsapp-outbound.contract';
import { PlanViewService } from './plan-view.service';
import { nutritionPlanPdf, protocolPdfFileName, trainingPlanPdf } from './protocol-pdf';

/** Primeira entrega: os dois protocolos, com o que cada PDF traz. */
export function protocolsReadyBubbles(firstName: string | null): string[] {
  return [
    firstName
      ? `${firstName}, seus protocolos de treino e alimentar estão prontos 💚`
      : 'Seus protocolos de treino e alimentar estão prontos 💚',
    'Nossos agentes montaram os dois a partir do que você contou na anamnese, e profissionais de Educação Física (CREF) e Nutrição (CRN) revisaram tudo. Eles chegam logo abaixo, em PDF.',
    'Salve os dois arquivos no celular: assim você consulta o treino na hora de treinar e as refeições na hora de montar o prato, até sem internet. Se algo não combinar com a sua rotina, é só responder esta conversa que a gente vê o ajuste com você.',
  ];
}

export const PROTOCOLS_READY_DOCUMENTS: readonly WhatsappDocument[] = [
  {
    plan: 'treino',
    caption: '*Protocolo de treino*: sua semana e cada sessão em detalhe.',
  },
  {
    plan: 'alimentacao',
    caption: '*Protocolo alimentar*: metas do dia, refeições e orientações.',
  },
];

/**
 * Atualização de um protocolo só. Não diz quem revisou: o ajuste pode vir do profissional ou do
 * agente (a nutricionista autônoma refaz o alimentar), e o texto continua verdadeiro nos dois casos.
 */
export function protocolUpdatedBubbles(
  domain: 'TRAINING' | 'NUTRITION',
  firstName: string | null,
): string[] {
  const what = domain === 'TRAINING' ? 'protocolo de treino' : 'protocolo alimentar';
  return [
    firstName
      ? `${firstName}, ajustamos seu ${what} com base no seu acompanhamento.`
      : `Ajustamos seu ${what} com base no seu acompanhamento.`,
    'O PDF abaixo substitui o anterior: a partir de agora, siga só este. Se algo não encaixar na sua rotina, é só responder aqui.',
  ];
}

export function protocolUpdatedDocument(domain: 'TRAINING' | 'NUTRITION'): WhatsappDocument {
  return domain === 'TRAINING'
    ? {
        plan: 'treino',
        caption: '*Protocolo de treino atualizado*: substitui a versão anterior.',
      }
    : {
        plan: 'alimentacao',
        caption: '*Protocolo alimentar atualizado*: substitui a versão anterior.',
      };
}

@Injectable()
export class PlanDelivery implements OnModuleInit {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    private readonly plans: PlanViewService,
    private readonly planDocuments: PlanDocumentRegistry,
  ) {}

  /** O envio pelo WhatsApp pede o PDF por aqui: gerado na hora, a partir do protocolo vigente. */
  onModuleInit(): void {
    this.planDocuments.register({ render: (userId, kind) => this.renderPdf(userId, kind) });
  }

  async renderPdf(userId: string, kind: PlanDocumentKind) {
    const plan = await this.plans.read(userId);
    if (!plan) return null;
    const student = await this.plans.readStudent(userId);
    const fullName = student.fullName?.trim() || plan.firstName;
    if (kind === 'treino') {
      return plan.training
        ? {
            buffer: await trainingPlanPdf(plan, student),
            fileName: protocolPdfFileName(kind, fullName),
          }
        : null;
    }
    return plan.nutrition
      ? {
          buffer: await nutritionPlanPdf(plan, student),
          fileName: protocolPdfFileName(kind, fullName),
        }
      : null;
  }

  /** Envia só quando treino e alimentação estão ativos: o aluno nunca recebe o plano pela metade. */
  async sendWhenComplete(userId: string, idempotencyKey?: string): Promise<boolean> {
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
    return active ? this.sendProtocols(userId, idempotencyKey) : false;
  }

  /**
   * Depois de publicar um plano: o primeiro plano do aluno segue o fluxo completo (os dois PDFs).
   * Se ele já tinha um plano daquele domínio, é uma atualização: só o PDF do que mudou.
   */
  async sendAfterPublish(
    userId: string,
    domain: 'TRAINING' | 'NUTRITION',
    idempotencyKey?: string,
  ): Promise<boolean> {
    return (await this.hadPreviousPlan(userId, domain))
      ? this.sendUpdate(userId, domain, idempotencyKey)
      : this.sendWhenComplete(userId, idempotencyKey);
  }

  /**
   * `idempotencyKey` (o id do plano publicado) torna a mensagem idempotente: repetir a chamada
   * para o mesmo plano reaproveita o mesmo `dedupeId` e o aluno recebe uma vez só.
   */
  async sendUpdate(
    userId: string,
    domain: 'TRAINING' | 'NUTRITION',
    idempotencyKey?: string,
  ): Promise<boolean> {
    const dedupeId = `plan-updated_${domain}_${userId}_${idempotencyKey ?? Date.now()}`;
    const job: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      dedupeId,
      text: protocolUpdatedBubbles(domain, await this.firstName(userId)).join(
        WHATSAPP_BUBBLE_SEPARATOR,
      ),
      documents: [protocolUpdatedDocument(domain)],
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'plan-updated', job, { jobId: dedupeId });
    return true;
  }

  /** Primeira entrega: as três mensagens e os dois PDFs (treino e alimentar), sem link. */
  async sendProtocols(userId: string, idempotencyKey?: string): Promise<boolean> {
    const dedupeId = `plan-ready_${userId}_${idempotencyKey ?? Date.now()}`;
    const job: WhatsappOutboundJob = {
      userId,
      type: 'CONVERSATION_MESSAGE',
      dedupeId,
      text: protocolsReadyBubbles(await this.firstName(userId)).join(WHATSAPP_BUBBLE_SEPARATOR),
      documents: PROTOCOLS_READY_DOCUMENTS,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'plan-ready', job, { jobId: dedupeId });
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

  private async firstName(userId: string): Promise<string | null> {
    const [user] = await this.db.runAsSystem((tx) =>
      tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    );
    return user?.name?.trim().split(/\s+/)[0] || null;
  }
}
