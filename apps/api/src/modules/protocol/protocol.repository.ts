/**
 * Persistência do protocolo sob RLS (US-2.4 / TASK-2.4.3).
 *
 * `protocols` guarda o estado vigente (v1 nesta sprint); `protocol_versions` guarda o
 * snapshot imutável da versão. Ambas sob `FORCE ROW LEVEL SECURITY` → toda escrita/leitura
 * passa pelo `TenantDatabase` no contexto do titular, nunca por conexão crua.
 *
 * Idempotência: `UNIQUE(user_id, version)`. O Worker já pré-checa (evita chamar o LLM de
 * novo), e o `persist` trata a corrida com o código 23505 como "já existe" (backstop).
 */
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type {
  ProtocolApprovalStatus,
  ProtocolRead,
  ProtocolReviewUrgency,
  ProtocolStatus,
  ProtocolStructure,
} from '@movivo/shared';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { protocols, protocolVersions } from '../../core/database/schema';
import type { ContraindicationTag } from './exercise-catalog';

/**
 * Id da assinatura da metodologia do RT CREF. ponytail: constante fixa — a tabela
 * `professionals` e a FK nascem na Sprint 5 (dashboard CREF). Trocar por lookup real lá.
 */

/** SHA-256 do conteúdo — prova, meses depois, que o entregue é o que foi assinado. */
export function signatureHash(content: ProtocolStructure): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export interface PersistProtocolInput {
  userId: string;
  content: ProtocolStructure;
  constraints: unknown;
  parqFlags: ContraindicationTag[];
  approvalStatus: ProtocolApprovalStatus;
  status: ProtocolStatus;
  humanReviewRequired: boolean;
  reviewUrgency: ProtocolReviewUrgency | null;
  totalWeeks: number;
  generatedBy: string;
  modelVersion: string | null;
  promptVersion: string;
  /** `AUTO_APPROVED` assina em nível de metodologia (RT); demais nascem sem assinatura. */
  signed: boolean;
}

export interface PersistedProtocol {
  protocolId: string;
  version: number;
  professionalId: string | null;
  /** `true` quando outra execução já havia persistido (corrida — idempotência). */
  alreadyExisted: boolean;
}

const PROTOCOL_VERSION = 1;

@Injectable()
export class ProtocolRepository {
  constructor(private readonly db: TenantDatabase) {}

