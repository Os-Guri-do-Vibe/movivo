import {
  protocolStructureSchema,
  type AmendActiveProtocolInput,
  type ExerciseLevel,
} from '@movivo/shared';

import type {
  ActionResult,
  AlertsResponse,
  AlertsSummary,
  AnamnesisAnswers,
  AnonymizedReplay,
  ExerciseCatalogOption,
  NotificationHistoryItem,
  NotificationHistoryQuery,
  NotificationHistoryResponse,
  NotificationItem,
  NotificationsResponse,
  NotificationsSummary,
  NotificationType,
  OperationsResponse,
  ProtocolConflict,
  ProtocolReview,
  QueueDetail,
  QueueItem,
  QueueKind,
  QueueResponse,
  QueueSeverity,
  ReplayMessage,
  SubstitutionDetail,
  SubstitutionItemEdit,
  SubstitutionItemView,
} from './dashboard-types';
import { isAnalyticsEnabled } from './env';

export class DashboardApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    /** Código de negócio do backend (ex.: `PROFESSIONAL_DECISION_REQUIRED`). */
    readonly code?: string,
    /** Divergências que o profissional precisa reconhecer para concluir a ação. */
    readonly conflicts: ProtocolConflict[] = [],
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseQueueKind(value: unknown): QueueKind {
  if (
    value === 'PROTOCOL' ||
    value === 'HANDOFF' ||
    value === 'CHECKIN' ||
    value === 'SUBSTITUTION'
  ) {
    return value;
  }
  throw new DashboardApiError(502, 'A fila devolveu um tipo de item desconhecido.');
}

/**
 * `origin` é LEGENDA (por que este item exige revisão), não contrato de renderização:
 * um valor novo que o backend passe a mandar não pode derrubar a fila inteira, então
 * cai em `null` — o card continua correto, só sem a legenda. Diferente de
 * `kind`/`severity`, que decidem rota e cor e por isso continuam estritos.
 */
function parseOrigin(value: unknown): QueueItem['origin'] {
  return value === 'PARQ' ||
    value === 'FALLBACK' ||
    value === 'EDIT' ||
    value === 'QUALITY' ||
    value === 'AI_SUBSTITUTION' ||
    value === 'CATALOG_GAP'
    ? value
    : null;
}

function parseSeverity(value: unknown): QueueSeverity {
  if (value === 'SAFETY' || value === 'ALERT' || value === 'ROUTINE') return value;
  throw new DashboardApiError(502, 'A fila devolveu uma prioridade desconhecida.');
}

export function parseQueueItem(value: unknown): QueueItem {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Item da fila inválido.');
  const id = string(value.id);
  const createdAt = string(value.createdAt);
  const title = string(value.title);
  if (!id || !createdAt || !title) throw new DashboardApiError(502, 'Item da fila incompleto.');
  return {
    id,
    kind: parseQueueKind(value.kind),
    severity: parseSeverity(value.severity),
    createdAt,
    ageMinutes: Math.max(0, finiteNumber(value.ageMinutes)),
    title,
    summary: string(value.summary),
    status: string(value.status, 'PENDENTE'),
    autoReleaseAt: typeof value.autoReleaseAt === 'string' ? value.autoReleaseAt : null,
    origin: parseOrigin(value.origin),
    ...(value.isFallback === true ? { isFallback: true } : {}),
    read: value.read === true,
  };
}

export function parseQueueResponse(value: unknown): QueueResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.mandatory) ||
    !Array.isArray(value.optional) ||
    !Array.isArray(value.substitutionMandatory) ||
    !Array.isArray(value.substitutionOptional)
  ) {
    throw new DashboardApiError(502, 'Resposta da fila inválida.');
  }
  const counts = isRecord(value.counts) ? value.counts : {};
  return {
    mandatory: value.mandatory.map(parseQueueItem),
    optional: value.optional.map(parseQueueItem),
    substitutionMandatory: value.substitutionMandatory.map(parseQueueItem),
    substitutionOptional: value.substitutionOptional.map(parseQueueItem),
    counts: {
      mandatory: finiteNumber(counts.mandatory),
      optional: finiteNumber(counts.optional),
      substitutionMandatory: finiteNumber(counts.substitutionMandatory),
      substitutionOptional: finiteNumber(counts.substitutionOptional),
      total: finiteNumber(counts.total),
    },
  };
}

