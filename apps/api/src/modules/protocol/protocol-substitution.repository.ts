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
import { applySubstitutions } from './protocol-substitution-apply';
import {
  itemsOf,
  type SubstitutionChange,
  type SubstitutionItem,
} from './protocol-substitution-items';
import type { CatalogExercise, ContraindicationTag, ExerciseLevel } from './exercise-catalog';
import { ExerciseCatalogProvider } from './exercise-catalog-provider.service';
import { isViable, type SubstitutionConstraints } from './exercise-substitution';
import { ValidationService, type ValidateProtocolInput } from './validation/validation.service';

/** Mesma extração de `loadActiveProtocol` — reaproveitada por `attachCatalogExerciseAndRelease`,
 * que precisa recomputar a troca contra o protocolo VIVO no momento da aprovação. */
function deriveConstraints(
  rawConstraints: unknown,
  parQFlags: unknown,
): {
  constraints: SubstitutionConstraints;
  validationConstraints: ValidateProtocolInput['constraints'];
  parQFlags: ContraindicationTag[];
} {
  const raw = (rawConstraints ?? {}) as Partial<SubstitutionConstraints> &
    ValidateProtocolInput['constraints'];
  const level: ExerciseLevel = raw.level ?? 'INICIANTE';
  return {
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
    parQFlags: (parQFlags ?? []) as ContraindicationTag[],
  };
}

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
  /** Espelho da 1ª troca — mantido para leitores anteriores ao lote (`items` é o completo). */
  from: { id: string; name: string };
  to: { id: string; name: string };
  sessionsAffected: string[];
  /** Achado 2026-09-30 (troca em lote): uma entrada por troca aplicada. */
  items?: Array<{
    from: { id: string; name: string };
    to: { id: string; name: string };
    sessionsAffected: string[];
  }>;
}

export interface CreatePendingSubstitutionInput {
  userId: string;
  protocolId: string;
  baseVersion: number;
  /** 1 a `MAX_SUBSTITUTION_ITEMS` trocas. Item `mandatory`/`catalogGap` torna a proposta
   * inteira `MANDATORY` (nunca auto-libera). */
  items: SubstitutionItem[];
  /** Protocolo com as trocas resolvidas já aplicadas. `null` sem nenhuma troca aplicável
   * (todas as trocas pedidas são de catálogo). Informativo — a liberação recalcula. */
  proposedContent: ProtocolStructure | null;
  diff: SubstitutionDiff | null;
  changeReason: string;
  /** Força `MANDATORY` (ex.: PAR-Q bloqueante). Item obrigatório também força. */
  reviewUrgency?: 'OPTIONAL' | 'MANDATORY';
}

export type CreatePendingSubstitutionResult =
  | { created: true; id: string }
  /** Já existe uma proposta `PENDING` para este protocolo (regra de v1: uma por vez). */
  | { created: false; alreadyPending: true };

/** Decisão do profissional sobre um item, na tela única da proposta. Item sem decisão
 * explícita é aprovado como está. */
export interface SubstitutionItemEdit {
  index: number;
  action: 'APPROVE' | 'DISCARD';
  /** Só com `APPROVE`: outro exercício do catálogo no lugar do proposto. */
  toExerciseId?: string;
}

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
      /** De/para de cada troca APLICADA — a reentrega saúda e resume todas (troca em lote). */
      changes: SubstitutionChange[];
    }
  /** Proposta inexistente ou já decidida. */
  | { released: false; reason: 'NOT_PENDING' }
  /** O protocolo mudou de versão/saiu de `ACTIVE` desde que a proposta nasceu: descartada. */
  | { released: false; reason: 'STALE' }
  /** O profissional descartou todos os itens: proposta descartada (o aluno é avisado). */
  | { released: false; reason: 'ALL_DISCARDED'; userId: string; protocolId: string }
  /** Item aprovado sem exercício resolvido (pedido de catálogo ainda sem exercício) ou
   * edição inválida (índice inexistente, exercício fora do catálogo/inelegível). */
  | { released: false; reason: 'UNRESOLVED_ITEM' | 'INVALID_EDIT'; detail: string }
  /** As trocas aprovadas, aplicadas ao protocolo inteiro, quebraram a validação — nada foi
   * tocado; o profissional pode ajustar os itens ou recusar a proposta. */
  | { released: false; reason: 'VALIDATION_FAILED'; violations: string[] };