  /** Já existe protocolo v1 para o titular? (pré-checagem de idempotência do Worker). */
  async existsForUser(userId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: protocols.id })
        .from(protocols)
        .where(and(eq(protocols.userId, userId), eq(protocols.version, PROTOCOL_VERSION)))
        .limit(1),
    );
    return rows.length > 0;
  }

  /**
   * Leitura read-only por token da página pública (US-2.6). O `token` É o `protocolId`
   * (UUID v4 não-enumerável) — o próprio segredo; o cliente **nunca** manda `user_id`
   * (IDOR-safe, herdado da US-1.1). Roda sob `runAsSystem` (a página não tem titular
   * autenticado, ADR-006) e só expõe protocolo `ACTIVE` (que só nasce `AUTO_APPROVED` e
   * assinado — Worker US-2.4); qualquer outro estado ou id inexistente → `null` (o
   * controller vira 404 sem vazar dado). A projeção **omite `user_id`** de propósito.
   */
  async findByToken(protocolId: string): Promise<ProtocolRead | null> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          content: protocols.content,
          status: protocols.status,
          approvalStatus: protocols.approvalStatus,
          professionalId: protocols.professionalId,
          signatureHash: protocols.signatureHash,
          signedAt: protocols.signedAt,
          totalWeeks: protocols.totalWeeks,
          currentWeek: protocols.currentWeek,
        })
        .from(protocols)
        .where(and(eq(protocols.id, protocolId), eq(protocols.status, 'ACTIVE')))
        .limit(1),
    );
    const row = rows[0];
    if (!row) return null;
    return {
      content: row.content as ProtocolStructure,
      status: row.status,
      approvalStatus: row.approvalStatus,
      professionalId: row.professionalId,
      signatureHash: row.signatureHash,
      signedAt: row.signedAt ? new Date(row.signedAt).toISOString() : null,
      totalWeeks: row.totalWeeks,
      currentWeek: row.currentWeek,
    };
  }

  /** Persiste `protocols` v1 + `protocol_versions`. Corrida (23505) → `alreadyExisted`. */
  async persist(input: PersistProtocolInput): Promise<PersistedProtocol> {
    const signedAt = input.signed ? new Date() : null;
    const hash = input.signed ? signatureHash(input.content) : null;

    try {
      return await this.db.runAsUser(input.userId, 'USER', async (tx) => {
        const professionalId = input.signed
          ? await this.assignedActiveProfessional(tx, input.userId)
          : null;
        const [proto] = await tx
          .insert(protocols)
          .values({
            userId: input.userId,
            version: PROTOCOL_VERSION,
            status: input.status,
            approvalStatus: input.approvalStatus,
            professionalId,
            signedAt,
            signatureHash: hash,
            currentWeek: 1,
            totalWeeks: input.totalWeeks,
            content: input.content,
            constraints: input.constraints,
            parQFlags: input.parqFlags,
            humanReviewRequired: input.humanReviewRequired,
            reviewUrgency: input.reviewUrgency,
            generatedBy: input.generatedBy,
            modelVersion: input.modelVersion,
            promptVersion: input.promptVersion,
          })
          .returning({ id: protocols.id });
        if (!proto) throw new Error('persist: INSERT de protocols não retornou id.');

        await tx.insert(protocolVersions).values({
          protocolId: proto.id,
          userId: input.userId,
          version: PROTOCOL_VERSION,
          status: input.status,
          content: input.content,
          changeReason: 'geração inicial (US-2.4)',
          generatedBy: input.generatedBy,
          signatureHash: hash,
          signedAt,
        });

        return {
          protocolId: proto.id,
          version: PROTOCOL_VERSION,
          professionalId,
          alreadyExisted: false,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const [existing] = await this.db.runAsUser(input.userId, 'USER', (tx) =>
          tx
            .select({ id: protocols.id, professionalId: protocols.professionalId })
            .from(protocols)
            .where(and(eq(protocols.userId, input.userId), eq(protocols.version, PROTOCOL_VERSION)))
            .limit(1),
        );
        return {
          protocolId: existing?.id ?? 'unknown',
          version: PROTOCOL_VERSION,
          professionalId: existing?.professionalId ?? null,
          alreadyExisted: true,
        };
      }
      throw error;
    }
  }

  /**
   * Libera sozinho um protocolo `PENDING_REVIEW`/`OPTIONAL` cuja janela de cortesia de 1h
   * expirou sem ação do CREF (`ProtocolAutoReleaseWorker`). Idempotente e seguro
   * reexecutar: se o CREF já assinou (`signProtocol`) ou editou (`editProtocol` já força
   * `MANDATORY`), o estado não bate mais e é `released: false` sem tocar a linha — não há
   * "cancelar o job", o próprio estado decide na hora de rodar.
   */
  async autoRelease(
    userId: string,
    protocolId: string,
  ): Promise<{ released: boolean; version: number }> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          content: protocols.content,
          version: protocols.version,
          approvalStatus: protocols.approvalStatus,
          reviewUrgency: protocols.reviewUrgency,
        })
        .from(protocols)
        .where(eq(protocols.id, protocolId))
        .for('update')
        .limit(1);
      if (!row || row.approvalStatus !== 'PENDING_REVIEW' || row.reviewUrgency !== 'OPTIONAL') {
        return { released: false, version: row?.version ?? 0 };
      }
      const professionalId = await this.assignedActiveProfessional(tx, userId);
      await tx
        .update(protocols)
        .set({
          status: 'ACTIVE',
          approvalStatus: 'AUTO_APPROVED',
          professionalId,
          signedAt: new Date(),
          signatureHash: signatureHash(row.content as ProtocolStructure),
          humanReviewRequired: false,
        })
        .where(eq(protocols.id, protocolId));
      return { released: true, version: row.version };
    });
  }

  /** Lookup estreito: a funcao exige o contexto do titular e CREF atribuido ativo. */
  private async assignedActiveProfessional(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
  ): Promise<string> {
    const rows = (await tx.execute(
      sql`SELECT public.assigned_active_professional(${userId}::uuid) AS professional_id`,
    )) as unknown as Array<{ professional_id: string }>;
    const professionalId = rows[0]?.professional_id;
    if (!professionalId) throw new Error('Nenhum profissional CREF ativo atribuido ao titular.');
    return professionalId;
  }
}

/** 23505 = unique_violation do PostgreSQL. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
