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
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  onboardingStep1Schema,
  TRAINING_PHASE_LABELS,
  type OnboardingStep1,
  type ProtocolApprovalStatus,
  type ProtocolRead,
  type ProtocolReviewUrgency,
  type ProtocolStatus,
  type ProtocolStructure,
} from '@movivo/shared';

import { TenantDatabase, type TenantTransaction } from '../../core/database/tenant-database.service';
import { anamnesisSessions, protocols, protocolVersions } from '../../core/database/schema';
import type { ContraindicationTag } from './exercise-catalog';

/**
 * Id da assinatura da metodologia do RT CREF. ponytail: constante fixa — a tabela
 * `professionals` e a FK nascem na Sprint 5 (dashboard CREF). Trocar por lookup real lá.
 */

/** SHA-256 do conteúdo — prova, meses depois, que o entregue é o que foi assinado. */
export function signatureHash(content: ProtocolStructure): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * "Mesociclo {mesocycleNumber}: {fase}" — nome do bloco de periodização vigente. Colon,
 * não travessão: este nome entra literal na mensagem de WhatsApp de entrega do protocolo
 * (`explanationBlock` em `message-templates.ts`), onde travessão é proibido por regra de
 * produto (achado 2026-09-09, correção do fundador).
 *
 * `mesocycleNumber` é o nº sequencial do mesociclo na vida do titular (coluna
 * `protocols.mesocycleNumber`) — nunca `protocols.version` (que conta revisões desta
 * MESMA linha, incrementado por `signProtocol` a cada assinatura).
 */
function mesocycleName(mesocycleNumber: number, phase: ProtocolStructure['phase']): string {
  return `Mesociclo ${mesocycleNumber}: ${TRAINING_PHASE_LABELS[phase] ?? phase}`;
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
  /**
   * Sessão de anamnese que originou o protocolo. `null` só para caminhos que não têm uma
   * (nenhum hoje) — a coluna é nullable pelas linhas anteriores à migração 0035, que não
   * têm como ser retroativamente ligadas. É por este vínculo que a assinatura do protocolo
   * consegue liberar o PAR-Q da sessão certa (`release_parq_on_signature`).
   */
  anamnesisSessionId: string | null;
  /**
   * Sessão de renovação que originou este protocolo (mesociclo 2+). `null` para a
   * geração inicial (mesociclo 1, que tem `anamnesisSessionId` em vez disto). Um dos dois
   * deve estar preenchido a partir do segundo mesociclo — não há CHECK de banco para
   * isso ainda (mesmo racional de nullable "normal" já documentado no schema).
   */
  renewalSessionId?: string | null;
  totalWeeks: number;
  generatedBy: string;
  modelVersion: string | null;
  promptVersion: string;
  knowledgeSources?: unknown;
  methodologyVersionId?: string | null;
  methodologySha256?: string | null;
  /** `AUTO_APPROVED` assina em nível de metodologia (RT); demais nascem sem assinatura. */
  signed: boolean;
}

/**
 * Union discriminada por `released` (mesmo motivo de `SignProtocolResult` em
 * `dashboard.service.ts`): dois `return` com campos diferentes fariam o TypeScript
 * mesclar as formas com campos opcionais em vez de discriminar de verdade.
 */
export type AutoReleaseResult =
  | { released: false; version: number }
  | {
      released: true;
      version: number;
      content: ProtocolStructure;
      mesocycleName: string;
      startDate: Date;
      endDate: Date;
      totalWeeks: number;
      signatureHash: string;
      signedAt: Date;
    };

export interface PersistedProtocol {
  protocolId: string;
  version: number;
  professionalId: string | null;
  /** `true` quando outra execução já havia persistido (corrida — idempotência). */
  alreadyExisted: boolean;
}

/** Toda linha nasce nesta revisão-de-conteúdo; `signProtocol` incrementa a partir daqui. */
const INITIAL_REVISION_VERSION = 1;

/** Mesociclo inicial (o único que nasce de anamnese, não de renovação). */
const INITIAL_MESOCYCLE_NUMBER = 1;