function parseAlert(value: unknown): AlertsResponse['open'][number] {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Alerta inválido.');
  const id = string(value.id);
  const createdAt = string(value.createdAt);
  const updatedAt = string(value.updatedAt);
  const reason = string(value.reason);
  if (!id || !createdAt || !updatedAt || !reason) {
    throw new DashboardApiError(502, 'Alerta incompleto.');
  }
  if (value.level !== 'SAFETY' && value.level !== 'ALERT') {
    throw new DashboardApiError(502, 'Prioridade de alerta desconhecida.');
  }
  if (value.status !== 'OPEN' && value.status !== 'RESOLVED') {
    throw new DashboardApiError(502, 'Estado de alerta desconhecido.');
  }
  return {
    id,
    studentName: typeof value.studentName === 'string' ? value.studentName : null,
    level: value.level,
    reason,
    sourceType: typeof value.sourceType === 'string' ? value.sourceType : null,
    status: value.status,
    createdAt,
    updatedAt,
    read: value.read === true,
  };
}

export function parseAlertsResponse(value: unknown): AlertsResponse {
  if (!isRecord(value) || !Array.isArray(value.open) || !Array.isArray(value.resolved)) {
    throw new DashboardApiError(502, 'Resposta de alertas inválida.');
  }
  return { open: value.open.map(parseAlert), resolved: value.resolved.map(parseAlert) };
}

export function parseAlertsSummary(value: unknown): AlertsSummary {
  if (!isRecord(value) || !Number.isFinite(value.open) || Number(value.open) < 0) {
    throw new DashboardApiError(502, 'Resumo de alertas inválido.');
  }
  return { open: Math.floor(Number(value.open)) };
}

function parseNotificationType(value: unknown): NotificationType {
  if (value === 'alert' || value === 'protocol' || value === 'substitution') return value;
  throw new DashboardApiError(502, 'Tipo de notificação desconhecido.');
}

function parseNotificationItem(value: unknown): NotificationItem {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Notificação inválida.');
  const id = string(value.id);
  const createdAt = string(value.createdAt);
  if (!id || !createdAt) throw new DashboardApiError(502, 'Notificação incompleta.');
  return {
    type: parseNotificationType(value.type),
    id,
    read: value.read === true,
    createdAt,
    level: value.level === 'SAFETY' || value.level === 'ALERT' ? value.level : null,
    title: typeof value.title === 'string' ? value.title : null,
    studentName: typeof value.studentName === 'string' ? value.studentName : null,
    reason: typeof value.reason === 'string' ? value.reason : null,
    sourceType: typeof value.sourceType === 'string' ? value.sourceType : null,
    section: value.section === 'MANDATORY' || value.section === 'OPTIONAL' ? value.section : null,
    origin: parseOrigin(value.origin),
    autoReleaseAt: typeof value.autoReleaseAt === 'string' ? value.autoReleaseAt : null,
  };
}

function count(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new DashboardApiError(502, message);
  }
  return Math.floor(value);
}

export function parseNotificationsResponse(value: unknown): NotificationsResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new DashboardApiError(502, 'Resposta de notificações inválida.');
  }
  return {
    snapshotAt: string(value.snapshotAt) || new Date().toISOString(),
    items: value.items.map(parseNotificationItem),
    totalPending: count(value.totalPending, 'Total de notificações inválido.'),
    unread: count(value.unread, 'Contagem de não lidas inválida.'),
    openSafety: count(value.openSafety, 'Contagem de alertas de segurança inválida.'),
  };
}

const OUTCOMES = new Set(['RESOLVED', 'SIGNED', 'AUTO_RELEASED', 'RELEASED', 'DISCARDED']);

function parseHistoryItem(value: unknown): NotificationHistoryItem {
  const item = parseNotificationItem(value);
  const record = value as Record<string, unknown>;
  const outcome = typeof record.outcome === 'string' && OUTCOMES.has(record.outcome);
  return {
    ...item,
    status: record.status === 'SETTLED' ? 'SETTLED' : 'PENDING',
    outcome: outcome ? (record.outcome as NotificationHistoryItem['outcome']) : null,
    settledAt: typeof record.settledAt === 'string' ? record.settledAt : null,
  };
}