/** Resultado de `attachCatalogExercise`. */
export type AttachCatalogExerciseResult =
  | { attached: true; userId: string }
  /** Proposta/item inexistente, não é `catalogGap`, ou proposta não está mais `PENDING`. */
  | { attached: false; reason: 'NOT_FOUND' }
  /** Protocolo mudou de versão/saiu de `ACTIVE` desde que a proposta nasceu. */
  | { attached: false; reason: 'STALE' }
  /** O exercício publicado não é elegível para este aluno (nível/local/contraindicação). */
  | { attached: false; reason: 'NOT_VIABLE' }
  /** O exercício recém-publicado, aplicado ao protocolo inteiro, quebrou a validação. */
  | { attached: false; reason: 'VALIDATION_FAILED'; violations: string[] };

/** Protocolo referenciado por uma proposta, para o painel calcular as opções de edição. */
export type ProtocolForReview = ActiveProtocolForSubstitution & { status: string };

@Injectable()
export class ProtocolSubstitutionRepository {
  constructor(
    private readonly db: TenantDatabase,
    private readonly validation: ValidationService,
    private readonly catalog: ExerciseCatalogProvider,
  ) {}

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
    const derived = deriveConstraints(row.constraints, row.parQFlags);
    return {
      protocolId: row.protocolId,
      version: row.version,
      content: row.content as ProtocolStructure,
      ...derived,
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

  /**
   * Cria a proposta em staging, com todas as trocas no MESMO registro (troca em lote). Corrida
   * com uma pendência concorrente → índice único parcial trata. As colunas `from_*`/`to_*`
   * continuam gravadas, espelhando o 1º item, para leitores anteriores à coluna `items`.
   */
  async createPending(
    input: CreatePendingSubstitutionInput,
  ): Promise<CreatePendingSubstitutionResult> {
    const first = input.items[0];
    if (!first) throw new Error('createPending: proposta sem itens.');
    const mandatory =
      input.reviewUrgency === 'MANDATORY' || input.items.some((item) => item.mandatory);
    try {
      const [row] = await this.db.runAsUser(input.userId, 'USER', (tx) =>
        tx
          .insert(protocolSubstitutionRequests)
          .values({
            protocolId: input.protocolId,
            userId: input.userId,
            fromExerciseId: first.fromExerciseId,
            fromExerciseName: first.fromExerciseName,
            toExerciseId: first.toExerciseId,
            toExerciseName: first.toExerciseName,
            items: input.items,
            proposedContent: input.proposedContent,
            diff: input.diff,
            changeReason: input.changeReason,
            baseVersion: input.baseVersion,
            reviewUrgency: mandatory ? 'MANDATORY' : 'OPTIONAL',
            catalogGap: input.items.some((item) => item.catalogGap),
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
   *
   * O conteúdo é SEMPRE recalculado contra o protocolo VIVO a partir dos itens aprovados
   * (nunca reaproveita `proposed_content`): o profissional pode ter editado ou descartado
   * itens, e a estrutura inteira é revalidada antes de qualquer escrita. `edits` traz as
   * decisões do profissional por item; item sem decisão explícita é aprovado como está.
   */
  async release(
    actor: SubstitutionActor,
    requestId: string,
    edits: readonly SubstitutionItemEdit[] = [],
  ): Promise<ReleaseSubstitutionResult> {
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [request] = await tx
        .select()
        .from(protocolSubstitutionRequests)
        .where(eq(protocolSubstitutionRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request || request.status !== 'PENDING') {
        return { released: false, reason: 'NOT_PENDING' };
      }

      const items = itemsOf(request).map((item) => ({ ...item }));
      const editedIndexes = new Set<number>();
      for (const edit of edits) {
        const item = items[edit.index];
        if (!item) {
          return {
            released: false,
            reason: 'INVALID_EDIT',
            detail: `Item ${edit.index} inexistente.`,
          };
        }
        if (edit.action === 'DISCARD') {
          item.decision = 'DISCARDED';
          continue;
        }
        item.decision = 'APPROVED';
        if (edit.toExerciseId && edit.toExerciseId !== item.toExerciseId) {
          const replacement = this.catalog.getById(edit.toExerciseId);
          if (!replacement) {
            return {
              released: false,
              reason: 'INVALID_EDIT',
              detail: `Exercício "${edit.toExerciseId}" não está no catálogo.`,
            };
          }
          item.toExerciseId = replacement.id;
          item.toExerciseName = replacement.name;
          item.catalogGap = false;
          editedIndexes.add(edit.index);
        }
      }
      for (const item of items) {
        if (item.decision === 'PENDING') item.decision = 'APPROVED';
      }

      const approved = items.filter((item) => item.decision === 'APPROVED');
      if (approved.length === 0) {
        await this.markDiscarded(tx, request.id, items, actor);
        return {
          released: false,
          reason: 'ALL_DISCARDED',
          userId: request.userId,
          protocolId: request.protocolId,
        };
      }
      if (approved.some((item) => item.toExerciseId === null)) {
        return {
          released: false,
          reason: 'UNRESOLVED_ITEM',
          detail: 'Há item aprovado sem exercício definido — adicione ao catálogo ou descarte.',
        };
      }

      const [protocol] = await tx
        .select({
          id: protocols.id,
          version: protocols.version,
          status: protocols.status,
          content: protocols.content,
          constraints: protocols.constraints,
          parQFlags: protocols.parQFlags,
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
        await this.markDiscarded(tx, request.id, items, actor);
        return { released: false, reason: 'STALE' };
      }

      const derived = deriveConstraints(protocol.constraints, protocol.parQFlags);
      const swaps: Array<{ fromExerciseId: string; to: CatalogExercise }> = [];
      for (const [index, item] of items.entries()) {
        if (item.decision !== 'APPROVED' || item.toExerciseId === null) continue;
        const to = this.catalog.getById(item.toExerciseId);
        if (!to) {
          return {
            released: false,
            reason: 'INVALID_EDIT',
            detail: `Exercício "${item.toExerciseName}" não está mais no catálogo.`,
          };
        }
        // Edição do profissional: o filtro de segurança (nível/local/contraindicação) vale
        // para o exercício escolhido por ele também. Itens não editados já nasceram com o
        // seu veredito (inclusive os obrigatórios, que o profissional decide por definição).
        if (editedIndexes.has(index) && !isViable(to, derived.constraints)) {
          return {
            released: false,
            reason: 'INVALID_EDIT',
            detail: `"${to.name}" não é elegível para este aluno (nível, local ou contraindicação).`,
          };
        }
        swaps.push({ fromExerciseId: item.fromExerciseId, to });
      }

      const applied = applySubstitutions(protocol.content as ProtocolStructure, swaps);
      const verdict = this.validation.validate({
        structure: applied.content,
        constraints: derived.validationConstraints,
        parqFlags: derived.parQFlags,
      });
      if (verdict.action !== 'PASS') {
        return {
          released: false,
          reason: 'VALIDATION_FAILED',
          violations: verdict.violations.map((v) => v.rule),
        };
      }

      const diff = buildSubstitutionDiff(approved, applied.sessionsAffectedBySwap);
      const { nextVersion } = await this.applyReleaseTail(
        tx,
        protocol,
        request,
        applied.content,
        diff,
        items,
        actor,
      );

      return {
        released: true,
        protocolId: protocol.id,
        userId: request.userId,
        version: nextVersion,
        content: applied.content,
        mesocycleName: protocol.mesocycleName,
        startDate: protocol.startDate,
        endDate: protocol.endDate,
        totalWeeks: protocol.totalWeeks,
        changes: approved.map((item) => ({ from: item.fromExerciseName, to: item.toExerciseName })),
      };
    });
  }

  /**
   * Publicado o exercício pedido pelo aluno no catálogo (fora daqui —
   * `ExerciseCatalogAdminService.publish()`), liga-o ao item de catálogo da proposta. NÃO
   * libera nada: o profissional segue decidindo na tela única, item a item. Recomputa a troca
   * contra o protocolo VIVO e revalida a estrutura inteira antes de aceitar — se falhar, nada
   * é tocado (o time pode recategorizar o exercício ou descartar o item).
   */
  async attachCatalogExercise(
    actor: SubstitutionActor,
    requestId: string,
    itemIndex: number,
    chosen: CatalogExercise,
  ): Promise<AttachCatalogExerciseResult> {
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [request] = await tx
        .select()
        .from(protocolSubstitutionRequests)
        .where(eq(protocolSubstitutionRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request || request.status !== 'PENDING') return { attached: false, reason: 'NOT_FOUND' };
      const items = itemsOf(request).map((item) => ({ ...item }));
      const target = items[itemIndex];
      if (!target || !target.catalogGap || target.decision === 'DISCARDED') {
        return { attached: false, reason: 'NOT_FOUND' };
      }

      const [protocol] = await tx
        .select({
          id: protocols.id,
          version: protocols.version,
          status: protocols.status,
          content: protocols.content,
          constraints: protocols.constraints,
          parQFlags: protocols.parQFlags,
        })
        .from(protocols)
        .where(eq(protocols.id, request.protocolId))
        .for('update')
        .limit(1);
      if (!protocol || protocol.status !== 'ACTIVE' || protocol.version !== request.baseVersion) {
        await this.markDiscarded(tx, request.id, items, actor);
        return { attached: false, reason: 'STALE' };
      }

      const derived = deriveConstraints(protocol.constraints, protocol.parQFlags);
      if (!isViable(chosen, derived.constraints)) return { attached: false, reason: 'NOT_VIABLE' };
      const applied = applySubstitutions(protocol.content as ProtocolStructure, [
        { fromExerciseId: target.fromExerciseId, to: chosen },
      ]);
      const verdict = this.validation.validate({
        structure: applied.content,
        constraints: derived.validationConstraints,
        parqFlags: derived.parQFlags,
      });
      if (verdict.action !== 'PASS') {
        return {
          attached: false,
          reason: 'VALIDATION_FAILED',
          violations: verdict.violations.map((v) => v.rule),
        };
      }

      target.toExerciseId = chosen.id;
      target.toExerciseName = chosen.name;
      target.catalogGap = false;
      const first = items[0];
      await tx
        .update(protocolSubstitutionRequests)
        .set({
          items,
          catalogGap: items.some((item) => item.catalogGap),
          // Espelho do 1º item nas colunas legadas.
          ...(first
            ? {
                fromExerciseId: first.fromExerciseId,
                fromExerciseName: first.fromExerciseName,
                toExerciseId: first.toExerciseId,
                toExerciseName: first.toExerciseName,
              }
            : {}),
        })
        .where(eq(protocolSubstitutionRequests.id, requestId));
      return { attached: true, userId: request.userId };
    });
  }

  /** Item(ns) inelegíveis que a liberação automática não conseguiu aplicar (validação da
   * estrutura inteira falhou): passa a exigir decisão humana em vez de ficar pendente para
   * sempre bloqueando novas propostas. */
  async escalateToMandatory(actor: SubstitutionActor, requestId: string): Promise<void> {
    await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      tx
        .update(protocolSubstitutionRequests)
        .set({ reviewUrgency: 'MANDATORY' })
        .where(
          and(
            eq(protocolSubstitutionRequests.id, requestId),
            eq(protocolSubstitutionRequests.status, 'PENDING'),
          ),
        ),
    );
  }

  /** Marca a proposta `DISCARDED`, registrando a decisão de cada item. */
  private async markDiscarded(
    tx: TenantTransaction,
    requestId: string,
    items: readonly SubstitutionItem[],
    actor: SubstitutionActor,
  ): Promise<void> {
    await tx
      .update(protocolSubstitutionRequests)
      .set({
        status: 'DISCARDED',
        decidedAt: new Date(),
        ...(actor.role === 'USER' ? {} : { decidedBy: actor.userId }),
        items: items.map((item) => ({ ...item, decision: 'DISCARDED' as const })),
      })
      .where(eq(protocolSubstitutionRequests.id, requestId));
  }

  /** Bump de versão + `protocol_versions` + marca a proposta `RELEASED`, gravando a decisão
   * final de cada item e o conteúdo efetivamente aplicado. */
  private async applyReleaseTail(
    tx: TenantTransaction,
    protocol: { id: string; version: number },
    request: { id: string; userId: string; changeReason: string },
    content: ProtocolStructure,
    diff: SubstitutionDiff,
    items: readonly SubstitutionItem[],
    actor: SubstitutionActor,
  ): Promise<{ nextVersion: number }> {
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
      diff,
      changeReason: request.changeReason,
      generatedBy: 'AI_SUBSTITUTION',
      signatureHash: signatureHash(content),
      signedAt: new Date(),
    });
    const first = items[0];
    await tx
      .update(protocolSubstitutionRequests)
      .set({
        status: 'RELEASED',
        decidedAt: new Date(),
        ...(actor.role === 'USER' ? {} : { decidedBy: actor.userId }),
        items: [...items],
        proposedContent: content,
        diff,
        ...(first
          ? {
              fromExerciseId: first.fromExerciseId,
              fromExerciseName: first.fromExerciseName,
              toExerciseId: first.toExerciseId,
              toExerciseName: first.toExerciseName,
            }
          : {}),
      })
      .where(eq(protocolSubstitutionRequests.id, request.id));
    return { nextVersion };
  }

  /** Recusa a proposta inteira — mantém os exercícios originais, sem tocar `protocols`. Só
   * staff chama isto. */
  async discard(
    actor: SubstitutionActor,
    requestId: string,
  ): Promise<
    | { discarded: true; protocolId: string; userId: string }
    | { discarded: false; protocolId: null; userId: null }
  > {
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const [request] = await tx
        .select()
        .from(protocolSubstitutionRequests)
        .where(eq(protocolSubstitutionRequests.id, requestId))
        .for('update')
        .limit(1);
      if (!request || request.status !== 'PENDING') {
        return { discarded: false, protocolId: null, userId: null };
      }
      await this.markDiscarded(tx, request.id, itemsOf(request), actor);
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

  /** Protocolo referenciado por uma proposta (linha viva), sob o papel do ator — o painel
   * calcula daqui as opções seguras de edição de cada item. `null` se não existir. */
  async loadProtocolForReview(
    actor: SubstitutionActor,
    protocolId: string,
  ): Promise<ProtocolForReview | null> {
    const [row] = await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      tx
        .select({
          protocolId: protocols.id,
          version: protocols.version,
          status: protocols.status,
          content: protocols.content,
          constraints: protocols.constraints,
          parQFlags: protocols.parQFlags,
          parqState: anamnesisSessions.parqState,
        })
        .from(protocols)
        .leftJoin(anamnesisSessions, eq(anamnesisSessions.id, protocols.anamnesisSessionId))
        .where(eq(protocols.id, protocolId))
        .limit(1),
    );
    if (!row) return null;
    return {
      protocolId: row.protocolId,
      version: row.version,
      status: row.status,
      content: row.content as ProtocolStructure,
      ...deriveConstraints(row.constraints, row.parQFlags),
      fromBlockingParq: row.parqState === 'BLOQUEADO_AGUARDANDO_CLEARANCE',
    };
  }
}

/** `diff` gravado em `protocol_versions`: espelho da 1ª troca + uma entrada por troca. */
export function buildSubstitutionDiff(
  approved: readonly SubstitutionItem[],
  sessionsAffectedBySwap: readonly string[][],
): SubstitutionDiff {
  const entries = approved.map((item, index) => ({
    from: { id: item.fromExerciseId, name: item.fromExerciseName },
    to: { id: item.toExerciseId ?? '', name: item.toExerciseName },
    sessionsAffected: sessionsAffectedBySwap[index] ?? [],
  }));
  const [first] = entries;
  if (!first) throw new Error('buildDiff: sem trocas aprovadas.');
  return {
    type: 'EXERCISE_SUBSTITUTION',
    from: first.from,
    to: first.to,
    sessionsAffected: [...new Set(entries.flatMap((entry) => entry.sessionsAffected))],
    items: entries,
  };
}

/** 23505 = unique_violation do PostgreSQL (índice parcial de pendência única). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/** Reexportado para quem só precisa do tipo de transação (worker/dashboard). */
export type { TenantTransaction };