@Injectable()
export class ProtocolRepository {
  constructor(private readonly db: TenantDatabase) {}

  /**
   * Já existe o protocolo INICIAL (mesociclo 1) do titular? Pré-checagem de idempotência
   * do `ProtocolGenerationWorker` — não tem relação com renovação: a idempotência de um
   * protocolo de renovação é por `renewalSessionId` (uma sessão de renovação gera no
   * máximo um protocolo), verificada por quem chama `persist()` naquele fluxo.
   */
  async existsForUser(userId: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: protocols.id })
        .from(protocols)
        .where(
          and(eq(protocols.userId, userId), eq(protocols.mesocycleNumber, INITIAL_MESOCYCLE_NUMBER)),
        )
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
          mesocycleName: protocols.mesocycleName,
          startDate: protocols.startDate,
          endDate: protocols.endDate,
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
      mesocycleName: row.mesocycleName,
      startDate: new Date(row.startDate).toISOString(),
      endDate: new Date(row.endDate).toISOString(),
    };
  }

  /**
   * Bytes do PDF assinado, mesma fronteira IDOR-safe de `findByToken` (token = id,
   * `runAsSystem`, só `ACTIVE`). `null` se o protocolo não existe/não está ativo OU se
   * ainda não tem PDF gerado (protocolo `AUTO_APPROVED` sem passagem pela assinatura CREF).
   */
  async findPdfByToken(protocolId: string): Promise<Buffer | null> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({ pdfContent: protocols.pdfContent })
        .from(protocols)
        .where(and(eq(protocols.id, protocolId), eq(protocols.status, 'ACTIVE')))
        .limit(1),
    );
    return rows[0]?.pdfContent ?? null;
  }

  /**
   * Persiste `protocols` (uma linha nova por mesociclo) + `protocol_versions`. O nº do
   * mesociclo é calculado DENTRO da transação, sob `FOR UPDATE`: `MAX(mesocycleNumber)`
   * do titular + 1 (ou o inicial, se não houver nenhum). Isso serializa qualquer chamada
   * concorrente para o MESMO titular a partir do segundo mesociclo (o `SELECT ... FOR
   * UPDATE` trava as linhas existentes); só a corrida do PRIMEIRO mesociclo (zero linhas
   * para travar) ainda depende do backstop de `isUniqueViolation` abaixo — mesmo cenário
   * que o código já tratava antes desta mudança.
   *
   * Nunca toca o protocolo anterior: quem o supersede é `activateProtocol()`, no
   * instante em que ESTE (o novo) vira `ACTIVE` — nunca na geração/persistência.
   */
  async persist(input: PersistProtocolInput): Promise<PersistedProtocol> {
    const signedAt = input.signed ? new Date() : null;
    const hash = input.signed ? signatureHash(input.content) : null;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + input.totalWeeks * MS_PER_WEEK);

    try {
      return await this.db.runAsUser(input.userId, 'USER', async (tx) => {
        const professionalId = input.signed
          ? await this.assignedActiveProfessional(tx, input.userId)
          : null;
        const mesocycleNumber = await this.nextMesocycleNumber(tx, input.userId);
        const [proto] = await tx
          .insert(protocols)
          .values({
            userId: input.userId,
            version: INITIAL_REVISION_VERSION,
            mesocycleNumber,
            status: input.status,
            approvalStatus: input.approvalStatus,
            professionalId,
            signedAt,
            signatureHash: hash,
            currentWeek: 1,
            totalWeeks: input.totalWeeks,
            mesocycleName: mesocycleName(mesocycleNumber, input.content.phase),
            startDate,
            endDate,
            content: input.content,
            constraints: input.constraints,
            parQFlags: input.parqFlags,
            humanReviewRequired: input.humanReviewRequired,
            reviewUrgency: input.reviewUrgency,
            anamnesisSessionId: input.anamnesisSessionId,
            renewalSessionId: input.renewalSessionId ?? null,
            generatedBy: input.generatedBy,
            modelVersion: input.modelVersion,
            promptVersion: input.promptVersion,
            knowledgeSources: input.knowledgeSources ?? [],
            methodologyVersionId: input.methodologyVersionId ?? null,
            methodologySha256: input.methodologySha256 ?? null,
          })
          .returning({ id: protocols.id });
        if (!proto) throw new Error('persist: INSERT de protocols não retornou id.');

        await tx.insert(protocolVersions).values({
          protocolId: proto.id,
          userId: input.userId,
          version: INITIAL_REVISION_VERSION,
          status: input.status,
          content: input.content,
          changeReason: input.renewalSessionId
            ? 'geração de renovação por fim de mesociclo'
            : 'geração inicial (US-2.4)',
          generatedBy: input.generatedBy,
          knowledgeSources: input.knowledgeSources ?? [],
          methodologyVersionId: input.methodologyVersionId ?? null,
          methodologySha256: input.methodologySha256 ?? null,
          signatureHash: hash,
          signedAt,
        });

        return {
          protocolId: proto.id,
          version: INITIAL_REVISION_VERSION,
          professionalId,
          alreadyExisted: false,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Backstop de corrida (ver doc do método): só alcançável na disputa pelo
        // PRIMEIRO mesociclo do titular (sem linha nenhuma para o `FOR UPDATE` travar).
        // Devolve a linha mais recente do titular — é o que "já existe" quer dizer aqui.
        const [existing] = await this.db.runAsUser(input.userId, 'USER', (tx) =>
          tx
            .select({ id: protocols.id, professionalId: protocols.professionalId })
            .from(protocols)
            .where(eq(protocols.userId, input.userId))
            .orderBy(desc(protocols.mesocycleNumber), desc(protocols.version))
            .limit(1),
        );
        return {
          protocolId: existing?.id ?? 'unknown',
          version: INITIAL_REVISION_VERSION,
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
  async autoRelease(userId: string, protocolId: string): Promise<AutoReleaseResult> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .select({
          content: protocols.content,
          version: protocols.version,
          approvalStatus: protocols.approvalStatus,
          reviewUrgency: protocols.reviewUrgency,
          mesocycleName: protocols.mesocycleName,
          startDate: protocols.startDate,
          endDate: protocols.endDate,
          totalWeeks: protocols.totalWeeks,
        })
        .from(protocols)
        .where(eq(protocols.id, protocolId))
        .for('update')
        .limit(1);
      if (!row || row.approvalStatus !== 'PENDING_REVIEW' || row.reviewUrgency !== 'OPTIONAL') {
        return { released: false, version: row?.version ?? 0 };
      }
      const professionalId = await this.assignedActiveProfessional(tx, userId);
      const content = row.content as ProtocolStructure;
      const signedAt = new Date();
      const hash = signatureHash(content);
      await tx
        .update(protocols)
        .set({
          status: 'ACTIVE',
          approvalStatus: 'AUTO_APPROVED',
          professionalId,
          signedAt,
          signatureHash: hash,
          humanReviewRequired: false,
        })
        .where(eq(protocols.id, protocolId));
      // Renovação de mesociclo: o mesociclo anterior (se houver) só deixa de ser `ACTIVE`
      // agora, no mesmo instante/transação em que este vira `ACTIVE` — nunca antes, para
      // o titular nunca ficar sem protocolo vigente durante a espera pela renovação.
      await supersedePreviousActiveProtocols(tx, userId, protocolId);
      return {
        released: true,
        version: row.version,
        content,
        mesocycleName: row.mesocycleName,
        startDate: row.startDate,
        endDate: row.endDate,
        totalWeeks: row.totalWeeks,
        signatureHash: hash,
        signedAt,
      };
    });
  }

  /** PDF gerado depois (fora da transação de liberação) — `signProtocol` grava o mesmo jeito. */
  async setPdfContent(userId: string, protocolId: string, pdf: Buffer | null): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.update(protocols).set({ pdfContent: pdf }).where(eq(protocols.id, protocolId)),
    );
  }

  /**
   * Dados pessoais (nome/idade/peso/altura/sexo) da anamnese SUBMITTED mais recente do
   * titular, pro PDF do protocolo (US-2.6-PDF) quando a entrega sai do caminho de
   * auto-liberação — mesma lógica de `DashboardService.protocolAnamnesisAnswers`, mas sem
   * as dependências daquele serviço (RBAC de dashboard, decrypt do bloco de saúde, que o
   * PDF não usa). `null` se não achar sessão submetida — quem chama decide o fallback.
   */
  async findLatestPersonalInfo(userId: string): Promise<OnboardingStep1 | null> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ dataBlock1: anamnesisSessions.dataBlock1 })
        .from(anamnesisSessions)
        .where(and(eq(anamnesisSessions.userId, userId), eq(anamnesisSessions.status, 'SUBMITTED')))
        .orderBy(desc(anamnesisSessions.submittedAt))
        .limit(1),
    );
    const row = rows[0];
    if (!row) return null;
    return onboardingStep1Schema.parse(row.dataBlock1);
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

  /**
   * Próximo nº de mesociclo do titular, sob `FOR UPDATE` — trava as linhas existentes
   * (se houver) para serializar qualquer chamada concorrente de `persist()` para o MESMO
   * titular. Zero linhas não trava nada (ver doc de `persist()` sobre o backstop de corrida
   * que cobre exatamente esse caso residual).
   *
   * Achado 2026-09-10 (bug reportado pelo fundador, reproduzido ao vivo — geração de
   * protocolo de titular novo falhando 100% das vezes, 3/3 tentativas do BullMQ, nunca
   * persistindo nada): a versão anterior fazia `SELECT max(...) ... FOR UPDATE` — Postgres
   * proíbe `FOR UPDATE` junto de função de agregação ("FOR UPDATE is not allowed with
   * aggregate functions"), então a query nunca rodava, sempre. Corrigido: `FOR UPDATE` só
   * trava as linhas (sem agregar), o máximo é calculado em código depois de travar — mesma
   * semântica de lock, sql válido.
   */
  private async nextMesocycleNumber(tx: TenantTransaction, userId: string): Promise<number> {
    const rows = (await tx.execute(
      sql`SELECT ${protocols.mesocycleNumber} AS mesocycle_number
          FROM ${protocols}
          WHERE ${protocols.userId} = ${userId}
          FOR UPDATE`,
    )) as unknown as Array<{ mesocycle_number: number | string }>;
    if (rows.length === 0) return INITIAL_MESOCYCLE_NUMBER;
    const max = rows.reduce((acc, row) => Math.max(acc, Number(row.mesocycle_number)), 0);
    return max + 1;
  }
}

/** 23505 = unique_violation do PostgreSQL. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

/**
 * Marca `SUPERSEDED` qualquer OUTRO protocolo `ACTIVE` do mesmo titular, na MESMA
 * transação que ativa `activatingProtocolId` — nunca antes (o titular não pode ficar sem
 * protocolo vigente enquanto o novo é gerado/revisado). Chamada tanto por
 * `ProtocolRepository.autoRelease()` quanto por `DashboardService.signProtocol()`
 * (função solta, não método de classe, para não criar uma dependência de NestJS DI entre
 * os dois módulos — mesmo padrão de `signatureHash` já exportado deste arquivo).
 *
 * Idempotente e seguro na primeiríssima ativação de um titular: não há nenhuma linha
 * `ACTIVE` para encontrar, então é no-op.
 */
export async function supersedePreviousActiveProtocols(
  tx: TenantTransaction,
  userId: string,
  activatingProtocolId: string,
): Promise<void> {
  await tx
    .update(protocols)
    .set({ status: 'SUPERSEDED' })
    .where(
      and(
        eq(protocols.userId, userId),
        eq(protocols.status, 'ACTIVE'),
        ne(protocols.id, activatingProtocolId),
      ),
    );
}