export function parseNotificationHistory(value: unknown): NotificationHistoryResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new DashboardApiError(502, 'Resposta do registro de notificações inválida.');
  }
  return {
    snapshotAt: string(value.snapshotAt) || new Date().toISOString(),
    items: value.items.map(parseHistoryItem),
    nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null,
    unread: count(value.unread, 'Contagem de não lidas inválida.'),
    openSafety: count(value.openSafety, 'Contagem de alertas de segurança inválida.'),
  };
}

export function parseNotificationsSummary(value: unknown): NotificationsSummary {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Resumo de notificações inválido.');
  return {
    unread: count(value.unread, 'Contagem de não lidas inválida.'),
    openSafety: count(value.openSafety, 'Contagem de alertas de segurança inválida.'),
  };
}

function parseReplayMessage(value: unknown): ReplayMessage {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Mensagem anonimizada inválida.');
  const role = string(value.role).toUpperCase();
  if (role !== 'USER' && role !== 'ASSISTANT' && role !== 'PROFESSIONAL' && role !== 'SYSTEM') {
    throw new DashboardApiError(502, 'Papel de mensagem inválido.');
  }
  return { role, content: string(value.content), createdAt: string(value.createdAt) };
}

function parseReplay(value: unknown): AnonymizedReplay {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    throw new DashboardApiError(502, 'Replay anonimizado inválido.');
  }
  return {
    conversationId: string(value.conversationId),
    startedAt: string(value.startedAt),
    studentName: typeof value.studentName === 'string' ? value.studentName : null,
    messages: value.messages.map(parseReplayMessage),
  };
}

function parseContext(value: unknown): QueueDetail['context'] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      entry === null || ['string', 'number', 'boolean'].includes(typeof entry)
        ? [[key, entry as string | number | boolean | null]]
        : [],
    ),
  );
}

export function parseQueueDetail(value: unknown): QueueDetail {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Detalhe da fila inválido.');
  const item = parseQueueItem(value.item);
  const result: QueueDetail = { item, context: parseContext(value.context) };

  if (isRecord(value.protocol)) {
    const parsedContent = protocolStructureSchema.safeParse(value.protocol.content);
    if (!parsedContent.success) {
      throw new DashboardApiError(502, 'O protocolo recebido não respeita o contrato.');
    }
    const validation = isRecord(value.protocol.validation)
      ? {
          valid: value.protocol.validation.valid === true,
          issues: Array.isArray(value.protocol.validation.issues)
            ? value.protocol.validation.issues.map((issue) => string(issue)).filter(Boolean)
            : [],
        }
      : undefined;
    result.protocol = {
      id: string(value.protocol.id, item.id),
      version: finiteNumber(value.protocol.version, 1),
      status: string(value.protocol.status, item.status),
      approvalStatus: string(value.protocol.approvalStatus, item.status),
      content: parsedContent.data,
      signedAt: typeof value.protocol.signedAt === 'string' ? value.protocol.signedAt : null,
      signatureHash:
        typeof value.protocol.signatureHash === 'string' ? value.protocol.signatureHash : null,
      totalWeeks: finiteNumber(value.protocol.totalWeeks, 12),
      ...(value.protocol.isFallback === true ? { isFallback: true } : {}),
      createdAt:
        typeof value.protocol.createdAt === 'string'
          ? value.protocol.createdAt
          : new Date().toISOString(),
      ...(validation ? { validation } : {}),
    };
    const review = parseProtocolReview(value.protocol.review);
    if (review) result.protocol.review = review;
  }
  if (value.replay !== undefined) result.replay = parseReplay(value.replay);
  if (isRecord(value.handoff)) {
    const trigger: NonNullable<QueueDetail['handoff']>['trigger'] = isRecord(value.handoff.trigger)
      ? {
          content: string(value.handoff.trigger.content),
          createdAt: string(value.handoff.trigger.createdAt),
          direction:
            value.handoff.trigger.direction === 'INBOUND' ||
            value.handoff.trigger.direction === 'OUTBOUND'
              ? (value.handoff.trigger.direction as 'INBOUND' | 'OUTBOUND')
              : ('INBOUND' as const),
        }
      : null;
    result.handoff = {
      reason: string(value.handoff.reason) || item.summary,
      level: string(value.handoff.level) || item.severity,
      status: string(value.handoff.status) || item.status,
      ...(typeof value.handoff.studentId === 'string'
        ? { studentId: value.handoff.studentId }
        : {}),
      studentName: typeof value.handoff.studentName === 'string' ? value.handoff.studentName : null,
      sourceType: typeof value.handoff.sourceType === 'string' ? value.handoff.sourceType : null,
      sourceId: typeof value.handoff.sourceId === 'string' ? value.handoff.sourceId : null,
      ...(typeof value.handoff.createdAt === 'string'
        ? { createdAt: value.handoff.createdAt }
        : {}),
      ...(typeof value.handoff.updatedAt === 'string'
        ? { updatedAt: value.handoff.updatedAt }
        : {}),
      ...(trigger ? { trigger } : {}),
    };
  }
  if (isRecord(value.substitution))
    result.substitution = parseSubstitutionDetail(value.substitution);
  return result;
}

