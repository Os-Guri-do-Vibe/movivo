/**
 * Persistência do fluxo de substituição de exercício via IA (achado 2026-09-02), sob RLS.
 *
 * A proposta nasce em `protocol_substitution_requests`, em staging — o protocolo `ACTIVE` do
 * titular NÃO é tocado enquanto ela está `PENDING` (ver o comentário de topo do schema, em
 * `core/database/schema/protocol-substitution-requests.ts`, para o porquê). `release()` é o
 * único caminho que de fato aplica a mudança, reusando a MESMA mecânica que
 * `DashboardService.signProtocol` já usa para qualquer nova versão de protocolo: bump de
 * `version`, grava `content`, insere `protocol_versions`. Chamado tanto pelo worker de
 * liberação automática (30 min) quanto pela aprovação manual do profissional — os dois
 * caminhos convergem aqui, sem duplicar a lógica de aplicação.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { ProtocolStructure } from '@movivo/shared';

import {
  anamnesisSessions,
  protocols,
  protocolSubstitutionRequests,
  protocolVersions,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantRole,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { signatureHash } from './protocol.repository';
import type { ContraindicationTag, ExerciseLevel } from './exercise-catalog';
import type { SubstitutionConstraints } from './exercise-substitution';
import type { ValidateProtocolInput } from './validation/validation.service';

/**
 * Quem está executando a transação. `release()`/`discard()` são chamados por dois tipos de
 * ator bem diferentes — o worker de liberação automática (impersonando o titular, `role:
 * 'USER'`, mesmo padrão de `ProtocolRepository.autoRelease`) e o profissional/admin agindo no
 * dashboard (`role: 'PROFESSIONAL' | 'ADMIN'`, a própria identidade de staff) — por isso o
 * autor da transação nunca é assumido implicitamente, sempre recebido explícito.
 */
export interface SubstitutionActor {
  userId: string;
  role: TenantRole;
}

export interface ActiveProtocolForSubstitution {
  protocolId: string;
  version: number;
  content: ProtocolStructure;
  /** Recorte para `findSafeCandidates` (filtro de segurança do candidato). */
  constraints: SubstitutionConstraints;
  /**
   * Recorte para `ValidationService.validate()` (revalidação da estrutura inteira após a
   * troca). Mesmas chaves que `DashboardService.editProtocol`/`signProtocol` já usam
   * (`goal`/`injuryTags`/`preferredDays`), com `level` real incluído — a diferença
   * deliberada dos dois call sites acima, que hoje deixam `level` de fora e por isso caem no
   * default `INICIANTE` do `ValidationService`; aqui o nível verdadeiro já está disponível
   * (veio junto de `constraints` acima), então revalidar com ele é estritamente mais preciso.
   */
  validationConstraints: ValidateProtocolInput['constraints'];
  parQFlags: ContraindicationTag[];
  /**
   * A sessão de anamnese que originou este protocolo está `BLOQUEADO_AGUARDANDO_CLEARANCE`
   * (achado 2026-09-03, a pedido do fundador)? Decide se a proposta de substituição nasce
   * `MANDATORY` (fila "Substituição Obrigatória", sem auto-liberação — mesma regra de
   * segurança de `protocols.reviewUrgency`) ou `OPTIONAL` (auto-libera em 30min).
   */
  fromBlockingParq: boolean;
}

export interface SubstitutionDiff {
  type: 'EXERCISE_SUBSTITUTION';
  from: { id: string; name: string };
  to: { id: string; name: string };
  sessionsAffected: string[];
}

export interface CreatePendingSubstitutionInput {
  userId: string;
  protocolId: string;
  baseVersion: number;
  fromExerciseId: string;
  fromExerciseName: string;
  toExerciseId: string;
  toExerciseName: string;
  proposedContent: ProtocolStructure;
  diff: SubstitutionDiff;
  changeReason: string;
}

export type CreatePendingSubstitutionResult =
  | { created: true; id: string }
  /** Já existe uma proposta `PENDING` para este protocolo (regra de v1: uma por vez). */
  | { created: false; alreadyPending: true };

