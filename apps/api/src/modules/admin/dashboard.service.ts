import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import {
  anamnesisStructuredSchema,
  onboardingStep1Schema,
  protocolStructureSchema,
  type ProtocolStructure,
} from '@movivo/shared';
import { z } from 'zod';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import {
  anamnesisSessions,
  checkins,
  conversations,
  handoffAlerts,
  protocols,
  protocolVersions,
  subscriptions,
  users,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { scrubPII } from '../ai-coach/llm/pii-scrubber';
import { healthBlockSchema, type HealthBlock } from '../anamnesis/health-block';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { buildProtocolPdf } from '../protocol/protocol-pdf.service';
import { signatureHash } from '../protocol/protocol.repository';
import type { UserConstraints } from '../protocol/user-constraints';
import { ValidationService } from '../protocol/validation/validation.service';
import { PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS } from '../protocol/protocol-generation.worker';
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

const uuidSchema = z.uuid();
// `PARQ` saiu do enum em 2026-08-24: não existe mais item de fila nem tela de PAR-Q — o
// PAR-Q bloqueado agora vive DENTRO do item de protocolo (`origin: 'PARQ'`).
const kindSchema = z.enum(['PROTOCOL', 'HANDOFF', 'CHECKIN']);
const editSchema = z.object({
  content: protocolStructureSchema,
  reason: z.string().trim().min(5).max(500),
});
const signSchema = z.object({ confirmation: z.literal(true) });
const resolveSchema = z.object({
  resolution: z.string().trim().min(3).max(80),
  notes: z.string().trim().min(3).max(1000),
  confirmation: z.literal(true),
});

export interface QueueItem {
  id: string;
  kind: 'PROTOCOL' | 'HANDOFF' | 'CHECKIN';
  severity: 'SAFETY' | 'ALERT' | 'ROUTINE';
  createdAt: string;
  ageMinutes: number;
  title: string;
  summary: string;
  status: string;
  /** Só protocolos `OPTIONAL` na categoria "Disponível para Revisão" (fila do CREF). */
  autoReleaseAt: string | null;
  /**
   * POR QUE este protocolo exige revisão humana (2026-08-24). `PARQ` = a sessão de origem
   * está `BLOQUEADO_AGUARDANDO_CLEARANCE` (alerta clínico — assinar aqui também libera o
   * PAR-Q); `EDIT` = um CREF editou o conteúdo e precisa de sign-off fresco. `null` para
   * itens `optional` e para os que não são protocolo — não têm motivo a exibir.
   */
  origin: 'PARQ' | 'EDIT' | null;
}

/** Titulo do item de fila de protocolo, com o nome completo do titular. */
function protocolTitle(name: string | null | undefined) {
  return name ? `Protocolo para Revisão: ${name}` : 'Protocolo para Revisão';
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
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DashboardService.name);
  }

  /**
   * Fila do profissional — só protocolo (handoff/check-in ficam fora desta tela;
   * `resolveHandoff`/`handoffDetail`/`checkinDetail` continuam existindo pra uso futuro,
   * só não aparecem aqui). Duas categorias, cada uma ordenada só por idade (mais antigo
   * primeiro):
   *
   * - `mandatory` — protocolo `reviewUrgency: MANDATORY`, de duas origens:
   *   · `PARQ` (2026-08-24): a sessão que originou o protocolo está
   *     `BLOQUEADO_AGUARDANDO_CLEARANCE`. Antes desta data, PAR-Q bloqueado era um item
   *     `kind: 'PARQ'` SEPARADO, apontando pra uma sessão sem protocolo nenhum, com tela
   *     e ação próprias. Agora o protocolo existe (gerado em modo conservador) e a
   *     liberação do PAR-Q acontece dentro da assinatura dele — um item, uma tela, uma
   *     ação. `severity: SAFETY`, porque é alerta clínico, não só sign-off.
   *   · `EDIT`: um CREF editou o conteúdo à mão e precisa de sign-off fresco.
   *     `severity: ALERT`.
   *   Nenhum tem job de auto-liberação agendado; nenhum sai sozinho.
   * - `optional` — protocolo `reviewUrgency: OPTIONAL`: **todo** protocolo sem PAR-Q
   *   bloqueado cai aqui, PASS limpo incluso (decisão do fundador, 2026-08-18: nem PASS
   *   entrega sozinho na hora — ver `protocol-planner.ts`). Todos têm
   *   `ProtocolAutoReleaseWorker` agendado, por isso é o único grupo onde `autoReleaseAt`
   *   sempre existe.
   */
  async queue(actor: AuthenticatedUser) {
    const { mandatory, optional } = await this.scopedRead(actor, async (tx) => {
      // LEFT JOIN (não INNER): protocolo anterior à migração 0035 não tem
      // `anamnesis_session_id` e continua aparecendo na fila normalmente, como `EDIT`.
      const pendingProtocols = await tx
        .select({
          id: protocols.id,
          createdAt: protocols.createdAt,
          status: protocols.status,
          name: users.name,
          reviewUrgency: protocols.reviewUrgency,
          parqState: anamnesisSessions.parqState,
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
        (isOptional ? optional : mandatory).push(
          this.item(
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
            isOptional ? null : fromParq ? 'PARQ' : 'EDIT',
          ),
        );
      }

      const byAge = (a: QueueItem, b: QueueItem) => a.createdAt.localeCompare(b.createdAt);
      return { mandatory: mandatory.sort(byAge), optional: optional.sort(byAge) };
    });

    return {
      mandatory,
      optional,
      counts: {
        mandatory: mandatory.length,
        optional: optional.length,
        total: mandatory.length + optional.length,
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
    return this.handoffDetail(actor, id);
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
      const verdict = this.validation.validate({
        structure: body.content,
        constraints: row.constraints as Pick<
          UserConstraints,
          'goal' | 'injuryTags' | 'preferredDays'
        >,
        parqFlags: row.parQFlags as UserConstraints['injuryTags'],
      });
      if (verdict.action !== 'PASS') {
        throw new BadRequestException({
          code: 'PROTOCOL_NOT_SAFE_TO_EDIT',
          violations: verdict.violations,
        });
      }
      const beforeHash = this.hashJson(row.content);
      const afterHash = signatureHash(body.content);
      await tx
        .update(protocols)
        .set({
          content: body.content,
          status: 'PENDING_SIGNATURE',
          approvalStatus: 'PENDING_REVIEW',
          professionalId: null,
          signedAt: null,
          signatureHash: null,
          humanReviewRequired: true,
          // Conteúdo editado por humano nunca sai sozinho — se já era `OPTIONAL`, o job de
          // auto-liberação (se ainda não disparou) vira no-op ao reconferir o estado.
          reviewUrgency: 'MANDATORY',
        })
        .where(eq(protocols.id, id));
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: row.userId,
        action: 'PROTOCOL_EDITED',
        entityType: 'protocol',
        entityId: id,
        changes: {
          reasonHash: this.hashJson(body.reason),
          beforeHash,
          afterHash,
          validation: verdict.code,
        },
      });
      return {
        id,
        status: 'PENDING_SIGNATURE',
        validation: verdict.code,
        violations: verdict.violations,
      };
    });
    this.queueEvents.emit('protocol');
    return edited;
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
  async signProtocol(actor: AuthenticatedUser, rawId: string, rawBody: unknown) {
    const id = this.parse(uuidSchema, rawId);
    this.parse(signSchema, rawBody);
    const signed = await this.scoped(actor, async (tx): Promise<SignProtocolResult> => {
      const row = await this.requireProtocol(tx, id, true);
      // Consentimento de saúde revogado → nada de assinar, para QUALQUER protocolo (não só
      // os de PAR-Q). Assinar é criar um documento novo a partir de dado de saúde e
      // disparar uma entrega; se o titular retirou a base legal, o ato inteiro perde
      // fundamento (Alexandre §5). Vem ANTES de qualquer escrita, de propósito.
      if (!(await this.healthConsent.hasActiveForUser(row.userId))) {
        throw new BadRequestException({
          code: 'HEALTH_CONSENT_REVOKED',
          message: 'Consentimento de dados de saude revogado — assinatura indisponivel.',
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
        throw new BadRequestException('Protocolo nao esta aguardando assinatura.');
      }
      // `ADMIN` (conta fundador) pula a checagem de credencial CREF — decisão do
      // fundador 2026-08-22: a MOVIVO no início só tem um profissional CREF, também
      // sócio-fundador, e a conta dele já é `ADMIN`. `PROFESSIONAL` continua exigindo
      // CREF ativo e verificado; isso NÃO abre exceção pra esse papel.
      if (actor.role !== 'ADMIN') {
        const [professional] = await tx
          .select({
            crefActive: users.crefActive,
            crefNumber: users.crefNumber,
            crefRegion: users.crefRegion,
          })
          .from(users)
          .where(eq(users.id, actor.userId))
          .limit(1);
        if (!professional?.crefActive || !professional.crefNumber || !professional.crefRegion) {
          throw new BadRequestException(
            'Credencial CREF ativa e verificada e obrigatoria para assinar.',
          );
        }
      }
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
            'O conteudo deste protocolo nao passa na validacao atual. Corrija antes de assinar.',
          issues: parsedContent.error.issues,
        });
      }
      const content = parsedContent.data;
      const verdict = this.validation.validate({
        structure: content,
        constraints: row.constraints as Pick<
          UserConstraints,
          'goal' | 'injuryTags' | 'preferredDays'
        >,
        parqFlags: row.parQFlags as UserConstraints['injuryTags'],
      });
      if (verdict.action !== 'PASS') {
        throw new BadRequestException({
          code: 'PROTOCOL_NOT_SAFE_TO_SIGN',
          violations: verdict.violations,
        });
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
      await tx.insert(protocolVersions).values({
        protocolId: id,
        userId: row.userId,
        version: nextVersion,
        status: 'ACTIVE',
        content,
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
        changes: { version: nextVersion, signatureHash: hash, signedAt: now.toISOString() },
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
        await this.scoped(actor, (tx) =>
          tx.update(protocols).set({ pdfContent: pdf }).where(eq(protocols.id, id)),
        );
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
      if (!row) throw new NotFoundException('Handoff nao encontrado.');
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
      const [funnel] = await tx
        .select({
          formStarted: sql<number>`count(distinct ${anamnesisSessions.id})::int`,
          protocolSent: sql<number>`count(distinct ${protocols.id}) filter (where ${protocols.status} = 'ACTIVE')::int`,
          converted: sql<number>`count(distinct ${subscriptions.id}) filter (where ${subscriptions.status} = 'ACTIVE')::int`,
        })
        .from(anamnesisSessions)
        .leftJoin(protocols, eq(protocols.userId, anamnesisSessions.userId))
        .leftJoin(subscriptions, eq(subscriptions.userId, anamnesisSessions.userId));
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
          name: users.name,
          phoneNumber: users.phoneNumber,
          email: users.email,
        })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.userId))
        .orderBy(desc(conversations.createdAt))
        .limit(100);
      const completedCheckins = await tx
        .select({ userId: checkins.userId, responsesCipher: checkins.responsesCipher })
        .from(checkins)
        .where(and(eq(checkins.currentQuestion, 4), isNotNull(checkins.responsesCipher)));
      const accessedUsers = new Set([
        ...replayRows.map((row) => row.userId),
        ...completedCheckins.map((row) => row.userId),
      ]);
      for (const userId of accessedUsers) {
        await this.auditRead(tx, actor, userId, 'operations_dashboard', userId);
      }
      const firstWorkout = await this.countUsersWithWorkout(completedCheckins);
      const replays = this.groupReplays(replayRows);
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
          content: row.content,
          signedAt: row.signedAt?.toISOString() ?? null,
          signatureHash: row.signatureHash,
          totalWeeks: row.totalWeeks,
          // Achado 2026-08-19: data de início/fim do card de revisão são calculadas no
          // cliente a partir daqui (criação + duração) — não existe coluna própria pra
          // "início real do protocolo", que hoje é a própria criação do registro.
          createdAt: row.createdAt.toISOString(),
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
      if (!found) throw new NotFoundException('Anamnese do titular nao encontrada.');
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
      if (!alert?.checkinId) throw new NotFoundException('Check-in nao encontrado.');
      const [checkin] = await tx
        .select({
          responsesCipher: checkins.responsesCipher,
          weekNumber: checkins.weekNumber,
          completedAt: checkins.completedAt,
        })
        .from(checkins)
        .where(eq(checkins.id, alert.checkinId))
        .limit(1);
      if (!checkin) throw new NotFoundException('Check-in nao encontrado.');
      await this.auditRead(tx, actor, alert.userId, 'checkin', alert.checkinId);
      return { ...alert, ...checkin };
    });
    const responses = row.responsesCipher
      ? (JSON.parse(await this.cipher.decryptHealth(row.responsesCipher)) as Record<
          string,
          unknown
        >)
      : {};
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
        completedAt: row.completedAt?.toISOString() ?? null,
        responses: JSON.stringify(responses),
      },
      handoff: { reason: row.reason, level: row.level, status: row.status },
    };
  }

  private async handoffDetail(actor: AuthenticatedUser, id: string) {
    return this.scopedRead(actor, async (tx) => {
      const [alert] = await tx
        .select({
          userId: handoffAlerts.userId,
          level: handoffAlerts.level,
          reason: handoffAlerts.reason,
          conversationId: handoffAlerts.conversationId,
          status: handoffAlerts.status,
          createdAt: handoffAlerts.createdAt,
        })
        .from(handoffAlerts)
        .where(eq(handoffAlerts.id, id))
        .limit(1);
      if (!alert) throw new NotFoundException('Handoff nao encontrado.');
      const [owner] = await tx
        .select({ name: users.name, phoneNumber: users.phoneNumber, email: users.email })
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
        .where(eq(conversations.userId, alert.userId))
        .orderBy(desc(conversations.createdAt))
        .limit(12);
      await this.auditRead(tx, actor, alert.userId, 'handoff_alert', id);
      const replayRows = context.reverse().map((message) => ({
        ...message,
        userId: alert.userId,
        name: owner?.name ?? null,
        phoneNumber: owner?.phoneNumber ?? '',
        email: owner?.email ?? null,
      }));
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
        context: { reason: alert.reason, messages: context.length },
        handoff: { reason: alert.reason, level: alert.level, status: alert.status },
        replay: this.groupReplays(replayRows)[0],
      };
    });
  }

  private async requireProtocol(tx: TenantTransaction, id: string, forUpdate = false) {
    const query = tx.select().from(protocols).where(eq(protocols.id, id));
    const [row] = forUpdate ? await query.for('update').limit(1) : await query.limit(1);
    if (!row) throw new NotFoundException('Protocolo nao encontrado.');
    return row;
  }

  private async auditRead(
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
      throw new ForbiddenException('Acesso exclusivo ao profissional CREF atribuido.');
    }
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
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
    };
  }

  private hashJson(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private async countUsersWithWorkout(
    rows: Array<{ userId: string; responsesCipher: Buffer | null }>,
  ): Promise<number> {
    const usersWithWorkout = new Set<string>();
    for (const row of rows) {
      if (!row.responsesCipher) continue;
      const response = JSON.parse(await this.cipher.decryptHealth(row.responsesCipher)) as {
        workouts?: string;
      };
      if (response.workouts && response.workouts !== 'NENHUM') usersWithWorkout.add(row.userId);
    }
    return usersWithWorkout.size;
  }

  private nullableNumber(value: unknown, divisor = 1): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed / divisor : null;
  }

  private groupReplays(
    rows: Array<{
      id: string;
      userId: string;
      direction: 'INBOUND' | 'OUTBOUND';
      content: string;
      createdAt: Date;
      name: string | null;
      phoneNumber: string;
      email: string | null;
    }>,
  ) {
    const groups = new Map<
      string,
      {
        conversationId: string;
        startedAt: string;
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
        messages: [],
      };
      current.messages.push({
        role: row.direction === 'INBOUND' ? 'USER' : 'ASSISTANT',
        content: scrubPII(row.content, row),
        createdAt: row.createdAt.toISOString(),
      });
      groups.set(conversationId, current);
    }
    return [...groups.values()];
  }
}