function parseExerciseRef(value: unknown): { id: string; name: string } {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Exercício da substituição inválido.');
  return { id: string(value.id), name: string(value.name) };
}

/** Achado 2026-09-09: `to.id` pode ser `null` (proposta `catalogGap`, sem substituto real
 * ainda) — `name` continua sempre presente (texto pedido pelo aluno). */
function parseNullableExerciseRef(value: unknown): { id: string | null; name: string } {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Exercício da substituição inválido.');
  return { id: typeof value.id === 'string' ? value.id : null, name: string(value.name) };
}

function parseSubstitutionItem(value: unknown, fallbackIndex: number): SubstitutionItemView {
  if (!isRecord(value)) throw new DashboardApiError(502, 'Item da substituição inválido.');
  const decision = value.decision;
  return {
    index: typeof value.index === 'number' ? value.index : fallbackIndex,
    from: parseExerciseRef(value.from),
    to: parseNullableExerciseRef(value.to),
    catalogGap: value.catalogGap === true,
    mandatory: value.mandatory === true,
    decision: decision === 'APPROVED' || decision === 'DISCARDED' ? decision : 'PENDING',
    options: Array.isArray(value.options) ? value.options.map(parseExerciseRef) : [],
  };
}

function parseSubstitutionDetail(value: Record<string, unknown>): SubstitutionDetail {
  const status = value.status;
  if (status !== 'PENDING' && status !== 'RELEASED' && status !== 'DISCARDED') {
    throw new DashboardApiError(502, 'Estado da substituição inválido.');
  }
  const diff = isRecord(value.diff) ? value.diff : null;
  return {
    id: string(value.id),
    protocolId: string(value.protocolId),
    from: parseExerciseRef(value.from),
    to: parseNullableExerciseRef(value.to),
    // Resposta sem `items` (API anterior ao lote): a proposta é o único item das colunas.
    items: Array.isArray(value.items)
      ? value.items.map(parseSubstitutionItem)
      : [
          parseSubstitutionItem(
            {
              index: 0,
              from: value.from,
              to: value.to,
              catalogGap: value.catalogGap,
              mandatory: value.reviewUrgency === 'MANDATORY',
              decision: status,
              options: [],
            },
            0,
          ),
        ],
    diff: diff
      ? {
          type: 'EXERCISE_SUBSTITUTION',
          from: parseExerciseRef(diff.from),
          to: parseExerciseRef(diff.to),
          sessionsAffected: Array.isArray(diff.sessionsAffected)
            ? diff.sessionsAffected.map((s) => string(s)).filter(Boolean)
            : [],
        }
      : null,
    changeReason: string(value.changeReason),
    status,
    decidedAt: typeof value.decidedAt === 'string' ? value.decidedAt : null,
    reviewUrgency: value.reviewUrgency === 'MANDATORY' ? 'MANDATORY' : 'OPTIONAL',
    catalogGap: value.catalogGap === true,
  };
}