export type ReleaseSubstitutionResult =
  | {
      released: true;
      protocolId: string;
      /** Titular do protocolo — quem chama (ex.: aprovação manual do dashboard) não
       * necessariamente conhece isso de antemão; o worker sim, mas fica uniforme aqui. */
      userId: string;
      version: number;
      content: ProtocolStructure;
      mesocycleName: string;
      startDate: Date;
      endDate: Date;
      totalWeeks: number;
    }
  /** Estado não bate mais (já decidida, ou o protocolo mudou de versão/saiu de ACTIVE
   * desde que a proposta nasceu) — no-op seguro, mesmo raciocínio de `autoRelease`. */
  | { released: false };

@Injectable()
export class ProtocolSubstitutionRepository {
  constructor(private readonly db: TenantDatabase) {}

  /** Protocolo ATIVO do titular, sempre a linha VIVA — nunca um snapshot antigo. */
  async loadActiveProtocol(userId: string): Promise<ActiveProtocolForSubstitution | null> {
    // LEFT JOIN (não INNER): protocolo anterior à migração 0035 não tem
    // `anamnesis_session_id` — mesmo motivo/padrão de `DashboardService.queue()`.
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          protocolId: protocols.id,
          version: protocols.version,
          content: protocols.content,
          constraints: protocols.constraints,
          parQFlags: protocols.parQFlags,
          parqState: anamnesisSessions.parqState,
        })
        .from(protocols)
        .leftJoin(anamnesisSessions, eq(anamnesisSessions.id, protocols.anamnesisSessionId))
        .where(and(eq(protocols.userId, userId), eq(protocols.status, 'ACTIVE')))
        .limit(1),
    );
    if (!row) return null;
    const raw = (row.constraints ?? {}) as Partial<SubstitutionConstraints> &
      ValidateProtocolInput['constraints'];
    const level: ExerciseLevel = raw.level ?? 'INICIANTE';
    return {
      protocolId: row.protocolId,
      version: row.version,
      content: row.content as ProtocolStructure,
      // Mesmos defaults seguros que existiam em `ConversationRepository.loadConstraints`.
      constraints: {
        level,
        location: raw.location ?? 'HOME',
        equipment: raw.equipment ?? [],
        injuryTags: raw.injuryTags ?? [],
      },
      validationConstraints: {
        goal: raw.goal,
        injuryTags: raw.injuryTags ?? [],
        preferredDays: raw.preferredDays,
        level,
      },
      parQFlags: (row.parQFlags ?? []) as ContraindicationTag[],
      fromBlockingParq: row.parqState === 'BLOQUEADO_AGUARDANDO_CLEARANCE',
    };
  }

  /** Já existe proposta `PENDING` pra este protocolo? Checagem leve ANTES de oferecer novas
   * opções (regra de v1: uma pendência por vez) — a garantia forte de verdade é o índice
   * único parcial, esta é só para a IA poder avisar o aluno em vez de silenciosamente falhar
   * ao tentar persistir uma segunda proposta no turno de confirmação. */
  async hasPending(userId: string, protocolId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: protocolSubstitutionRequests.id })
        .from(protocolSubstitutionRequests)
        .where(
          and(
            eq(protocolSubstitutionRequests.protocolId, protocolId),
            eq(protocolSubstitutionRequests.status, 'PENDING'),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }

  /** Cria a proposta em staging. Corrida com uma pendência concorrente → índice único trata. */
  async createPending(
    input: CreatePendingSubstitutionInput,
  ): Promise<CreatePendingSubstitutionResult> {
    try {
      const [row] = await this.db.runAsUser(input.userId, 'USER', (tx) =>
        tx
          .insert(protocolSubstitutionRequests)
          .values({
            protocolId: input.protocolId,
            userId: input.userId,
            fromExerciseId: input.fromExerciseId,
            fromExerciseName: input.fromExerciseName,
            toExerciseId: input.toExerciseId,
            toExerciseName: input.toExerciseName,
            proposedContent: input.proposedContent,
            diff: input.diff,
            changeReason: input.changeReason,
            baseVersion: input.baseVersion,
          })
          .returning({ id: protocolSubstitutionRequests.id }),
      );
      if (!row) throw new Error('createPending: INSERT não retornou id.');
      return { created: true, id: row.id };
    } catch (error) {
      if (isUniqueViolation(error)) return { created: false, alreadyPending: true };
      throw error;
    }
  }

  /**
   * Aplica a proposta ao protocolo, se ainda fizer sentido. Idempotente: reconfere sob
   * `FOR UPDATE` que a proposta ainda é `PENDING` E que o protocolo ainda está `ACTIVE` na
   * MESMA versão em que a proposta nasceu — se um profissional editou/assinou o protocolo
   * nesse meio-tempo (ou a proposta já foi decidida por outro caminho), vira no-op seguro,
   * mesmo raciocínio de `ProtocolRepository.autoRelease`.
   */
  async release(actor: SubstitutionActor, requestId: string): Promise<ReleaseSubstitutionResult> {
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [request] = await tx
        .select()
        .from(protocolSubstitutionRequests)
        .where(eq(protocolSubstitutionRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request || request.status !== 'PENDING') return { released: false };

      const [protocol] = await tx
        .select({
          id: protocols.id,
          version: protocols.version,
          status: protocols.status,
          mesocycleName: protocols.mesocycleName,
          startDate: protocols.startDate,
          endDate: protocols.endDate,
          totalWeeks: protocols.totalWeeks,
        })
        .from(protocols)
        .where(eq(protocols.id, request.protocolId))
        .for('update')
        .limit(1);
      if (!protocol || protocol.status !== 'ACTIVE' || protocol.version !== request.baseVersion) {
        await tx
          .update(protocolSubstitutionRequests)
          .set({ status: 'DISCARDED', decidedAt: new Date() })
          .where(eq(protocolSubstitutionRequests.id, requestId));
        return { released: false };
      }

      const content = request.proposedContent as ProtocolStructure;
      const nextVersion = protocol.version + 1;
      await tx
        .update(protocols)
        .set({ version: nextVersion, content })
        .where(eq(protocols.id, protocol.id));
      await tx.insert(protocolVersions).values({
        protocolId: protocol.id,
        userId: request.userId,
        version: nextVersion,
        status: 'ACTIVE',
        content,
        diff: request.diff,
        changeReason: request.changeReason,
        generatedBy: 'AI_SUBSTITUTION',
        signatureHash: signatureHash(content),
        signedAt: new Date(),
      });
      await tx
        .update(protocolSubstitutionRequests)
        .set({ status: 'RELEASED', decidedAt: new Date() })
        .where(eq(protocolSubstitutionRequests.id, requestId));

      return {
        released: true,
        protocolId: protocol.id,
        userId: request.userId,
        version: nextVersion,
        content,
        mesocycleName: protocol.mesocycleName,
        startDate: protocol.startDate,
        endDate: protocol.endDate,
        totalWeeks: protocol.totalWeeks,
      };
    });
  }

  /** Recusa a troca — mantém o exercício original, sem tocar `protocols`. Só staff chama isto. */
  async discard(
    actor: SubstitutionActor,
    requestId: string,
  ): Promise<
    | { discarded: true; protocolId: string; userId: string }
    | { discarded: false; protocolId: null; userId: null }
  > {
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [request] = await tx
        .select({
          status: protocolSubstitutionRequests.status,
          protocolId: protocolSubstitutionRequests.protocolId,
          userId: protocolSubstitutionRequests.userId,
        })
        .from(protocolSubstitutionRequests)
        .where(eq(protocolSubstitutionRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request || request.status !== 'PENDING') {
        return { discarded: false, protocolId: null, userId: null };
      }
      await tx
        .update(protocolSubstitutionRequests)
        .set({ status: 'DISCARDED', decidedAt: new Date(), decidedBy: actor.userId })
        .where(eq(protocolSubstitutionRequests.id, requestId));
      return { discarded: true, protocolId: request.protocolId, userId: request.userId };
    });
  }

  /** Leitura por id, sob RLS — usada pelo dashboard (detalhe) e pelo worker de liberação. */
  async findById(actor: SubstitutionActor, requestId: string) {
    const [row] = await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      tx
        .select()
        .from(protocolSubstitutionRequests)
        .where(eq(protocolSubstitutionRequests.id, requestId))
        .limit(1),
    );
    return row ?? null;
  }
}

/** 23505 = unique_violation do PostgreSQL (índice parcial de pendência única). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** Reexportado para quem só precisa do tipo de transação (worker/dashboard). */
export type { TenantTransaction };
