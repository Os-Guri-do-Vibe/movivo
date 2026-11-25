/**
 * Cartão de compartilhamento de um treino registrado: monta os dados a partir do que o aluno
 * gravou (séries, números do relógio, fechamento) e desenha o modelo escolhido.
 *
 * Só treino fechado (concluído ou em parte) tem cartão. Os músculos saem do catálogo de
 * exercícios (nunca do nome do exercício), e a silhueta segue o sexo biológico do cadastro;
 * sem ele, o modelo "Músculos" não é oferecido em vez de presumir um corpo.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import {
  shareCardDataOf,
  shareCardLayoutsFor,
  type ShareCardData,
  type ShareCardOptions,
  type ShareCardRequest,
  type SessionContent,
} from '@movivo/shared';

import {
  executionMetrics,
  executionSets,
  planSessions,
  sessionExecutions,
  users,
} from '../../../core/database/schema';
import { TenantDatabase } from '../../../core/database/tenant-database.service';
import { ExerciseCatalogProvider } from '../../catalog/exercises/exercise-catalog-provider.service';
import { ShareCardRenderer, type ShareCardImage } from './share-card-renderer.service';

@Injectable()
export class ShareCardService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly catalog: ExerciseCatalogProvider,
    private readonly renderer: ShareCardRenderer,
  ) {}

  /** Os modelos disponíveis e os dados do cartão de um treino fechado. */
  async options(userId: string, executionId: string): Promise<ShareCardOptions> {
    const data = await this.dataOf(userId, executionId);
    return { data, layouts: shareCardLayoutsFor(data) };
  }

  async image(
    userId: string,
    executionId: string,
    request: ShareCardRequest,
  ): Promise<ShareCardImage> {
    const data = await this.dataOf(userId, executionId);
    if (!shareCardLayoutsFor(data).includes(request.layout)) {
      throw new BadRequestException('Este modelo não está disponível para este treino.');
    }
    return this.renderer.render({ data, ...request });
  }

  /** Pré-visualização a partir de dados enviados (demonstração local). */
  preview(data: ShareCardData, request: ShareCardRequest): Promise<ShareCardImage> {
    if (!shareCardLayoutsFor(data).includes(request.layout)) {
      throw new BadRequestException('Este modelo não está disponível para estes dados.');
    }
    return this.renderer.render({ data, ...request });
  }

  private async dataOf(userId: string, executionId: string): Promise<ShareCardData> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({ execution: sessionExecutions, plan: planSessions })
        .from(sessionExecutions)
        .leftJoin(planSessions, eq(planSessions.id, sessionExecutions.planSessionId))
        .where(and(eq(sessionExecutions.id, executionId), eq(sessionExecutions.userId, userId)));
      if (!row) throw new NotFoundException();
      const { execution, plan } = row;
      if (execution.status !== 'COMPLETED' && execution.status !== 'PARTIAL') {
        throw new BadRequestException('O cartão fica disponível depois de concluir o treino.');
      }
      const sets = await tx
        .select()
        .from(executionSets)
        .where(eq(executionSets.executionId, executionId));
      const [metrics] = await tx
        .select()
        .from(executionMetrics)
        .where(eq(executionMetrics.executionId, executionId));
      const [user] = await tx
        .select({ biologicalSex: users.biologicalSex })
        .from(users)
        .where(eq(users.id, userId));
      return shareCardDataOf({
        modality: execution.modality as ShareCardData['modality'],
        title: plan?.title ?? '',
        content: (plan?.content as SessionContent | undefined) ?? null,
        rpe: execution.rpe,
        durationMinutes: execution.durationMinutes,
        sets,
        // Número lido de arquivo e não confirmado pelo aluno não vai para a imagem.
        metrics: metrics?.confirmed ? metrics.metrics : null,
        biologicalSex: user?.biologicalSex ?? null,
        muscleGroupsOf: (id) => this.catalog.getById(id)?.muscleGroups ?? [],
      });
    });
  }
}