export function parseOperations(value: unknown): OperationsResponse {
  if (!isRecord(value) || !isRecord(value.funnel) || !isRecord(value.sla)) {
    throw new DashboardApiError(502, 'Resposta de operações inválida.');
  }
  const replays = Array.isArray(value.replays) ? value.replays.map(parseReplay) : [];
  return {
    funnel: {
      formStarted: Math.max(0, finiteNumber(value.funnel.formStarted)),
      protocolSent: Math.max(0, finiteNumber(value.funnel.protocolSent)),
      firstWorkout:
        value.funnel.firstWorkout === null
          ? null
          : Math.max(0, finiteNumber(value.funnel.firstWorkout)),
      converted: Math.max(0, finiteNumber(value.funnel.converted)),
    },
    sla: {
      protocolDeliveryMinutes:
        value.sla.protocolDeliveryMinutes === null
          ? null
          : Math.max(0, finiteNumber(value.sla.protocolDeliveryMinutes)),
      coachP95Seconds:
        value.sla.coachP95Seconds === null
          ? null
          : Math.max(0, finiteNumber(value.sla.coachP95Seconds)),
      protocolBreached: value.sla.protocolBreached === true,
      coachBreached: value.sla.coachBreached === true,
    },
    replays,
  };
}

export function parseConflicts(value: unknown): ProtocolConflict[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.key === 'string' && typeof entry.detail === 'string'
      ? [{ key: entry.key, rule: string(entry.rule), detail: entry.detail }]
      : [],
  );
}

function parseProtocolReview(value: unknown): ProtocolReview | undefined {
  if (!isRecord(value)) return undefined;
  const availability = isRecord(value.availability) ? value.availability : {};
  return {
    origin: value.origin === 'PROFESSIONAL' ? 'PROFESSIONAL' : 'AI',
    availability: {
      daysPerWeek: typeof availability.daysPerWeek === 'number' ? availability.daysPerWeek : null,
      preferredDays: Array.isArray(availability.preferredDays)
        ? availability.preferredDays.filter((day): day is string => typeof day === 'string')
        : [],
    },
    blocking: parseConflicts(value.blocking),
    conflicts: parseConflicts(value.conflicts),
    ...(Array.isArray(value.qualityNotices)
      ? {
          qualityNotices: value.qualityNotices.filter(
            (notice): notice is string => typeof notice === 'string',
          ),
        }
      : {}),
  };
}

export function violationDetails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    isRecord(entry) && typeof entry.detail === 'string' && entry.detail.trim()
      ? [entry.detail.trim()]
      : [],
  );
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/dashboard${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = isRecord(value) ? value : {};
    // Recusa por regra de segurança (ex.: assinatura): a API manda `violations` sem `message`,
    // e o texto genérico escondia o que precisava ser corrigido.
    const violations = violationDetails(record.violations);
    throw new DashboardApiError(
      response.status,
      violations.length > 0
        ? `Regras de segurança não atendidas: ${violations.join('; ')}`
        : string(record.message, 'Não foi possível concluir a solicitação.'),
      record.validation ?? record.issues ?? (violations.length > 0 ? violations : undefined),
      typeof record.code === 'string' ? record.code : undefined,
      parseConflicts(record.conflicts),
    );
  }
  return value;
}

export async function getQueue(signal?: AbortSignal): Promise<QueueResponse> {
  return parseQueueResponse(await request('/queue', { signal }));
}

export async function getAlerts(signal?: AbortSignal): Promise<AlertsResponse> {
  return parseAlertsResponse(await request('/alerts', { signal }));
}

export async function getAlertsSummary(signal?: AbortSignal): Promise<AlertsSummary> {
  return parseAlertsSummary(await request('/alerts/summary', { signal }));
}

export async function getNotifications(signal?: AbortSignal): Promise<NotificationsResponse> {
  return parseNotificationsResponse(await request('/notifications', { signal }));
}

