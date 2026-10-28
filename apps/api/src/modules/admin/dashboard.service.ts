import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, count, desc, eq, inArray, isNotNull, isNull, lte, not, or, sql } from 'drizzle-orm';
import { type PgColumn } from 'drizzle-orm/pg-core';
import { PinoLogger } from 'nestjs-pino';
import {
  amendActiveProtocolSchema,
  anamnesisStructuredSchema,
  approveSubstitutionSchema,
  ControlCenterCapability,
  friendlyIssueMessages,
  onboardingStep1Schema,
  protocolStructureSchema,
  publishExerciseCatalogEntrySchema,
  signProtocolSchema,
  type ProtocolStructure,
  type Weekday,
} from '@movivo/shared';
import { z } from 'zod';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { roleHasCapabilities } from '../auth/capabilities';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import {
  anamnesisSessions,
  checkins,
  conversations,
  dashboardNotificationReads,
  handoffAlerts,
  protocols,
  protocolSubstitutionRequests,
  protocolVersions,
  staff,
  subscriptions,
  users,
  workoutInsights,
  workoutSessions,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { strictSafeParse } from '../../core/validation/strict-input';
import { healthBlockSchema, type HealthBlock } from '../anamnesis/health-block';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { SUBSTITUTION_DISCARDED_MESSAGE } from '../coach/coach-messages';
import { QUEUE } from '../jobs/jobs.config';
import type { WorkoutProtocolChangedJob } from '../jobs/workout-protocol-changed.contract';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { ExerciseCatalogAdminService } from './exercise-catalog-admin.service';
import { buildProtocolPdf } from '../protocol/protocol-pdf.service';
import { signatureHash, supersedePreviousActiveProtocols } from '../protocol/protocol.repository';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { qualityNotices } from '../protocol/contextual-quality';
import { cautionNotices } from '../protocol/protocol-caution';
import {
  CATALOG_SEARCH_MAX_LIMIT,
  searchCatalog,
} from '../catalog/exercises/exercise-catalog-search';
import { findSafeCandidates } from '../catalog/exercises/exercise-substitution';
import {
  ProtocolSubstitutionRepository,
  type SubstitutionItemEdit,
} from '../protocol/protocol-substitution.repository';
import { itemsOf, type SubstitutionChange } from '../protocol/protocol-substitution-items';
import { AI_SUBSTITUTION_REVIEW_WINDOW_MS } from '../protocol/protocol-substitution-release.worker';
import {
  isProfessionalAuthored,
  MANUAL_AMENDMENT_ORIGIN,
  PROFESSIONAL_EDIT_ORIGIN,
} from '../protocol/protocol-origin';
import { normalizedPreferredDays, validDaysPerWeek } from '../protocol/training-days';
import type { UserConstraints } from '../protocol/user-constraints';
import {
  type ProfessionalPrescriptionVerdict,
  type ValidateProtocolInput,
  type ValidationViolation,
  ValidationService,
  violationKey,
} from '../protocol/validation/validation.service';
import { WorkoutPresentationService } from '../protocol/workout-presentation.service';
import {
  PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS,
  type ReviewHoldKind,
  ReviewHoldService,
} from '../protocol/review-hold.service';
import { AuditService } from './audit.service';

/**
 * Union discriminada por `alreadySigned` (não inferida — anotada explícita no `scoped()`
 * de `signProtocol`). Sem isso, dois `return` com conjuntos de campos diferentes fazem o
 * TypeScript mesclar as duas formas num tipo só com campos opcionais, exigindo computar
 * `content`/`mesocycleName`/etc. também no branch "já assinado" só pra bater o formato.
 */
type SignProtocolResult =
  | {
      userId: string;
      version: number;
      signatureHash: string;
      signedAt: string;
      alreadySigned: true;
    }
  | {
      userId: string;
      version: number;
      signatureHash: string;
      signedAt: string;
      alreadySigned: false;
      content: ProtocolStructure;
      mesocycleName: string;
      startDate: Date;
      endDate: Date;
      totalWeeks: number;
    };

type DeliverableProtocol = Extract<SignProtocolResult, { alreadySigned: false }>;

const uuidSchema = z.uuid();
// Posição do item numa proposta de troca em lote (0 a MAX_SUBSTITUTION_ITEMS - 1).
const itemIndexSchema = z.coerce.number().int().min(0).max(2);
// `PARQ` saiu do enum em 2026-08-24: não existe mais item de fila nem tela de PAR-Q — o
// PAR-Q bloqueado agora vive DENTRO do item de protocolo (`origin: 'PARQ'`).
// `SUBSTITUTION` entrou em 2026-09-02: proposta de substituição de exercício via IA, em
// staging (`protocol_substitution_requests`) — ver `ProtocolSubstitutionRepository`.
const kindSchema = z.enum(['PROTOCOL', 'HANDOFF', 'CHECKIN', 'SUBSTITUTION']);
const editSchema = z.object({ content: protocolStructureSchema });
const catalogSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
  protocolId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(CATALOG_SEARCH_MAX_LIMIT).optional(),
});
/** `true` = a tela de revisão está aberta (renova a trava); `false` = fechou (solta e dispara o que venceu). */
const reviewHoldSchema = z.object({ active: z.boolean() });
const resolveSchema = z.object({
  resolution: z.string().trim().min(3).max(80),
  notes: z.string().trim().min(3).max(1000),
  confirmation: z.literal(true),
});

export interface QueueItem {
  id: string;
  kind: 'PROTOCOL' | 'HANDOFF' | 'CHECKIN' | 'SUBSTITUTION';
  severity: 'SAFETY' | 'ALERT' | 'ROUTINE';
  createdAt: string;
  ageMinutes: number;
  title: string;
  summary: string;
  status: string;
  /** Só itens `OPTIONAL`/`PENDING` na categoria "Disponível para Revisão" (fila do CREF). */
  autoReleaseAt: string | null;
  /**
   * POR QUE este item exige revisão humana (2026-08-24, ampliado 2026-09-02 e 2026-09-03).
   * `PARQ` = a sessão de origem está `BLOQUEADO_AGUARDANDO_CLEARANCE` (alerta clínico —
   * assinar aqui também libera o PAR-Q); `FALLBACK` = o protocolo caiu no template
   * conservador do RT (`generated_by = 'FALLBACK_TEMPLATE'`) — o conteúdo nunca passou
   * limpo pela geração/validação, então trava mesmo com PAR-Q liberado (decisão do
   * fundador, 2026-09-03); `EDIT` = um CREF editou o conteúdo e precisa de sign-off fresco;
   * `AI_SUBSTITUTION` = troca de exercício confirmada pelo aluno via WhatsApp, aguardando
   * revisão/liberação automática. `CATALOG_GAP` (2026-09-09) = o aluno pediu um exercício
   * específico que não existe em nenhum lugar do catálogo — mandatory, sem substituto real
   * ainda calculado (ver `substitution.catalogGap`). `null` para os demais itens `optional` e
   * para os que não são protocolo/substituição — não têm motivo a exibir.
   */
  origin: 'PARQ' | 'FALLBACK' | 'EDIT' | 'QUALITY' | 'AI_SUBSTITUTION' | 'CATALOG_GAP' | null;
  isFallback?: boolean;
  /** Só protocolo: o conteúdo vigente é edição do profissional — regerar a descarta. */
  editedByProfessional?: boolean;
  /** O profissional logado já abriu este item (estado de leitura do sino; não altera a fila). */
  read: boolean;
}

/** Tipo de notificação do sino; alvo de `dashboard_notification_reads.kind`. */
export type NotificationType = 'alert' | 'protocol' | 'substitution';

/** Alerta operacional gerado pelo AI Coach, destinado à supervisão do CREF. */
export interface DashboardAlert {
  id: string;
  studentName: string | null;
  level: 'SAFETY' | 'ALERT';
  reason: string;
  sourceType: string | null;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
  /** O profissional logado já abriu este alerta. Ler não resolve. */
  read: boolean;
}

/** Titulo do item de fila de protocolo, com o nome completo do titular. */
export function protocolTitle(name: string | null | undefined) {
  return name ? `Protocolo para Revisão: ${name}` : 'Protocolo para Revisão';
}