export async function getNotificationHistory(
  query: NotificationHistoryQuery,
  signal?: AbortSignal,
): Promise<NotificationHistoryResponse> {
  const params = new URLSearchParams({ state: query.state, type: query.type });
  if (query.cursor) params.set('cursor', query.cursor);
  return parseNotificationHistory(await request(`/notifications/history?${params}`, { signal }));
}

export async function getNotificationsSummary(signal?: AbortSignal): Promise<NotificationsSummary> {
  return parseNotificationsSummary(await request('/notifications/summary', { signal }));
}

/** Idempotente: registra que a conta atual abriu o item. Não resolve nem assina nada. */
export async function markNotificationRead(type: NotificationType, id: string): Promise<void> {
  await request('/notifications/read', { method: 'POST', body: JSON.stringify({ type, id }) });
}

/** Marca como lido tudo o que já existia em `until` (o instante do retrato que a pessoa viu). */
export async function markAllNotificationsRead(until: string): Promise<void> {
  await request('/notifications/read-all', { method: 'POST', body: JSON.stringify({ until }) });
}

export async function getQueueDetail(
  kind: QueueKind,
  id: string,
  signal?: AbortSignal,
): Promise<QueueDetail> {
  return parseQueueDetail(
    await request(`/queue/${kind.toLowerCase()}/${encodeURIComponent(id)}`, { signal }),
  );
}

/**
 * Validação leve (checa formato, não cada enum individualmente) — condizente com o
 * resto do arquivo: campos exibidos read-only pro CREF, não reeditados/reenviados
 * (diferente de `protocol.content`, que passa por `protocolStructureSchema` porque
 * volta a ser gravado).
 */
export function parseAnamnesisAnswers(value: unknown): AnamnesisAnswers {
  if (!isRecord(value) || !isRecord(value.personal) || !isRecord(value.routine)) {
    throw new DashboardApiError(502, 'Respostas da anamnese em formato inválido.');
  }
  return {
    userId: string(value.userId),
    submittedAt: typeof value.submittedAt === 'string' ? value.submittedAt : null,
    personal: value.personal as AnamnesisAnswers['personal'],
    routine: value.routine as AnamnesisAnswers['routine'],
    health: isRecord(value.health) ? (value.health as AnamnesisAnswers['health']) : {},
  };
}

/**
 * Respostas da anamnese do titular (o olho da fila e a página standalone).
 *
 * O `kind` sobreviveu à remoção do PAR-Q (2026-08-24) porque o backend expõe o endpoint
 * POR kind (`/queue/{kind}/{id}/anamnesis`) — só que hoje `protocol` é o único que
 * existe lá: o antigo `/queue/parq/{sessionId}/anamnesis` (item de fila sem protocolo
 * ainda) foi removido junto com o `kind: 'PARQ'`.
 */
export async function getAnamnesisAnswers(
  kind: 'PROTOCOL',
  id: string,
  signal?: AbortSignal,
): Promise<AnamnesisAnswers> {
  return parseAnamnesisAnswers(
    await request(`/queue/${kind.toLowerCase()}/${encodeURIComponent(id)}/anamnesis`, { signal }),
  );
}

export async function getOperations(signal?: AbortSignal): Promise<OperationsResponse> {
  return parseOperations(await request('/operations', { signal }));
}

export async function saveProtocol(id: string, content: unknown): Promise<ActionResult> {
  return (await request(`/protocols/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  })) as ActionResult;
}

/** Atualiza um protocolo ativo sem perder seu rastro de versões e assinatura CREF. */
export async function amendActiveProtocol(
  id: string,
  input: AmendActiveProtocolInput,
): Promise<ActionResult> {
  return (await request(`/protocols/${encodeURIComponent(id)}/amend`, {
    method: 'POST',
    body: JSON.stringify(input),
  })) as ActionResult;
}

/**
 * Assinatura do protocolo. Desde 2026-08-24 é também a ÚNICA liberação de PAR-Q: quando
 * o protocolo vem de uma sessão bloqueada (`QueueItem.origin === 'PARQ'`), o backend
 * libera o PAR-Q dentro da própria assinatura — não existe mais ação separada.
 */
export async function signProtocol(
  id: string,
  acknowledgedConflicts: readonly string[] = [],
): Promise<ActionResult> {
  return (await request(`/protocols/${encodeURIComponent(id)}/sign`, {
    method: 'POST',
    body: JSON.stringify({
      confirmation: true,
      ...(acknowledgedConflicts.length > 0 ? { acknowledgedConflicts } : {}),
    }),
  })) as ActionResult;
}

/**
 * Autocomplete do exercício no editor de protocolo: só exercícios publicados do catálogo
 * oficial. `protocolId` faz cada item trazer o que é contraindicado para aquele aluno.
 */
export async function searchExerciseCatalog(
  query: string,
  options: { protocolId?: string; signal?: AbortSignal } = {},
): Promise<ExerciseCatalogOption[]> {
  const params = new URLSearchParams({ q: query });
  if (options.protocolId) params.set('protocolId', options.protocolId);
  const value = await request(`/exercise-catalog/search?${params.toString()}`, {
    signal: options.signal,
  });
  const items = isRecord(value) && Array.isArray(value.items) ? value.items : [];
  return items.flatMap((item): ExerciseCatalogOption[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
    const strings = (list: unknown) =>
      Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : [];
    return [
      {
        id: item.id,
        name: item.name,
        pattern: string(item.pattern),
        muscleGroups: strings(item.muscleGroups),
        equipment: strings(item.equipment),
        measurement: item.measurement === 'DURATION' ? 'DURATION' : 'REPS',
        contraindicatedForStudent: strings(item.contraindicatedForStudent),
      },
    ];
  });
}

/**
 * Aprova a proposta de substituição de exercício ANTES da janela de 30 min. `edits` traz a
 * decisão por item (troca em lote): outro exercício no lugar do proposto, ou descartar o item.
 * Sem `edits`, aprova todos os itens como estão.
 */
export async function approveSubstitutionNow(
  id: string,
  edits?: readonly SubstitutionItemEdit[],
): Promise<ActionResult> {
  return (await request(`/substitutions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: edits && edits.length > 0 ? JSON.stringify({ items: edits }) : undefined,
  })) as ActionResult;
}

/** Recusa a proposta — mantém o exercício original, sem tocar no protocolo do aluno. */
export async function discardSubstitution(id: string): Promise<ActionResult> {
  return (await request(`/substitutions/${encodeURIComponent(id)}/discard`, {
    method: 'POST',
  })) as ActionResult;
}

/** Payload pra publicar um exercício novo no catálogo — mesmos campos da tela "Exercícios". */
export interface NewCatalogExercisePayload {
  exerciseKey: string;
  changeNote: string;
  name: string;
  pattern: string;
  muscleGroups: string[];
  equipment: string[];
  locations: string[];
  /** Níveis de aluno que recebem o exercício (substitui `minLevel`, achado 2026-09-29). */
  levels: ExerciseLevel[];
  contraindicatedFor: string[];
  substitutes: string[];
  videoUrl?: string;
}

/**
 * Achado 2026-09-09 (pedido do fundador): só pra item `catalogGap` — publica o exercício
 * pedido pelo aluno no catálogo e o liga ao item. Achado 2026-09-30: NÃO aprova mais; o item
 * vira uma troca comum e o profissional decide na tela única, item a item. Se o exercício
 * recém-publicado, aplicado ao protocolo inteiro, quebrar a validação, nada é ligado (o erro
 * descreve o motivo) — o exercício fica publicado pra tentar de novo com outra categorização.
 */
export async function addCatalogExerciseToSubstitutionItem(
  id: string,
  itemIndex: number,
  payload: NewCatalogExercisePayload,
): Promise<ActionResult> {
  return (await request(
    `/substitutions/${encodeURIComponent(id)}/items/${itemIndex}/catalog-exercise`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )) as ActionResult;
}

export async function resolveHandoff(
  id: string,
  resolution: string,
  notes: string,
): Promise<ActionResult> {
  return (await request(`/handoffs/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolution, notes, confirmation: true }),
  })) as ActionResult;
}

export function captureDashboardEvent(
  name: string,
  properties: Record<string, unknown> = {},
): void {
  if (!isAnalyticsEnabled) return;
  void import('posthog-js').then(({ default: posthog }) => posthog.capture(name, properties));
}