/** Título do item de fila de substituição de exercício, com o nome completo do titular. */
export function substitutionTitle(name: string | null | undefined) {
  return name ? `Substituição de Exercício: ${name}` : 'Substituição de Exercício';
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly validation: ValidationService,
    private readonly cipher: HealthCipherService,
    private readonly audit: AuditService,
    private readonly queues: QueueManager,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly healthConsent: HealthConsentService,
    private readonly substitutionRepo: ProtocolSubstitutionRepository,
    private readonly workoutPresentation: WorkoutPresentationService,
    private readonly exerciseCatalogAdmin: ExerciseCatalogAdminService,
    private readonly exerciseCatalog: ExerciseCatalogProvider,
    private readonly reviewHold: ReviewHoldService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DashboardService.name);
  }

  /**
   * Alertas que o AI Coach escalou para acompanhamento humano. Protocolos e propostas de
   * substituição continuam exclusivamente na fila: duplicá-los aqui confundiria a ação
   * esperada do profissional.
   */
  async alerts(actor: AuthenticatedUser) {
    return this.scopedRead(actor, async (tx) => {
      const rows = await tx
        .select({
          id: handoffAlerts.id,
          userId: handoffAlerts.userId,
          studentName: users.name,
          level: handoffAlerts.level,
          reason: handoffAlerts.reason,
          sourceType: handoffAlerts.sourceType,
          status: handoffAlerts.status,
          createdAt: handoffAlerts.createdAt,
          updatedAt: handoffAlerts.updatedAt,
        })
        .from(handoffAlerts)
        .innerJoin(users, eq(users.id, handoffAlerts.userId))
        .where(
          and(
            or(eq(handoffAlerts.status, 'OPEN'), eq(handoffAlerts.status, 'RESOLVED')),
            // Dor após o treino (`WORKOUT`) é alerta do AI Coach e aparece aqui, além de seguir
            // na Fila. Só o ajuste de duração (`WORKOUT_INSIGHT`) fica exclusivo da Fila.
            or(
              isNull(handoffAlerts.sourceType),
              not(eq(handoffAlerts.sourceType, 'WORKOUT_INSIGHT')),
            ),
          ),
        )
        .orderBy(desc(handoffAlerts.createdAt))
        .limit(100);

      // A lista revela o aluno associado a um evento de saúde. A leitura é auditada por
      // alerta, como acontece no detalhe, sem expor o id do aluno ao navegador.
      await Promise.all(
        rows.map((row) => this.auditRead(tx, actor, row.userId, 'handoff_alert', row.id)),
      );
      const readKeys = await this.readKeys(
        tx,
        actor,
        rows.map((row) => ({ type: 'alert', id: row.id, createdAt: row.createdAt })),
      );
      const present = (row: (typeof rows)[number]): DashboardAlert => ({
        id: row.id,
        studentName: row.studentName ?? null,
        level: row.level,
        reason: row.reason,
        sourceType: row.sourceType ?? null,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        read: readKeys.has(`alert:${row.id}`),
      });
      const alerts = rows.map(present);
      return {
        open: alerts.filter((alert) => alert.status === 'OPEN'),
        resolved: alerts.filter((alert) => alert.status === 'RESOLVED'),
      };
    });
  }

  /** Contagem sem PII para o sino do cabeçalho; a lista detalhada é carregada só na aba. */
  async alertsSummary(actor: AuthenticatedUser) {
    return this.scopedRead(actor, async (tx) => {
      const [row] = await tx
        .select({ total: count() })
        .from(handoffAlerts)
        .where(
          and(
            eq(handoffAlerts.status, 'OPEN'),
            or(
              isNull(handoffAlerts.sourceType),
              not(eq(handoffAlerts.sourceType, 'WORKOUT_INSIGHT')),
            ),
          ),
        );
      return { open: Number(row?.total ?? 0) };
    });
  }

  /**
   * Fila do profissional — só protocolo (handoff/check-in ficam fora desta tela;
   * `resolveHandoff`/`handoffDetail`/`checkinDetail` continuam existindo pra uso futuro,
   * só não aparecem aqui). Duas categorias, cada uma ordenada só por idade (mais antigo
   * primeiro):
   *
   * - `mandatory` — protocolo `reviewUrgency: MANDATORY`, de três origens:
   *   · `PARQ` (2026-08-24): a sessão que originou o protocolo está
   *     `BLOQUEADO_AGUARDANDO_CLEARANCE`. Antes desta data, PAR-Q bloqueado era um item
   *     `kind: 'PARQ'` SEPARADO, apontando pra uma sessão sem protocolo nenhum, com tela
   *     e ação próprias. Agora o protocolo existe (gerado em modo conservador) e a
   *     liberação do PAR-Q acontece dentro da assinatura dele — um item, uma tela, uma
   *     ação. `severity: SAFETY`, porque é alerta clínico, não só sign-off.
   *   · `FALLBACK` (2026-09-03): `generated_by = 'FALLBACK_TEMPLATE'` — caiu no template
   *     conservador do RT porque a geração/validação nunca passou limpa (duas tentativas
   *     bloqueadas, ou o LLM esgotou os retries). `severity: ALERT`, checado ANTES de
   *     `EDIT` porque as duas colunas podem ser verdade ao mesmo tempo só em teoria (um
   *     fallback nunca é editado antes de existir) — a ordem documenta a prioridade, não
   *     resolve ambiguidade real.
   *   · `EDIT`: um CREF editou o conteúdo à mão e precisa de sign-off fresco.
   *     `severity: ALERT`.
   *   Nenhum tem job de auto-liberação agendado; nenhum sai sozinho.
   * - `optional` — protocolo `reviewUrgency: OPTIONAL`: **todo** protocolo sem PAR-Q
   *   bloqueado cai aqui, PASS limpo incluso (decisão do fundador, 2026-08-18: nem PASS
   *   entrega sozinho na hora — ver `protocol-planner.ts`). Edições manuais preservam o prazo
   *   de auto-liberação e o job libera o conteúdo persistido mais recente; assinatura manual
   *   antes do prazo torna o job agendado um no-op.
   */
  async queue(actor: AuthenticatedUser) {
    const {
      protocolMandatory,
      optional,
      substitutionMandatory,
      substitutionOptional,
      workoutHandoffs,
    } = await this.scopedRead(actor, async (tx) => {
      // LEFT JOIN (não INNER): protocolo anterior à migração 0035 não tem
      // `anamnesis_session_id` e continua aparecendo na fila normalmente, como `EDIT`.
      const pendingProtocols = await tx
        .select({
          id: protocols.id,
          createdAt: protocols.createdAt,
          status: protocols.status,
          name: users.name,
          reviewUrgency: protocols.reviewUrgency,
          generatedBy: protocols.generatedBy,
          parqState: anamnesisSessions.parqState,
          constraints: protocols.constraints,
          anamnesisSessionId: protocols.anamnesisSessionId,
        })
        .from(protocols)
        .innerJoin(users, eq(users.id, protocols.userId))
        .leftJoin(anamnesisSessions, eq(anamnesisSessions.id, protocols.anamnesisSessionId))
        .where(eq(protocols.approvalStatus, 'PENDING_REVIEW'));

      const mandatory: QueueItem[] = [];
      const optional: QueueItem[] = [];
      for (const row of pendingProtocols) {
        const isOptional = row.reviewUrgency === 'OPTIONAL';
        const fromParq = row.parqState === 'BLOQUEADO_AGUARDANDO_CLEARANCE';
        const fromFallback = row.generatedBy === 'FALLBACK_TEMPLATE';
        const fromQuality =
          !isProfessionalAuthored(row.generatedBy) &&
          qualityNotices(
            (row.constraints as { contextualQuality?: unknown } | null)?.contextualQuality,
          ).length > 0;
        (isOptional ? optional : mandatory).push({
          ...this.item(
            row.id,
            'PROTOCOL',
            isOptional ? 'ROUTINE' : fromParq ? 'SAFETY' : 'ALERT',
            row.createdAt,
            protocolTitle(row.name),
            row.status,
            row.status,
            isOptional
              ? new Date(row.createdAt.getTime() + PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS).toISOString()
              : null,
            isOptional
              ? null
              : fromParq
                ? 'PARQ'
                : fromFallback
                  ? 'FALLBACK'
                  : fromQuality
                    ? 'QUALITY'
                    : 'EDIT',
          ),
          isFallback: fromFallback,
          editedByProfessional: isProfessionalAuthored(row.generatedBy),
        });
      }

      // Propostas de substituição de exercício via IA, ainda pendentes de decisão. Desde
      // 2026-09-03 (a pedido do fundador) têm a MESMA divisão obrigatória/opcional do
      // protocolo: `substitutionMandatory` quando a sessão de origem do protocolo ATIVO do
      // titular está `BLOQUEADO_AGUARDANDO_CLEARANCE` (mesmo LEFT JOIN de `pendingProtocols`
      // acima) OU quando a própria proposta já nasceu `reviewUrgency: MANDATORY` (2026-09-09
      // — pedido de exercício que não é elegível ou não existe no catálogo, ver
      // `AiResponseWorker`/`ProtocolSubstitutionRepository`) — nenhuma dessas tem
      // `autoReleaseAt` (o job nem chega a ser agendado). As demais continuam em
      // `substitutionOptional`, auto-liberando em 30min como sempre.
      const pendingSubstitutions = await tx
        .select({
          id: protocolSubstitutionRequests.id,
          createdAt: protocolSubstitutionRequests.createdAt,
          status: protocolSubstitutionRequests.status,
          reviewUrgency: protocolSubstitutionRequests.reviewUrgency,
          catalogGap: protocolSubstitutionRequests.catalogGap,
          name: users.name,
          parqState: anamnesisSessions.parqState,
        })
        .from(protocolSubstitutionRequests)
        .innerJoin(users, eq(users.id, protocolSubstitutionRequests.userId))
        .leftJoin(protocols, eq(protocols.id, protocolSubstitutionRequests.protocolId))
        .leftJoin(anamnesisSessions, eq(anamnesisSessions.id, protocols.anamnesisSessionId))
        .where(eq(protocolSubstitutionRequests.status, 'PENDING'));

      const substitutionMandatory: QueueItem[] = [];
      const substitutionOptional: QueueItem[] = [];
      for (const row of pendingSubstitutions) {
        const fromParq = row.parqState === 'BLOQUEADO_AGUARDANDO_CLEARANCE';
        const mandatory = fromParq || row.reviewUrgency === 'MANDATORY';
        (mandatory ? substitutionMandatory : substitutionOptional).push(
          this.item(
            row.id,
            'SUBSTITUTION',
            fromParq ? 'SAFETY' : mandatory ? 'ALERT' : 'ROUTINE',
            row.createdAt,
            substitutionTitle(row.name),
            row.status,
            row.status,
            mandatory
              ? null
              : new Date(row.createdAt.getTime() + AI_SUBSTITUTION_REVIEW_WINDOW_MS).toISOString(),
            row.catalogGap ? 'CATALOG_GAP' : 'AI_SUBSTITUTION',
          ),
        );
      }

      const pendingWorkoutHandoffs = await tx
        .select({
          id: handoffAlerts.id,
          createdAt: handoffAlerts.createdAt,
          status: handoffAlerts.status,
          level: handoffAlerts.level,
          reason: handoffAlerts.reason,
          name: users.name,
        })
        .from(handoffAlerts)
        .innerJoin(users, eq(users.id, handoffAlerts.userId))
        .where(
          and(
            eq(handoffAlerts.status, 'OPEN'),
            or(
              eq(handoffAlerts.sourceType, 'WORKOUT'),
              eq(handoffAlerts.sourceType, 'WORKOUT_INSIGHT'),
            ),
          ),
        );
      const workoutHandoffs = pendingWorkoutHandoffs.map((row) =>
        this.item(
          row.id,
          'HANDOFF',
          row.level,
          row.createdAt,
          row.name ? `Acompanhamento de treino: ${row.name}` : 'Acompanhamento de treino',
          row.reason,
          row.status,
          null,
        ),
      );

      const byAge = (a: QueueItem, b: QueueItem) => a.createdAt.localeCompare(b.createdAt);
      const typeOf = (item: QueueItem): NotificationType =>
        item.kind === 'HANDOFF'
          ? 'alert'
          : item.kind === 'SUBSTITUTION'
            ? 'substitution'
            : 'protocol';
      const everyItem = [
        ...mandatory,
        ...optional,
        ...substitutionMandatory,
        ...substitutionOptional,
        ...workoutHandoffs,
      ];
      const readKeys = await this.readKeys(
        tx,
        actor,
        everyItem.map((item) => ({
          type: typeOf(item),
          id: item.id,
          createdAt: new Date(item.createdAt),
        })),
      );
      for (const item of everyItem) item.read = readKeys.has(`${typeOf(item)}:${item.id}`);
      return {
        protocolMandatory: mandatory.sort(byAge),
        optional: optional.sort(byAge),
        substitutionMandatory: substitutionMandatory.sort(byAge),
        substitutionOptional: substitutionOptional.sort(byAge),
        workoutHandoffs: workoutHandoffs.sort(byAge),
      };
    });

    const mandatory = [...workoutHandoffs, ...protocolMandatory].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    return {
      mandatory,
      optional,
      substitutionMandatory,
      substitutionOptional,
      counts: {
        mandatory: mandatory.length,
        optional: optional.length,
        substitutionMandatory: substitutionMandatory.length,
        substitutionOptional: substitutionOptional.length,
        total:
          mandatory.length +
          optional.length +
          substitutionMandatory.length +
          substitutionOptional.length,
      },
    };
  }

  events(actor: AuthenticatedUser) {
    this.assertStaffRead(actor);
    return this.queueEvents.stream();
  }

  async detail(actor: AuthenticatedUser, rawKind: string, rawId: string): Promise<unknown> {
    const kind = this.parse(kindSchema, rawKind);
    const id = this.parse(uuidSchema, rawId);
    if (kind === 'PROTOCOL') return this.protocolDetail(actor, id);
    if (kind === 'CHECKIN') return this.checkinDetail(actor, id);
    if (kind === 'SUBSTITUTION') return this.substitutionDetail(actor, id);
    return this.handoffDetail(actor, id);
  }

  /**
   * Autocomplete do exercício no editor de protocolo (achado 2026-10-15, produção): só
   * exercícios PUBLICADOS do catálogo oficial, por termo (`searchCatalog`). Com `protocolId`,
   * cada resultado diz o que o catálogo contraindica para AQUELE aluno — informação para a
   * decisão do profissional, nunca filtro (a decisão é dele; o conflito é reconhecido na
   * assinatura). Não cria nem altera exercício.
   */
  async searchExerciseCatalog(actor: AuthenticatedUser, rawQuery: unknown) {
    this.assertStaffRead(actor);
    const query = this.parse(catalogSearchQuerySchema, rawQuery);
    let studentTags = new Set<string>();
    if (query.protocolId) {
      const protocolId = query.protocolId;
      const row = await this.scopedRead(actor, (tx) => this.requireProtocol(tx, protocolId));
      const constraints = (row.constraints ?? {}) as { injuryTags?: string[] };
      studentTags = new Set([
        ...(constraints.injuryTags ?? []),
        ...((row.parQFlags as string[] | null) ?? []),
      ]);
    }
    const items = searchCatalog(this.exerciseCatalog.getAll(), query.q, query.limit).map(
      (exercise) => ({
        id: exercise.id,
        name: exercise.name,
        pattern: exercise.pattern,
        muscleGroups: exercise.muscleGroups,
        equipment: exercise.equipment,
        measurement: exercise.measurement ?? 'REPS',
        contraindicatedForStudent: exercise.contraindicatedFor.filter((tag) =>
          studentTags.has(tag),
        ),
      }),
    );
    return { items };
  }

  async anamnesisAnswers(actor: AuthenticatedUser, rawId: string) {
    const id = this.parse(uuidSchema, rawId);
    return this.protocolAnamnesisAnswers(actor, id);
  }

  async editProtocol(actor: AuthenticatedUser, rawId: string, rawBody: unknown) {
    const id = this.parse(uuidSchema, rawId);
    const body = this.parse(editSchema, rawBody);
    const edited = await this.scoped(actor, async (tx) => {
      const row = await this.requireProtocol(tx, id, true);
      const content = this.canonicalExerciseNames(body.content);
      // Achado 2026-10-15 (produção): a edição é PRESCRIÇÃO do profissional, não saída da IA.
      // Regras de prescrição automática viram conflito profissional, exceto a contraindicação
      // do catálogo: ela é registrada na auditoria sem alerta nem confirmação redundante. O que
      // continua impedindo salvar é integridade/compliance: exercício fora do catálogo, sessões
      // acima dos dias disponíveis do aluno, dia repetido e linguagem proibida.
      const verdict = this.professionalVerdict(row, content);
      this.assertNoIntegrityViolations(verdict.blocking);
      const decisionConflicts = this.conflictsRequiringAcknowledgment(verdict.conflicts);
      const beforeHash = this.hashJson(row.content);
      const afterHash = signatureHash(content);
      await tx
        .update(protocols)
        .set({
          content,
          status: 'PENDING_SIGNATURE',
          approvalStatus: 'PENDING_REVIEW',
          professionalId: null,
          signedAt: null,
          signatureHash: null,
          humanReviewRequired: true,
          // Procedência do conteúdo vigente — decidida aqui, pelo endpoint autenticado, nunca
          // pelo cliente. A versão da IA continua em `protocol_versions`.
          generatedBy: PROFESSIONAL_EDIT_ORIGIN,
        })
        .where(eq(protocols.id, id));
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: row.userId,
        action: 'PROTOCOL_EDITED',
        entityType: 'protocol',
        entityId: id,
        changes: {
          beforeHash,
          afterHash,
          origin: PROFESSIONAL_EDIT_ORIGIN,
          validation: decisionConflicts.length > 0 ? 'PROFESSIONAL_CONFLICTS' : 'PASS',
          violations: verdict.conflicts.map((violation) => violation.rule),
        },
      });
      return {
        id,
        status: 'PENDING_SIGNATURE',
        validation: decisionConflicts.length > 0 ? 'PROFESSIONAL_CONFLICTS' : 'PASS',
        // Mantido por compatibilidade com a tela: são avisos, não bloqueio — o profissional
        // reconhece os conflitos relevantes na assinatura (`acknowledgedConflicts`). A
        // contraindicação do catálogo é registrada na auditoria como decisão do CREF sem
        // exigir reconhecimento redundante.
        violations: decisionConflicts,
        conflicts: this.conflictPayload(decisionConflicts),
      };
    });
    this.queueEvents.emit('protocol');
    return edited;
  }

  /**
   * Alteração manual de um protocolo que já está em uso. Diferente da edição pré-assinatura,
   * ela nunca remove a assinatura vigente: valida, versiona, assina e entrega tudo no mesmo
   * fluxo. A versão esperada também impede que duas revisões se sobreponham silenciosamente.
   */
  async amendActiveProtocol(actor: AuthenticatedUser, rawId: string, rawBody: unknown) {
    const id = this.parse(uuidSchema, rawId);
    const body = this.parse(amendActiveProtocolSchema, rawBody);
    const amended = await this.scoped(actor, async (tx): Promise<DeliverableProtocol> => {
      const row = await this.requireProtocol(tx, id, true);
      if (row.status !== 'ACTIVE' || !row.signedAt || !row.signatureHash || !row.professionalId) {
        throw new BadRequestException('Somente um protocolo ativo e assinado pode ser alterado.');
      }
      if (row.version !== body.expectedVersion) {
        throw new ConflictException({
          code: 'PROTOCOL_VERSION_CONFLICT',
          message: 'O protocolo foi atualizado. Recarregue a tela antes de salvar.',
        });
      }
      if (!(await this.healthConsent.hasActiveForUser(row.userId))) {
        throw new BadRequestException({
          code: 'HEALTH_CONSENT_REVOKED',
          message: 'Consentimento de dados de saúde revogado — atualização indisponível.',
        });
      }
      await this.assertCrefCredential(tx, actor);
      const content = this.canonicalExerciseNames(body.content);
      // Mesma regra da edição na fila: integridade bloqueia; divergências das regras
      // automáticas ficam registradas. As demais além da contraindicação exigem confirmação.
      const verdict = this.professionalVerdict(row, content);
      this.assertNoIntegrityViolations(verdict.blocking);
      this.assertConflictsAcknowledged(
        this.conflictsRequiringAcknowledgment(verdict.conflicts),
        body.acknowledgedConflicts,
      );

      const now = new Date();
      const nextVersion = row.version + 1;
      const hash = signatureHash(content);
      await tx
        .update(protocols)
        .set({
          content,
          version: nextVersion,
          generatedBy: MANUAL_AMENDMENT_ORIGIN,
          professionalId: actor.userId,
          signedAt: now,
          signatureHash: hash,
          approvalStatus: 'HUMAN_APPROVED',
          humanReviewRequired: false,
          reviewUrgency: null,
          // O PDF anterior descreve a versão anterior; a entrega abaixo o substitui.
          pdfContent: null,
        })
        .where(and(eq(protocols.id, id), eq(protocols.version, body.expectedVersion)));
      // Uma proposta de substituição foi calculada contra a versão anterior. Ela não pode
      // reaparecer na fila nem ser autoaplicada depois desta emenda manual.
      const pendingSubstitutions = await tx
        .select()
        .from(protocolSubstitutionRequests)
        .where(
          and(
            eq(protocolSubstitutionRequests.protocolId, id),
            eq(protocolSubstitutionRequests.status, 'PENDING'),
          ),
        );
      for (const request of pendingSubstitutions) {
        await tx
          .update(protocolSubstitutionRequests)
          .set({
            status: 'DISCARDED',
            decidedAt: now,
            decidedBy: actor.userId,
            items: itemsOf(request).map((item) => ({ ...item, decision: 'DISCARDED' })),
          })
          .where(eq(protocolSubstitutionRequests.id, request.id));
      }
      await tx.insert(protocolVersions).values({
        protocolId: id,
        userId: row.userId,
        version: nextVersion,
        status: 'ACTIVE',
        content,
        ...(verdict.conflicts.length > 0
          ? { diff: this.professionalOverrideDiff(verdict.conflicts) }
          : {}),
        changeReason: body.reason,
        generatedBy: MANUAL_AMENDMENT_ORIGIN,
        signatureHash: hash,
        signedAt: now,
      });
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: row.userId,
        action: 'PROTOCOL_AMENDED',
        entityType: 'protocol',
        entityId: id,
        changes: {
          fromVersion: row.version,
          toVersion: nextVersion,
          beforeHash: this.hashJson(row.content),
          afterHash: hash,
          reasonHash: this.hashJson(body.reason),
          origin: MANUAL_AMENDMENT_ORIGIN,
          overriddenRules: verdict.conflicts.map((violation) => violation.rule),
        },
      });
      return {
        userId: row.userId,
        version: nextVersion,
        signatureHash: hash,
        signedAt: now.toISOString(),
        alreadySigned: false,
        content,
        mesocycleName: row.mesocycleName,
        startDate: row.startDate,
        endDate: row.endDate,
        totalWeeks: row.totalWeeks,
      };
    });

    await this.deliverProtocol(actor, id, amended, 'amended');
    await this.notifyWorkoutOfProtocolChange(amended.userId, 'ADJUSTMENT', amended.version);
    this.queueEvents.emit('protocol');
    return {
      id,
      version: amended.version,
      signatureHash: amended.signatureHash,
      signedAt: amended.signedAt,
      alreadySigned: false,
    };
  }

  /**
   * Assinatura CREF — desde 2026-08-24 é também o ÚNICO caminho de liberação de PAR-Q.
   *
   * A tela e a ação separadas de "liberar PAR-Q" deixaram de existir: o protocolo de um
   * titular com PAR-Q bloqueado é gerado em modo conservador e cai nesta mesma fila como
   * `MANDATORY`. Assinar aqui faz as duas coisas de uma vez, na MESMA transação — o RT não
   * consegue mais liberar o PAR-Q e esquecer de assinar o treino (nem o inverso), e não há
   * janela entre os dois atos onde o estado fique incoerente.
   */
  /**
   * Tela de revisão/edição aberta (`active: true`, renovado de tempos em tempos) ou fechada
   * (`active: false`), para protocolo (`PROTOCOL`) e troca de exercício proposta pela IA
   * (`SUBSTITUTION`). Enquanto aberta, a liberação automática que vencer fica esperando; ao
   * fechar, o que venceu é enviado na hora. Ver `ReviewHoldService`.
   */
  async setReviewHold(
    actor: AuthenticatedUser,
    kind: ReviewHoldKind,
    rawId: string,
    rawBody: unknown,
  ) {
    this.assertStaffWrite(actor);
    const id = this.parse(uuidSchema, rawId);
    const { active } = this.parse(reviewHoldSchema, rawBody);
    const userId =
      kind === 'PROTOCOL'
        ? await this.scopedRead(actor, async (tx) => (await this.requireProtocol(tx, id)).userId)
        : await this.substitutionOwner(actor, id);
    const target = { kind, userId, id } as const;
    if (active) {
      await this.reviewHold.hold(target);
      return { active: true, released: false };
    }
    const released = await this.reviewHold.release(target);
    return { active: false, released };
  }

  /** Titular dono da proposta de troca, ou 404 se não existir/estiver fora do escopo. */
  private async substitutionOwner(actor: AuthenticatedUser, id: string): Promise<string> {
    const request = await this.substitutionRepo.findById(
      { userId: actor.userId, role: actor.role },
      id,
    );
    if (!request) throw new NotFoundException('Proposta de substituição não encontrada.');
    return request.userId;
  }

  async signProtocol(actor: AuthenticatedUser, rawId: string, rawBody: unknown) {
    const id = this.parse(uuidSchema, rawId);
    const body = this.parse(signProtocolSchema, rawBody);
    const signed = await this.scoped(actor, async (tx): Promise<SignProtocolResult> => {
      const row = await this.requireProtocol(tx, id, true);
      // Consentimento de saúde revogado → nada de assinar, para QUALQUER protocolo (não só
      // os de PAR-Q). Assinar é criar um documento novo a partir de dado de saúde e
      // disparar uma entrega; se o titular retirou a base legal, o ato inteiro perde
      // fundamento (Alexandre §5). Vem ANTES de qualquer escrita, de propósito.
      if (!(await this.healthConsent.hasActiveForUser(row.userId))) {
        throw new BadRequestException({
          code: 'HEALTH_CONSENT_REVOKED',
          message: 'Consentimento de dados de saúde revogado — assinatura indisponível.',
        });
      }
      if (row.status === 'ACTIVE' && row.signedAt && row.signatureHash && row.professionalId) {
        return {
          userId: row.userId,
          version: row.version,
          signatureHash: row.signatureHash,
          signedAt: row.signedAt.toISOString(),
          alreadySigned: true,
        };
      }
      if (row.status !== 'PENDING_SIGNATURE' || row.approvalStatus !== 'PENDING_REVIEW') {
        throw new BadRequestException('Este protocolo não está aguardando assinatura.');
      }
      // `ADMIN` (conta fundador) pula a checagem de credencial CREF — decisão do
      // fundador 2026-08-22: a MOVIVO no início só tem um profissional CREF, também
      // sócio-fundador, e a conta dele já é `ADMIN`. `PROFESSIONAL` continua exigindo
      // CREF ativo e verificado; isso NÃO abre exceção pra esse papel.
      await this.assertCrefCredential(tx, actor);
      const parsedContent = protocolStructureSchema.safeParse(row.content);
      if (!parsedContent.success) {
        // Achado 2026-08-22: este `.parse()` era direto (sem try/catch) — um `ZodError`
        // não é `HttpException`, então o filtro padrão do Nest vira um 500 genérico
        // ("Internal server error") sem pista nenhuma de qual campo do conteúdo salvo
        // não bate mais com o schema atual. Agora falha com 400 + os `issues` do Zod,
        // deixando o motivo visível pro RT e pro log.
        this.logger.error(
          { id, issues: parsedContent.error.issues },
          'conteudo do protocolo nao passa na validacao atual do schema — assinatura bloqueada',
        );
        throw new BadRequestException({
          code: 'PROTOCOL_CONTENT_INVALID',
          message:
            'O conteúdo deste protocolo não passa na validação atual. Corrija antes de assinar.',
          issues: friendlyIssueMessages(parsedContent.error.issues, row.content).map((message) => ({
            message,
          })),
        });
      }
      const content = parsedContent.data;
      // Achado 2026-10-15 (produção): conteúdo que o PROFISSIONAL editou (origem gravada pelo
      // `editProtocol`, nunca pelo cliente) não é vetado pelas regras de prescrição automática.
      // A assinatura registra os overrides; conflitos além da contraindicação ainda exigem
      // reconhecimento explícito. Conteúdo da IA continua sob o veto inteiro de sempre.
      let overrides: ValidationViolation[] = [];
      if (isProfessionalAuthored(row.generatedBy)) {
        const verdict = this.professionalVerdict(row, content);
        this.assertNoIntegrityViolations(verdict.blocking);
        this.assertConflictsAcknowledged(
          this.conflictsRequiringAcknowledgment(verdict.conflicts),
          body.acknowledgedConflicts,
        );
        overrides = verdict.conflicts;
      } else {
        const verdict = this.validation.validate({
          structure: content,
          constraints: this.validationConstraints(row),
          parqFlags: row.parQFlags as UserConstraints['injuryTags'],
        });
        if (verdict.action !== 'PASS') {
          throw new BadRequestException({
            code: 'PROTOCOL_NOT_SAFE_TO_SIGN',
            violations: verdict.violations,
          });
        }
      }
      const now = new Date();
      const nextVersion = row.version + 1;
      const hash = signatureHash(content);
      await tx
        .update(protocols)
        .set({
          version: nextVersion,
          status: 'ACTIVE',
          approvalStatus: 'HUMAN_APPROVED',
          professionalId: actor.userId,
          signedAt: now,
          signatureHash: hash,
          humanReviewRequired: false,
        })
        .where(eq(protocols.id, id));
      // Renovação de mesociclo: o mesociclo anterior (se houver) só deixa de ser `ACTIVE`
      // agora, na MESMA transação — mesmo racional de `ProtocolRepository.autoRelease()`.
      await supersedePreviousActiveProtocols(tx, this.cipher, row.userId, id, this.logger);
      await tx.insert(protocolVersions).values({
        protocolId: id,
        userId: row.userId,
        version: nextVersion,
        status: 'ACTIVE',
        content,
        ...(overrides.length > 0 ? { diff: this.professionalOverrideDiff(overrides) } : {}),
        changeReason: 'revisao e assinatura humana CREF',
        generatedBy: row.generatedBy,
        signatureHash: hash,
        signedAt: now,
      });
      // Liberação do PAR-Q, na MESMA transação da assinatura. A função é `SECURITY
      // DEFINER` e recebe o PROTOCOLO (não a sessão): ela mesma deriva a sessão, confere
      // que pertence ao mesmo titular, revalida cargo/CREF/consentimento e devolve `NULL`
      // quando não há nada a liberar (protocolo sem sessão vinculada, ou PAR-Q já
      // liberado). Assinatura de protocolo comum, portanto, é no-op silencioso aqui.
      const releaseRows = (await tx.execute(
        sql`SELECT public.release_parq_on_signature(${id}::uuid) AS user_id`,
      )) as unknown as Array<{ user_id: string | null }>;
      const parqReleasedFor = releaseRows[0]?.user_id ?? null;

      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: row.userId,
        action: 'PROTOCOL_SIGNED',
        entityType: 'protocol',
        entityId: id,
        changes: {
          version: nextVersion,
          signatureHash: hash,
          signedAt: now.toISOString(),
          ...(overrides.length > 0
            ? { overriddenRules: overrides.map((violation) => violation.rule) }
            : {}),
        },
      });
      // Evento SEPARADO, não um campo dentro do `PROTOCOL_SIGNED`: liberar PAR-Q é o ato
      // jurídico-profissional que a `anamnesis_session` precisa carregar no seu próprio
      // rastro (mesma `action` da tela removida, para que a auditoria histórica continue
      // consultável por uma string só).
      if (parqReleasedFor && row.anamnesisSessionId) {
        await this.audit.append(tx, {
          actorId: actor.userId,
          userId: row.userId,
          action: 'PARQ_RELEASED_BY_HUMAN',
          entityType: 'anamnesis_session',
          entityId: row.anamnesisSessionId,
          changes: {
            viaProtocolSignature: true,
            protocolId: id,
            previousState: 'BLOQUEADO_AGUARDANDO_CLEARANCE',
            newState: 'LIBERADO_COM_RESSALVA_RT',
            actorRole: actor.role,
          },
        });
      }
      return {
        userId: row.userId,
        version: nextVersion,
        signatureHash: hash,
        signedAt: now.toISOString(),
        alreadySigned: false,
        content,
        mesocycleName: row.mesocycleName,
        startDate: row.startDate,
        endDate: row.endDate,
        totalWeeks: row.totalWeeks,
      };
    });

    // PDF do protocolo (US-2.6-PDF), gerado sob RLS agora que a assinatura confirmou o
    // conteúdo final. Nunca bloqueia a assinatura em si nem a entrega: se falhar, o PDF
    // fica `NULL` e o worker de outbound cai automaticamente no texto+link de sempre
    // (`WhatsappOutboundWorker.buildDelivery`) — "nunca lança, sempre decide" (§12).
    let aiSummary: string | undefined;
    if (!signed.alreadySigned) {
      try {
        const { personal } = await this.protocolAnamnesisAnswers(actor, id);
        const pdf = await buildProtocolPdf({
          content: signed.content,
          mesocycleName: signed.mesocycleName,
          startDate: signed.startDate,
          endDate: signed.endDate,
          totalWeeks: signed.totalWeeks,
          signatureHash: signed.signatureHash,
          signedAt: new Date(signed.signedAt),
          student: personal,
        });
        const encryptedPdf = await this.cipher.encryptBytes(pdf);
        await this.scoped(actor, (tx) =>
          tx.update(protocols).set({ pdfContent: encryptedPdf }).where(eq(protocols.id, id)),
        );
        // 2ª bolha da entrega (achado 2026-09-04): só vale a pena gerar quando o PDF saiu —
        // sem PDF, a entrega cai no texto+link de sempre, que não usa este resumo.
        aiSummary = await this.workoutPresentation.present({
          userId: signed.userId,
          user: { name: personal.name, phoneNumber: personal.phoneNumber, email: personal.email },
          biologicalSex: personal.biologicalSex,
          content: signed.content,
          totalWeeks: signed.totalWeeks,
          mesocycleName: signed.mesocycleName,
          reason: 'INITIAL',
        });
      } catch (error) {
        this.logger.warn(
          { id, err: error instanceof Error ? error.message : String(error) },
          'geracao do PDF do protocolo falhou — entrega cai para texto+link',
        );
      }
    }

    const outbound: WhatsappOutboundJob = {
      userId: signed.userId,
      type: 'PROTOCOL_DELIVERY',
      protocolId: id,
      protocolVersion: signed.version,
      dedupeId: `signed-${id}-${signed.version}`,
      text: aiSummary,
    };
    if (!signed.alreadySigned) {
      await this.queues.enqueue(QUEUE.whatsappOutbound, 'signed-protocol-delivery', outbound, {
        jobId: `signed-protocol-${id}-${signed.version}`,
      });
      this.queueEvents.emit('protocol');
    }
    return {
      id,
      version: signed.version,
      signatureHash: signed.signatureHash,
      signedAt: signed.signedAt,
      alreadySigned: signed.alreadySigned,
    };
  }

  /**
   * Detalhe de uma proposta de substituição de exercício via IA (achado 2026-09-02): o que
   * vai virar o quê, o motivo, e a conversa recente em volta (contexto pro profissional
   * decidir sem precisar abrir o WhatsApp à parte).
   */
  private async substitutionDetail(actor: AuthenticatedUser, id: string) {
    const loaded = await this.scopedRead(actor, async (tx) => {
      const [row] = await tx
        .select()
        .from(protocolSubstitutionRequests)
        .where(eq(protocolSubstitutionRequests.id, id))
        .limit(1);
      if (!row) throw new NotFoundException('Proposta de substituição não encontrada.');
      const [owner] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      await this.auditRead(tx, actor, row.userId, 'protocol_substitution_request', id);

      const replayRows = (
        await tx
          .select({
            id: conversations.id,
            userId: conversations.userId,
            direction: conversations.direction,
            content: conversations.content,
            createdAt: conversations.createdAt,
          })
          .from(conversations)
          .where(and(eq(conversations.userId, row.userId), eq(conversations.hiddenInPanel, false)))
          .orderBy(desc(conversations.createdAt))
          .limit(20)
      ).map((r) => ({ ...r, studentName: owner?.name ?? null }));
      return { row, owner, replayRows };
    });
    const { row, owner, replayRows } = loaded;

    // Achado 2026-09-30 (troca em lote): a tela única lista cada troca; para cada item o
    // profissional pode aprovar, descartar ou trocar por outra opção SEGURA para este aluno
    // (mesmo filtro determinístico da oferta ao aluno, recomputado agora contra o protocolo
    // vivo). Só proposta pendente precisa das opções.
    const items = itemsOf(row);
    const review =
      row.status === 'PENDING'
        ? await this.substitutionRepo.loadProtocolForReview(
            { userId: actor.userId, role: actor.role },
            row.protocolId,
          )
        : null;
    const catalog = this.exerciseCatalog.getAll();
    const itemViews = items.map((item, index) => {
      const source = this.exerciseCatalog.getById(item.fromExerciseId);
      const options =
        review && source
          ? findSafeCandidates(source, review.constraints, catalog).map((candidate) => ({
              id: candidate.id,
              name: candidate.name,
            }))
          : [];
      // A escolha atual sempre aparece entre as opções (mesmo a que o aluno pediu fora da
      // curadoria) para o seletor nunca perder o valor corrente.
      if (item.toExerciseId && !options.some((option) => option.id === item.toExerciseId)) {
        options.unshift({ id: item.toExerciseId, name: item.toExerciseName });
      }
      return {
        index,
        from: { id: item.fromExerciseId, name: item.fromExerciseName },
        to: { id: item.toExerciseId, name: item.toExerciseName },
        catalogGap: item.catalogGap,
        mandatory: item.mandatory,
        decision: item.decision,
        options,
      };
    });

    // Achado 2026-09-09: `reviewUrgency: MANDATORY` (elegibilidade fora da curadoria, ou
    // `catalogGap`) nunca tem `autoReleaseAt` — mesma regra de PAR-Q bloqueante, só que
    // decidida na criação da proposta em vez de derivada ao vivo (ver `queue()`).
    const mandatory = row.reviewUrgency === 'MANDATORY';
    const item = this.item(
      id,
      'SUBSTITUTION',
      mandatory ? 'ALERT' : 'ROUTINE',
      row.createdAt,
      substitutionTitle(owner?.name),
      row.status,
      row.status,
      row.status === 'PENDING' && !mandatory
        ? new Date(row.createdAt.getTime() + AI_SUBSTITUTION_REVIEW_WINDOW_MS).toISOString()
        : null,
      row.catalogGap ? 'CATALOG_GAP' : 'AI_SUBSTITUTION',
    );
    return {
      item,
      context: {},
      substitution: {
        id: row.id,
        protocolId: row.protocolId,
        // Espelho do 1º item para leitores anteriores ao lote; `items` é o completo.
        from: { id: row.fromExerciseId, name: row.fromExerciseName },
        to: { id: row.toExerciseId, name: row.toExerciseName },
        items: itemViews,
        diff: row.diff,
        changeReason: row.changeReason,
        status: row.status,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        reviewUrgency: row.reviewUrgency,
        catalogGap: row.catalogGap,
      },
      replay: (await this.groupReplays(replayRows))[0],
    };
  }

  /**
   * Profissional aprova a troca ANTES da janela de 30 min — aplica imediatamente, mesma
   * mecânica de `ProtocolSubstitutionReleaseWorker` (reusada via `ProtocolSubstitutionRepository
   * .release()`, o único caminho que de fato aplica). PDF completo do protocolo atualizado é
   * gerado e a entrega por WhatsApp reusa o mesmo pipeline (`PROTOCOL_DELIVERY`).
   *
   * Achado 2026-09-30 (troca em lote): o corpo é opcional e traz a decisão do profissional por
   * item (`APPROVE` com outro exercício, ou `DISCARD`); sem corpo, aprova todos como estão.
   * Todos os itens descartados equivale a recusar a proposta (e o aluno é avisado).
   */
  async approveSubstitutionNow(actor: AuthenticatedUser, rawId: string, rawBody?: unknown) {
    this.assertStaffWrite(actor);
    const id = this.parse(uuidSchema, rawId);
    const body = this.parse(approveSubstitutionSchema, rawBody ?? {});
    const edits: SubstitutionItemEdit[] = (body.items ?? []).map((edit) => ({
      index: edit.index,
      action: edit.action,
      toExerciseId: edit.toExerciseId,
    }));
    const release = await this.substitutionRepo.release(
      { userId: actor.userId, role: actor.role },
      id,
      edits,
    );
    if (!release.released) {
      switch (release.reason) {
        case 'ALL_DISCARDED':
          await this.notifySubstitutionDiscarded(actor, id, release.userId);
          return { id, protocolId: release.protocolId, discarded: true };
        case 'VALIDATION_FAILED':
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'As trocas aprovadas, aplicadas ao protocolo inteiro, quebraram a validação.',
            violations: release.violations,
          });
        case 'UNRESOLVED_ITEM':
        case 'INVALID_EDIT':
          throw new BadRequestException(release.detail);
        default:
          throw new BadRequestException(
            'Proposta já decidida, ou o protocolo mudou de versão desde a proposta.',
          );
      }
    }
    await this.deliverReleasedSubstitution(actor, id, release);
    await this.notifyWorkoutOfProtocolChange(release.userId, 'SUBSTITUTION', release.version);
    return { id, protocolId: release.protocolId, version: release.version, released: true };
  }

  /**
   * Achado 2026-09-09 (pedido do fundador): aluno pediu um exercício que não existe em
   * NENHUM lugar do catálogo — o time publica o exercício (mesmo endpoint/schema de
   * `ExerciseCatalogAdminService.publish`, reaproveitado sem alteração) e o liga ao item da
   * proposta. Achado 2026-09-30 (troca em lote): isto NÃO aprova mais — o item vira uma troca
   * comum e o profissional decide na tela única, item a item, como nos demais. O vínculo
   * recomputa a troca contra o protocolo VIVO e revalida a estrutura inteira; se falhar, só o
   * exercício fica no catálogo, pra tentar de novo com outra categorização.
   */
  async addCatalogExerciseToSubstitutionItem(
    actor: AuthenticatedUser,
    rawId: string,
    rawIndex: string,
    body: unknown,
  ) {
    this.assertStaffWrite(actor);
    // Achado 2026-09-09: esta rota é gated só por PAPEL (`@Roles('PROFESSIONAL','ADMIN')`,
    // no controller) — mas escrever no catálogo é `AI_CONFIG_WRITE`, capacidade que
    // `PROFESSIONAL` deliberadamente NÃO tem (`CAPABILITIES_BY_ROLE`, `@movivo/shared`): o
    // RT CREF aprova conteúdo curado (conhecimento/metodologia/guardrail), mas não publica
    // exercício novo livremente. Sem esta checagem explícita, chamar
    // `exerciseCatalogAdmin.publish()` por aqui (service-to-service, fora do
    // `@RequireCapabilities` do controller de catálogo) furaria esse limite.
    if (!roleHasCapabilities(actor.role, [ControlCenterCapability.AI_CONFIG_WRITE])) {
      throw new ForbiddenException('Sem permissão para publicar exercício no catálogo.');
    }
    const id = this.parse(uuidSchema, rawId);
    const index = this.parse(itemIndexSchema, rawIndex);
    const input = this.parse(publishExerciseCatalogEntrySchema, body);
    await this.exerciseCatalogAdmin.publish(actor, input);
    const chosen = this.exerciseCatalog.getById(input.exerciseKey);
    if (!chosen) {
      // `publish()` já invalida o cache do catálogo antes de devolver — não deveria
      // acontecer, mas sem isso ficaríamos aplicando a troca contra um exercício fantasma.
      throw new BadRequestException('Exercício publicado, mas não ficou disponível a tempo.');
    }
    const attached = await this.substitutionRepo.attachCatalogExercise(
      { userId: actor.userId, role: actor.role },
      id,
      index,
      chosen,
    );
    if (!attached.attached) {
      if (attached.reason === 'VALIDATION_FAILED') {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'O exercício publicado, aplicado ao protocolo inteiro, quebrou a validação.',
          violations: attached.violations,
        });
      }
      if (attached.reason === 'NOT_VIABLE') {
        throw new BadRequestException(
          'O exercício publicado não é elegível para este aluno (nível, local ou contraindicação).',
        );
      }
      throw new BadRequestException(
        'Proposta já decidida, item inexistente, ou o protocolo mudou de versão desde a proposta.',
      );
    }
    this.queueEvents.emit('protocol');
    return { id, itemIndex: index, attached: true };
  }

  /**
   * Cauda compartilhada de `approveSubstitutionNow`/`addCatalogExerciseAndApproveSubstitution`
   * (achado 2026-09-09): PDF completo do protocolo atualizado + resumo de IA + reenvio por
   * WhatsApp — idêntico nos dois casos, a única diferença é como a troca foi liberada.
   */
  private async deliverReleasedSubstitution(
    actor: AuthenticatedUser,
    id: string,
    release: {
      protocolId: string;
      userId: string;
      version: number;
      content: ProtocolStructure;
      mesocycleName: string;
      startDate: Date;
      endDate: Date;
      totalWeeks: number;
      changes: readonly SubstitutionChange[];
    },
  ): Promise<void> {
    let pdf: Buffer | null = null;
    let aiSummary: string | undefined;
    try {
      const { personal } = await this.protocolAnamnesisAnswers(actor, release.protocolId);
      pdf = await buildProtocolPdf({
        content: release.content,
        mesocycleName: release.mesocycleName,
        startDate: release.startDate,
        endDate: release.endDate,
        totalWeeks: release.totalWeeks,
        signatureHash: null,
        signedAt: null,
        student: personal,
      });
      // 2ª bolha da entrega (achado 2026-09-04): só vale a pena gerar quando o PDF saiu —
      // sem PDF, a entrega cai no texto+link de sempre, que não usa este resumo.
      aiSummary = await this.workoutPresentation.present({
        userId: release.userId,
        user: { name: personal.name, phoneNumber: personal.phoneNumber, email: personal.email },
        biologicalSex: personal.biologicalSex,
        content: release.content,
        totalWeeks: release.totalWeeks,
        mesocycleName: release.mesocycleName,
        reason: 'SUBSTITUTION',
        substitutionChanges: release.changes,
      });
    } catch (error) {
      this.logger.warn(
        { id, err: error instanceof Error ? error.message : String(error) },
        'geracao do PDF da substituicao aprovada manualmente falhou — entrega cai para texto+link',
      );
    }
    // Achado 2026-09-09 (bug reportado pelo fundador): sempre atualiza a coluna, mesmo quando
    // `pdf` saiu `null` — senão o PDF da versão ANTERIOR (assinatura original ou substituição
    // prévia) permanece salvo e `WhatsappOutboundWorker.buildDelivery` o trata como truthy,
    // mandando um PDF desatualizado em vez de cair no fallback texto+link (que já reflete o
    // `release.content` correto, com a troca aplicada).
    const encryptedPdf = pdf ? await this.cipher.encryptBytes(pdf) : null;
    await this.scoped(actor, (tx) =>
      tx
        .update(protocols)
        .set({ pdfContent: encryptedPdf })
        .where(eq(protocols.id, release.protocolId)),
    );

    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-delivery',
      {
        userId: release.userId,
        protocolId: release.protocolId,
        protocolVersion: release.version,
        type: 'PROTOCOL_DELIVERY',
        text: aiSummary,
        deliveryReason: 'SUBSTITUTION',
        substitutionFromExercise: release.changes[0]?.from,
        substitutionToExercise: release.changes[0]?.to,
        substitutionChanges: release.changes,
      },
      { jobId: `substitution-delivery_manual_${id}` },
    );
    this.queueEvents.emit('protocol');
  }

  /**
   * Avisa o domínio de treino (por fila, fronteira §12.5) que o protocolo ganhou uma versão: o
   * treino de hoje, se o aluno ainda não começou, é atualizado e ele é perguntado se quer um
   * link novo. Best-effort: nunca derruba a aprovação do profissional.
   */
  private async notifyWorkoutOfProtocolChange(
    userId: string,
    reason: WorkoutProtocolChangedJob['reason'],
    protocolVersion: number,
  ): Promise<void> {
    try {
      await this.queues.enqueue(
        QUEUE.workoutProtocolChanged,
        'workout-protocol-changed',
        { userId, reason, protocolVersion } satisfies WorkoutProtocolChangedJob,
        { jobId: `workout-protocol-changed_${userId}_${protocolVersion}` },
      );
    } catch (error) {
      this.logger.warn(
        { userId, err: error instanceof Error ? error.message : String(error) },
        'não foi possível avisar o treino do dia da nova versão do protocolo',
      );
    }
  }

  /** Profissional recusa a proposta inteira — mantém os exercícios originais, sem tocar o
   * protocolo. */
  async discardSubstitution(actor: AuthenticatedUser, rawId: string) {
    this.assertStaffWrite(actor);
    const id = this.parse(uuidSchema, rawId);
    const result = await this.substitutionRepo.discard(
      { userId: actor.userId, role: actor.role },
      id,
    );
    if (!result.discarded) {
      throw new BadRequestException('Proposta já decidida — não há mais o que recusar.');
    }
    await this.notifySubstitutionDiscarded(actor, id, result.userId);
    return { id, discarded: true };
  }

  /** Trilha de auditoria + aviso ao aluno de uma proposta recusada (por inteiro, ou com todos
   * os itens descartados na tela de revisão). */
  private async notifySubstitutionDiscarded(
    actor: AuthenticatedUser,
    id: string,
    userId: string,
  ): Promise<void> {
    await this.scoped(actor, (tx) =>
      this.audit.append(tx, {
        actorId: actor.userId,
        userId,
        action: 'PROTOCOL_SUBSTITUTION_DISCARDED',
        entityType: 'protocol_substitution_request',
        entityId: id,
        changes: {},
      }),
    );
    // Achado 2026-09-09 (pedido do fundador): até aqui a recusa era silenciosa — o aluno
    // pedia a troca, ouvia "vou confirmar com o profissional" e nunca mais sabia o que
    // aconteceu. Mesmo padrão de `coach-message` do `AiResponseWorker`.
    const notification: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      text: SUBSTITUTION_DISCARDED_MESSAGE,
      dedupeId: `substitution-discarded_${id}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'coach-message', notification, {
      jobId: `substitution-discarded_${id}`,
    });
    this.queueEvents.emit('protocol');
  }

  async resolveHandoff(actor: AuthenticatedUser, rawId: string, rawBody: unknown) {
    const id = this.parse(uuidSchema, rawId);
    const body = this.parse(resolveSchema, rawBody);
    const resolved = await this.scoped(actor, async (tx) => {
      const [row] = await tx
        .select({ userId: handoffAlerts.userId, status: handoffAlerts.status })
        .from(handoffAlerts)
        .where(eq(handoffAlerts.id, id))
        .for('update')
        .limit(1);
      if (!row) throw new NotFoundException('Alerta de atendimento não encontrado.');
      if (row.status === 'RESOLVED') return { id, status: 'RESOLVED' as const, changed: false };
      await tx.update(handoffAlerts).set({ status: 'RESOLVED' }).where(eq(handoffAlerts.id, id));
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: row.userId,
        action: 'HANDOFF_RESOLVED',
        entityType: 'handoff_alert',
        entityId: id,
        changes: {
          resolutionHash: this.hashJson(body.resolution),
          notesHash: this.hashJson(body.notes),
        },
      });
      return { id, status: 'RESOLVED' as const, changed: true };
    });
    if (resolved.changed) this.queueEvents.emit('handoff');
    return { id: resolved.id, status: resolved.status };
  }

  async operations(actor: AuthenticatedUser) {
    return this.scopedRead(actor, async (tx) => {
      // Funil: o desenho anterior (LEFT JOIN de sessões × protocolos × assinaturas +
      // `count(distinct)`) multiplicava as linhas pelo produto cartesiano por titular antes de
      // agregar. Aqui cada métrica lê a própria tabela uma vez e cruza o titular com EXISTS
      // (índice `idx_anamnesis_sessions_user`); as três contagens seguem juntas na conexão.
      // Mesmos números: protocolo/assinatura ATIVOS de quem já iniciou o formulário.
      const hasAnamnesis = (userId: PgColumn) =>
        sql`exists (select 1 from ${anamnesisSessions} where ${anamnesisSessions.userId} = ${userId})`;
      const [[formStarted], [protocolSent], [converted]] = await Promise.all([
        tx.select({ total: count() }).from(anamnesisSessions),
        tx
          .select({ total: count() })
          .from(protocols)
          .where(and(eq(protocols.status, 'ACTIVE'), hasAnamnesis(protocols.userId))),
        tx
          .select({ total: count() })
          .from(subscriptions)
          .where(and(eq(subscriptions.status, 'ACTIVE'), hasAnamnesis(subscriptions.userId))),
      ]);
      const funnel = {
        formStarted: formStarted?.total ?? 0,
        protocolSent: protocolSent?.total ?? 0,
        converted: converted?.total ?? 0,
      };
      const [coachSla] = await tx
        .select({
          coachP95Ms: sql<
            number | null
          >`percentile_cont(0.95) within group (order by ${conversations.latencyMs})`,
        })
        .from(conversations)
        .where(isNotNull(conversations.latencyMs));
      const [protocolSla] = await tx
        .select({
          protocolAverageMinutes: sql<
            number | null
          >`avg(extract(epoch from (${protocols.signedAt} - ${anamnesisSessions.submittedAt})) / 60)`,
        })
        .from(anamnesisSessions)
        .innerJoin(protocols, eq(protocols.userId, anamnesisSessions.userId))
        .where(and(isNotNull(anamnesisSessions.submittedAt), isNotNull(protocols.signedAt)));
      const replayRows = await tx
        .select({
          id: conversations.id,
          userId: conversations.userId,
          direction: conversations.direction,
          content: conversations.content,
          createdAt: conversations.createdAt,
          studentName: users.name,
        })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.userId))
        .where(eq(conversations.hiddenInPanel, false))
        .orderBy(desc(conversations.createdAt))
        .limit(100);
      // Antes: baixava TODO check-in enviado (com o `answers` inteiro) só para contar, em JS,
      // quem reportou adesão > 0. Agora o banco conta (`firstWorkoutUsers`) e só os ids dos
      // titulares — necessários para a trilha de auditoria abaixo — atravessam a rede.
      const [checkinUsers, [firstWorkoutRow]] = await Promise.all([
        tx
          .selectDistinct({ userId: checkins.userId })
          .from(checkins)
          .where(eq(checkins.status, 'SUBMITTED')),
        tx
          .select({
            firstWorkout: sql<number>`count(distinct ${checkins.userId}) filter (
              where jsonb_typeof(${checkins.answers} -> 'adherenceScore') = 'number'
                and (${checkins.answers} ->> 'adherenceScore')::numeric > 0)::int`,
          })
          .from(checkins)
          .where(eq(checkins.status, 'SUBMITTED')),
      ]);
      const accessedUsers = new Set([
        ...replayRows.map((row) => row.userId),
        ...checkinUsers.map((row) => row.userId),
      ]);
      for (const userId of accessedUsers) {
        await this.auditRead(tx, actor, userId, 'operations_dashboard', userId);
      }
      const firstWorkout = firstWorkoutRow?.firstWorkout ?? 0;
      const replays = await this.groupReplays(replayRows);
      const protocolDeliveryMinutes = this.nullableNumber(protocolSla?.protocolAverageMinutes);
      const coachP95Seconds = this.nullableNumber(coachSla?.coachP95Ms, 1_000);
      // ponytail: polling e logs estruturados cobrem o MVP; SSE/PostHog entram na Fase 6
      // quando existir infraestrutura compartilhada para conexoes e ingestao resiliente.
      return {
        funnel: { ...funnel, firstWorkout },
        sla: {
          protocolDeliveryMinutes,
          coachP95Seconds,
          protocolBreached: protocolDeliveryMinutes !== null && protocolDeliveryMinutes > 120,
          coachBreached: coachP95Seconds !== null && coachP95Seconds > 30,
        },
        replays,
      };
    });
  }

  private async protocolDetail(actor: AuthenticatedUser, id: string) {
    return this.scopedRead(actor, async (tx) => {
      const row = await this.requireProtocol(tx, id);
      const [owner] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, row.userId))
        .limit(1);
      await this.auditRead(tx, actor, row.userId, 'protocol', id);
      const item = this.item(
        id,
        'PROTOCOL',
        'ROUTINE',
        row.createdAt,
        protocolTitle(owner?.name),
        row.status,
        row.status,
        row.reviewUrgency === 'OPTIONAL'
          ? new Date(row.createdAt.getTime() + PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS).toISOString()
          : null,
      );
      return {
        item,
        // Achado 2026-08-19 (a pedido do fundador): `version` já aparece no título
        // "Protocolo · versão N" e `humanReviewRequired` é sempre `true` pra qualquer
        // item nesta fila — nenhum dos dois ajudava o RT. Card "Contexto autorizado"
        // some pra protocolo (`QueueDetail`), continua útil pras outras 3 telas.
        context: {},
        protocol: {
          id,
          version: row.version,
          status: row.status,
          approvalStatus: row.approvalStatus,
          isFallback: row.generatedBy === 'FALLBACK_TEMPLATE',
          content: row.content,
          signedAt: row.signedAt?.toISOString() ?? null,
          signatureHash: row.signatureHash,
          totalWeeks: row.totalWeeks,
          // Achado 2026-08-19: data de início/fim do card de revisão são calculadas no
          // cliente a partir daqui (criação + duração) — não existe coluna própria pra
          // "início real do protocolo", que hoje é a própria criação do registro.
          createdAt: row.createdAt.toISOString(),
          review: this.protocolReview(row),
        },
      };
    });
  }

  /**
   * Todas as respostas que o titular preencheu no formulário de anamnese — cadastro
   * pessoal, objetivos/rotina e o bloco de saúde (PAR-Q completo, dor, texto livre,
   * declarações). Não existe em lugar nenhum do app hoje: a "ficha do aluno" (US-7.4)
   * só projeta 8 de ~15 campos de `data_block_3` e nunca expõe `data_block_1` nem o
   * PAR-Q completo — aqui é o bloco inteiro, sem projeção parcial.
   *
   * Ponto de entrada único desde 2026-08-24: parte de um protocolo e deriva a sessão
   * SUBMITTED mais recente do titular. O segundo ponto de entrada, que recebia a sessão
   * direto (item `kind: 'PARQ'` da fila), morreu junto com a tela separada de PAR-Q — as
   * duas caixas da fila agora são protocolo, e chegam aqui pelo mesmo caminho.
   */
  private async protocolAnamnesisAnswers(actor: AuthenticatedUser, protocolId: string) {
    const { userId, session } = await this.scopedRead(actor, async (tx) => {
      const protocol = await this.requireProtocol(tx, protocolId);
      const [found] = await tx
        .select({
          id: anamnesisSessions.id,
          dataBlock1: anamnesisSessions.dataBlock1,
          dataBlock2: anamnesisSessions.dataBlock2,
          dataBlock3: anamnesisSessions.dataBlock3,
          submittedAt: anamnesisSessions.submittedAt,
        })
        .from(anamnesisSessions)
        .where(
          and(
            eq(anamnesisSessions.userId, protocol.userId),
            eq(anamnesisSessions.status, 'SUBMITTED'),
          ),
        )
        .orderBy(desc(anamnesisSessions.submittedAt))
        .limit(1);
      if (!found) throw new NotFoundException('Anamnese do aluno não encontrada.');
      await this.auditRead(tx, actor, protocol.userId, 'anamnesis_session', found.id);
      return { userId: protocol.userId, session: found };
    });

    return this.parseAnamnesisAnswers(userId, session);
  }

  private async parseAnamnesisAnswers(
    userId: string,
    session: {
      dataBlock1: unknown;
      dataBlock2: Buffer | null;
      dataBlock3: unknown;
      submittedAt: Date | null;
    },
  ) {
    const personal = onboardingStep1Schema.parse(session.dataBlock1);
    const routine = anamnesisStructuredSchema.parse(session.dataBlock3);
    const health: HealthBlock = session.dataBlock2
      ? healthBlockSchema.parse(JSON.parse(await this.cipher.decryptHealth(session.dataBlock2)))
      : {};

    return {
      userId,
      submittedAt: session.submittedAt?.toISOString() ?? null,
      personal,
      routine,
      health,
    };
  }

  private async checkinDetail(actor: AuthenticatedUser, alertId: string) {
    const row = await this.scopedRead(actor, async (tx) => {
      const [alert] = await tx
        .select({
          userId: handoffAlerts.userId,
          checkinId: handoffAlerts.sourceId,
          level: handoffAlerts.level,
          reason: handoffAlerts.reason,
          status: handoffAlerts.status,
          createdAt: handoffAlerts.createdAt,
        })
        .from(handoffAlerts)
        .where(and(eq(handoffAlerts.id, alertId), eq(handoffAlerts.sourceType, 'CHECKIN')))
        .limit(1);
      if (!alert?.checkinId) throw new NotFoundException('Check-in não encontrado.');
      const [checkin] = await tx
        .select({
          answers: checkins.answers,
          notesCipher: checkins.notesCipher,
          weekNumber: checkins.weekNumber,
          submittedAt: checkins.submittedAt,
        })
        .from(checkins)
        .where(eq(checkins.id, alert.checkinId))
        .limit(1);
      if (!checkin) throw new NotFoundException('Check-in não encontrado.');
      await this.auditRead(tx, actor, alert.userId, 'checkin', alert.checkinId);
      return { ...alert, ...checkin };
    });
    const notes = row.notesCipher
      ? (JSON.parse(await this.cipher.decryptHealth(row.notesCipher)) as Record<string, unknown>)
      : {};
    const responses = { ...(row.answers as Record<string, unknown> | null), ...notes };
    return {
      item: this.item(
        alertId,
        'CHECKIN',
        row.level,
        row.createdAt,
        'Check-in requer atencao',
        row.status,
        row.status,
        null,
      ),
      context: {
        weekNumber: row.weekNumber,
        completedAt: row.submittedAt?.toISOString() ?? null,
        responses: JSON.stringify(responses),
      },
      handoff: { reason: row.reason, level: row.level, status: row.status },
    };
  }

  private async handoffDetail(actor: AuthenticatedUser, id: string) {
    const detail = await this.scopedRead(actor, async (tx) => {
      const [alert] = await tx
        .select({
          userId: handoffAlerts.userId,
          level: handoffAlerts.level,
          reason: handoffAlerts.reason,
          conversationId: handoffAlerts.conversationId,
          sourceType: handoffAlerts.sourceType,
          sourceId: handoffAlerts.sourceId,
          status: handoffAlerts.status,
          createdAt: handoffAlerts.createdAt,
          updatedAt: handoffAlerts.updatedAt,
        })
        .from(handoffAlerts)
        .where(eq(handoffAlerts.id, id))
        .limit(1);
      if (!alert) throw new NotFoundException('Alerta de atendimento não encontrado.');
      const [owner] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, alert.userId))
        .limit(1);
      const context = await tx
        .select({
          id: conversations.id,
          direction: conversations.direction,
          content: conversations.content,
          createdAt: conversations.createdAt,
        })
        .from(conversations)
        .where(and(eq(conversations.userId, alert.userId), eq(conversations.hiddenInPanel, false)))
        .orderBy(desc(conversations.createdAt))
        .limit(12);
      await this.auditRead(tx, actor, alert.userId, 'handoff_alert', id);
      // Só alertas nascidos de uma conversa (`sourceType` nulo) têm mensagem de origem; check-in,
      // treino e renovação não — mostrar a última mensagem do aluno ali seria um dado errado.
      // Alerta antigo sem `conversationId` usa a última entrada ATÉ o instante do alerta, e a
      // busca é direta (não limitada às 12 mensagens do replay, que já podem ter passado).
      const triggerWhere = alert.conversationId
        ? and(eq(conversations.id, alert.conversationId), eq(conversations.userId, alert.userId))
        : alert.sourceType === null
          ? and(
              eq(conversations.userId, alert.userId),
              eq(conversations.direction, 'INBOUND'),
              lte(conversations.createdAt, alert.createdAt),
            )
          : null;
      const [trigger = null] = triggerWhere
        ? await tx
            .select({
              content: conversations.content,
              direction: conversations.direction,
              createdAt: conversations.createdAt,
            })
            .from(conversations)
            .where(triggerWhere)
            .orderBy(desc(conversations.createdAt))
            .limit(1)
        : [];
      const replayRows = context.reverse().map((message) => ({
        ...message,
        userId: alert.userId,
        studentName: owner?.name ?? null,
      }));
      const [workout] =
        alert.sourceType === 'WORKOUT' && alert.sourceId
          ? await tx
              .select({
                sessionKey: workoutSessions.sessionKey,
                scheduledDate: workoutSessions.scheduledDate,
                durationSeconds: workoutSessions.durationSeconds,
                perceivedEffort: workoutSessions.perceivedEffort,
                painExerciseIds: workoutSessions.painExerciseIds,
                prescription: workoutSessions.prescription,
                feedbackCipher: workoutSessions.feedbackCipher,
              })
              .from(workoutSessions)
              .where(eq(workoutSessions.id, alert.sourceId))
              .limit(1)
          : [];
      const [insight] =
        alert.sourceType === 'WORKOUT_INSIGHT' && alert.sourceId
          ? await tx
              .select({
                observedMinutes: workoutInsights.observedValue,
                expectedMinutes: workoutInsights.expectedValue,
              })
              .from(workoutInsights)
              .where(eq(workoutInsights.id, alert.sourceId))
              .limit(1)
          : [];
      return {
        item: this.item(
          id,
          'HANDOFF',
          alert.level,
          alert.createdAt,
          'Conversa requer atencao',
          alert.status,
          alert.status,
          null,
        ),
        context: {
          reason: alert.reason,
          messages: context.length,
          ...(workout
            ? {
                sessionKey: workout.sessionKey,
                scheduledDate: workout.scheduledDate,
                durationSeconds: workout.durationSeconds,
                perceivedEffort: workout.perceivedEffort,
                painExerciseIds: workout.painExerciseIds,
                // Nomes legíveis para o CREF; o id cru não diz qual exercício doeu.
                painExercises: workout.painExerciseIds
                  .map(
                    (exerciseId) =>
                      workout.prescription.exercises.find(
                        (exercise) => exercise.exerciseId === exerciseId,
                      )?.name ?? null,
                  )
                  .filter((name): name is string => name !== null)
                  .join(', '),
              }
            : {}),
          ...(insight ?? {}),
        },
        handoff: {
          reason: alert.reason,
          level: alert.level,
          status: alert.status,
          studentId: alert.userId,
          studentName: owner?.name ?? null,
          sourceType: alert.sourceType ?? null,
          sourceId: alert.sourceId ?? null,
          createdAt: alert.createdAt.toISOString(),
          updatedAt: alert.updatedAt.toISOString(),
          trigger: trigger
            ? {
                content: await this.cipher.decryptText(trigger.content),
                createdAt: trigger.createdAt.toISOString(),
                direction: trigger.direction,
              }
            : null,
        },
        replay: (await this.groupReplays(replayRows))[0],
        feedbackCipher: workout?.feedbackCipher ?? null,
      };
    });
    const { feedbackCipher, ...safeDetail } = detail;
    if (!feedbackCipher) return safeDetail;
    const feedback = JSON.parse(await this.cipher.decryptHealth(feedbackCipher)) as Record<
      string,
      unknown
    >;
    // Anotações do aluno como texto simples (o objeto `feedback` não chega ao navegador).
    const notes = (value: unknown) =>
      typeof value === 'string' && value.trim() ? { value: value.trim() } : null;
    return {
      ...safeDetail,
      context: {
        ...safeDetail.context,
        feedback,
        ...(notes(feedback.painNotes) ? { painNotes: notes(feedback.painNotes)?.value } : {}),
        ...(notes(feedback.feelingNotes)
          ? { feelingNotes: notes(feedback.feelingNotes)?.value }
          : {}),
      },
    };
  }

  /**
   * Situação de revisão do conteúdo atual, calculada no servidor (achado 2026-10-15): de quem
   * é a prescrição, o que impede assinar/publicar e o que o profissional precisa reconhecer.
   * A tela só exibe — quem decide é sempre `signProtocol`/`amendActiveProtocol`.
   */
  private protocolReview(row: {
    content: unknown;
    constraints: unknown;
    parQFlags: unknown;
    generatedBy: string | null;
  }) {
    const raw = (row.constraints ?? {}) as { daysPerWeek?: unknown; preferredDays?: unknown };
    const availability = {
      daysPerWeek: validDaysPerWeek(raw.daysPerWeek) ?? null,
      preferredDays: Array.isArray(raw.preferredDays)
        ? normalizedPreferredDays(raw.preferredDays as Weekday[])
        : [],
    };
    const professional = isProfessionalAuthored(row.generatedBy);
    const parsed = protocolStructureSchema.safeParse(row.content);
    if (!parsed.success) {
      return {
        origin: professional ? 'PROFESSIONAL' : 'AI',
        availability,
        blocking: [],
        conflicts: [],
      };
    }
    if (professional) {
      const verdict = this.professionalVerdict(row, parsed.data);
      return {
        origin: 'PROFESSIONAL',
        availability,
        blocking: this.conflictPayload(verdict.blocking),
        conflicts: this.conflictPayload(this.conflictsRequiringAcknowledgment(verdict.conflicts)),
      };
    }
    const verdict = this.validation.validate({
      structure: parsed.data,
      constraints: this.validationConstraints(row),
      parqFlags: row.parQFlags as UserConstraints['injuryTags'],
    });
    return {
      origin: 'AI',
      availability,
      blocking: this.conflictPayload(verdict.violations.filter((v) => v.action === 'BLOCK')),
      conflicts: [],
      qualityNotices: [
        ...qualityNotices(
          (row.constraints as { contextualQuality?: unknown } | null)?.contextualQuality,
        ),
        ...cautionNotices(
          parsed.data,
          (row.constraints as { cautionTags?: UserConstraints['injuryTags'] } | null)?.cautionTags,
          this.exerciseCatalog,
        ),
      ],
    };
  }

  /** Constraints persistidas no protocolo, no formato do validador (shape solto do jsonb). */
  private validationConstraints(row: {
    constraints: unknown;
  }): ValidateProtocolInput['constraints'] {
    return (row.constraints ?? {}) as ValidateProtocolInput['constraints'];
  }

  private professionalVerdict(
    row: { constraints: unknown; parQFlags: unknown },
    content: ProtocolStructure,
  ): ProfessionalPrescriptionVerdict {
    return this.validation.validateProfessionalPrescription({
      structure: content,
      constraints: this.validationConstraints(row),
      parqFlags: row.parQFlags as UserConstraints['injuryTags'],
    });
  }

  private conflictsRequiringAcknowledgment(
    conflicts: readonly ValidationViolation[],
  ): ValidationViolation[] {
    // A intervenção autenticada do CREF já é a decisão sobre a contraindicação catalogada;
    // o conflito completo ainda fica no registro da versão/auditoria.
    return conflicts.filter((conflict) => conflict.rule !== 'EXERCISE_CONTRAINDICATED');
  }

  /**
   * Nome oficial do catálogo para todo exercício com `exerciseId` conhecido: trocar o
   * exercício no editor não pode deixar o nome dizendo uma coisa e o id outra — o validador,
   * o PDF e o AI Coach leem o id. Grafia original do catálogo, nunca a digitada. Vídeo: o link
   * que o profissional informou prevalece; sem link (exercício recém-escolhido — o editor
   * limpa o vídeo do anterior), entra o vídeo curado do catálogo, como no gerador.
   */
  private canonicalExerciseNames(content: ProtocolStructure): ProtocolStructure {
    return {
      ...content,
      sessions: content.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => {
          const official = this.validation.exerciseById(exercise.exerciseId);
          if (!official) return exercise;
          return {
            ...exercise,
            name: official.name,
            ...(!exercise.videoUrl && official.videoUrl ? { videoUrl: official.videoUrl } : {}),
          };
        }),
      })),
    };
  }

  /** Integridade/compliance: nenhum profissional supera — não salva, não assina, não publica. */
  private assertNoIntegrityViolations(blocking: readonly ValidationViolation[]): void {
    if (blocking.length === 0) return;
    throw new BadRequestException({
      code: 'PROTOCOL_INTEGRITY_VIOLATION',
      message: 'A prescrição tem problemas que precisam ser corrigidos antes de salvar.',
      violations: blocking,
    });
  }

  /**
   * Conflito com regra automática só passa com reconhecimento explícito de CADA conflito
   * atual — uma tela desatualizada (conflito novo depois de abrir) não assina no escuro.
   */
  private assertConflictsAcknowledged(
    conflicts: readonly ValidationViolation[],
    acknowledged: readonly string[] | undefined,
  ): void {
    const ack = new Set(acknowledged ?? []);
    const pending = conflicts.filter((conflict) => !ack.has(violationKey(conflict)));
    if (pending.length === 0) return;
    throw new BadRequestException({
      code: 'PROFESSIONAL_DECISION_REQUIRED',
      message:
        'A prescrição diverge das regras automáticas. Confirme que é uma decisão profissional sua para continuar.',
      conflicts: this.conflictPayload(conflicts),
    });
  }

  private conflictPayload(conflicts: readonly ValidationViolation[]) {
    return conflicts.map((conflict) => ({
      key: violationKey(conflict),
      rule: conflict.rule,
      detail: conflict.detail,
    }));
  }

  /** Registro, na própria versão assinada, do que a regra automática apontou e foi superado. */
  private professionalOverrideDiff(conflicts: readonly ValidationViolation[]) {
    return {
      type: 'PROFESSIONAL_OVERRIDE',
      conflicts: conflicts.map((conflict) => ({ rule: conflict.rule, detail: conflict.detail })),
    };
  }

  private async requireProtocol(tx: TenantTransaction, id: string, forUpdate = false) {
    const query = tx.select().from(protocols).where(eq(protocols.id, id));
    const [row] = forUpdate ? await query.for('update').limit(1) : await query.limit(1);
    if (!row) throw new NotFoundException('Protocolo não encontrado.');
    return row;
  }

  /** A conta ADMIN fundadora é a exceção MVP documentada; PROFESSIONAL exige CREF ativo. */
  private async assertCrefCredential(tx: TenantTransaction, actor: AuthenticatedUser) {
    if (actor.role === 'ADMIN') return;
    const [professional] = await tx
      .select({
        crefActive: staff.crefActive,
        crefNumber: staff.crefNumber,
        crefRegion: staff.crefRegion,
      })
      .from(staff)
      .where(eq(staff.id, actor.userId))
      .limit(1);
    if (!professional?.crefActive || !professional.crefNumber || !professional.crefRegion) {
      throw new BadRequestException(
        'Para assinar, é preciso ter uma credencial CREF ativa e verificada.',
      );
    }
  }

  /** Gera a representação atual e agenda a entrega; falha de PDF nunca desfaz a assinatura. */
  private async deliverProtocol(
    actor: AuthenticatedUser,
    id: string,
    signed: DeliverableProtocol,
    deliveryKind: 'signed' | 'amended',
  ) {
    let aiSummary: string | undefined;
    try {
      const { personal } = await this.protocolAnamnesisAnswers(actor, id);
      const pdf = await buildProtocolPdf({
        content: signed.content,
        mesocycleName: signed.mesocycleName,
        startDate: signed.startDate,
        endDate: signed.endDate,
        totalWeeks: signed.totalWeeks,
        signatureHash: signed.signatureHash,
        signedAt: new Date(signed.signedAt),
        student: personal,
      });
      const encryptedPdf = await this.cipher.encryptBytes(pdf);
      await this.scoped(actor, (tx) =>
        tx.update(protocols).set({ pdfContent: encryptedPdf }).where(eq(protocols.id, id)),
      );
      aiSummary = await this.workoutPresentation.present({
        userId: signed.userId,
        user: { name: personal.name, phoneNumber: personal.phoneNumber, email: personal.email },
        biologicalSex: personal.biologicalSex,
        content: signed.content,
        totalWeeks: signed.totalWeeks,
        mesocycleName: signed.mesocycleName,
        reason: 'INITIAL',
      });
    } catch (error) {
      this.logger.warn(
        { id, err: error instanceof Error ? error.message : String(error) },
        'geracao do PDF do protocolo falhou — entrega cai para texto+link',
      );
    }
    const outbound: WhatsappOutboundJob = {
      userId: signed.userId,
      type: 'PROTOCOL_DELIVERY',
      protocolId: id,
      protocolVersion: signed.version,
      dedupeId: `${deliveryKind}-${id}-${signed.version}`,
      text: aiSummary,
    };
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      `${deliveryKind}-protocol-delivery`,
      outbound,
      { jobId: `${deliveryKind}-protocol-${id}-${signed.version}` },
    );
  }

  /**
   * Chaves `tipo:id` já lidas pela conta: leitura registrada em ou depois da criação do item.
   * Um item que nasce depois da última leitura volta a ser não lido.
   */
  async readKeys(
    tx: TenantTransaction,
    actor: AuthenticatedUser,
    refs: ReadonlyArray<{ type: NotificationType; id: string; createdAt: Date }>,
  ): Promise<Set<string>> {
    if (refs.length === 0) return new Set();
    const rows = await tx
      .select({
        kind: dashboardNotificationReads.kind,
        refId: dashboardNotificationReads.refId,
        readAt: dashboardNotificationReads.readAt,
      })
      .from(dashboardNotificationReads)
      .where(
        and(
          eq(dashboardNotificationReads.userId, actor.userId),
          inArray(
            dashboardNotificationReads.refId,
            refs.map((ref) => ref.id),
          ),
        ),
      );
    const createdAt = new Map(
      refs.map((ref) => [`${ref.type}:${ref.id}`, ref.createdAt.getTime()]),
    );
    return new Set(
      rows
        .map((row) => ({ key: `${row.kind}:${row.refId}`, readAt: row.readAt.getTime() }))
        .filter(({ key, readAt }) => {
          const created = createdAt.get(key);
          return created !== undefined && readAt >= created;
        })
        .map(({ key }) => key),
    );
  }

  async auditRead(
    tx: TenantTransaction,
    actor: AuthenticatedUser,
    userId: string,
    entityType: string,
    entityId: string,
  ) {
    await this.audit.append(tx, {
      actorId: actor.userId,
      userId,
      action: 'HEALTH_DATA_VIEWED',
      entityType,
      entityId,
      changes: {
        purpose: actor.role === 'ADMIN' ? 'administrative_monitoring' : 'professional_supervision',
      },
    });
  }

  private scoped<T>(
    actor: AuthenticatedUser,
    callback: (tx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    this.assertStaffWrite(actor);
    return this.db.runAsUser(actor.userId, actor.role, callback);
  }

  private scopedRead<T>(
    actor: AuthenticatedUser,
    callback: (tx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    this.assertStaffRead(actor);
    return this.db.runAsUser(actor.userId, actor.role, callback);
  }

  private assertStaffRead(actor: AuthenticatedUser): void {
    if (actor.role !== 'PROFESSIONAL' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Acesso exclusivo ao CREF atribuído ou administrador.');
    }
  }

  /**
   * Portão das ações que MUTAM protocolo/PAR-Q/handoff (`scoped`). `ADMIN` (conta
   * fundador) tem acesso total aqui — decisão do fundador 2026-08-22: no início a MOVIVO
   * só tem um profissional CREF, também sócio-fundador, e a conta dele já é `ADMIN`. A
   * segunda barreira específica de `signProtocol` (crédito CREF ativo) continua exigindo
   * `PROFESSIONAL` — `ADMIN` pula só aquela checagem, não esta.
   */
  private assertStaffWrite(actor: AuthenticatedUser): void {
    if (actor.role !== 'PROFESSIONAL' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Acesso exclusivo ao profissional CREF atribuído.');
    }
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = strictSafeParse(schema, input);
    if (!result.success) {
      // Mensagens em PT-BR que dizem onde corrigir (treino › exercício › campo): o texto cru do
      // Zod ("Too small: expected number to be >=1") chegava ao profissional na tela.
      throw new BadRequestException({
        code: 'INVALID_INPUT',
        message: 'Revise os campos indicados e tente novamente.',
        issues: friendlyIssueMessages(result.error.issues, input).map((message) => ({ message })),
      });
    }
    return result.data;
  }

  /**
   * Builder compartilhado de todo item de fila. `summary` é parâmetro explícito desde
   * 2026-08-20: antes era sempre uma cópia literal de `status`, o que vazava o enum cru
   * como legenda visível do card na seção "Revisão Humana Obrigatória". `origin` entrou em
   * 2026-08-24 e só é preenchido por protocolo `MANDATORY` — ver `QueueItem.origin`.
   */
  private item(
    id: string,
    kind: QueueItem['kind'],
    severity: QueueItem['severity'],
    createdAt: Date,
    title: string,
    summary: string,
    status: string,
    autoReleaseAt: string | null,
    origin: QueueItem['origin'] = null,
  ): QueueItem {
    return {
      id,
      kind,
      severity,
      origin,
      createdAt: createdAt.toISOString(),
      ageMinutes: Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 60_000)),
      title,
      summary,
      status,
      autoReleaseAt,
      read: false,
    };
  }

  private hashJson(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private nullableNumber(value: unknown, divisor = 1): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed / divisor : null;
  }

  private async groupReplays(
    rows: Array<{
      id: string;
      userId: string;
      direction: 'INBOUND' | 'OUTBOUND';
      content: string;
      createdAt: Date;
      /** Achado 2026-09-08 (pedido do fundador): o painel mostrava "Pessoa usuária" genérico
       * em vez do nome real do titular — o profissional já vê a identidade completa em outros
       * campos da mesma tela, então esconder o nome aqui só piorava a leitura da conversa. */
      studentName?: string | null;
    }>,
  ) {
    const groups = new Map<
      string,
      {
        conversationId: string;
        startedAt: string;
        studentName: string | null;
        messages: Array<{
          role: 'USER' | 'ASSISTANT';
          content: string;
          createdAt: string;
        }>;
      }
    >();
    for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const conversationId = createHash('sha256').update(row.userId).digest('hex').slice(0, 16);
      const current = groups.get(conversationId) ?? {
        conversationId,
        startedAt: row.createdAt.toISOString(),
        studentName: row.studentName ?? null,
        messages: [],
      };
      // Achado 2026-09-08 (decisão do fundador): painel é de uso interno da equipe MOVIVO —
      // sem anonimização do conteúdo real da conversa (`scrubPII` era pensado pro boundary
      // de envio ao provedor de LLM, não pra leitura da própria equipe, e corrompia nomes de
      // exercício compostos, ex.: "Caminhada de Mala" → "Caminhada de terceiro").
      current.messages.push({
        role: row.direction === 'INBOUND' ? 'USER' : 'ASSISTANT',
        content: await this.cipher.decryptText(row.content),
        createdAt: row.createdAt.toISOString(),
      });
      groups.set(conversationId, current);
    }
    return [...groups.values()];
  }
}
