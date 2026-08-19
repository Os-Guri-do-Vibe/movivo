import { protocolStructureSchema } from '@movivo/shared';

import type {
  ActionResult,
  AnamnesisAnswers,
  AnonymizedReplay,
  OperationsResponse,
  QueueDetail,
  QueueItem,
  QueueKind,
  QueueResponse,
  QueueSeverity,
  ReplayMessage,
} from './dashboard-types';
import { isAnalyticsEnabled } from './env';

export class DashboardApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
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
  if (value === 'PROTOCOL' || value === 'HANDOFF' || value === 'PARQ' || value === 'CHECKIN') {
    return value;
  }
  throw new DashboardApiError(502, 'A fila devolveu um tipo de item desconhecido.');
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
  };
}

export function parseQueueResponse(value: unknown): QueueResponse {
  if (!isRecord(value) || !Array.isArray(value.mandatory) || !Array.isArray(value.optional)) {
    throw new DashboardApiError(502, 'Resposta da fila inválida.');
  }
  const counts = isRecord(value.counts) ? value.counts : {};
  return {
    mandatory: value.mandatory.map(parseQueueItem),
    optional: value.optional.map(parseQueueItem),
    counts: {
      mandatory: finiteNumber(counts.mandatory),
      optional: finiteNumber(counts.optional),
      total: finiteNumber(counts.total),
    },
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
      createdAt:
        typeof value.protocol.createdAt === 'string'
          ? value.protocol.createdAt
          : new Date().toISOString(),
      ...(validation ? { validation } : {}),
    };
  }
  if (value.replay !== undefined) result.replay = parseReplay(value.replay);
  if (isRecord(value.parq)) {
    result.parq = {
      flags: Array.isArray(value.parq.flags)
        ? value.parq.flags.map((flag) => string(flag)).filter(Boolean)
        : [],
      state: string(value.parq.state, item.status),
    };
  }
  if (isRecord(value.handoff)) {
    result.handoff = {
      reason: string(value.handoff.reason) || item.summary,
      level: string(value.handoff.level) || item.severity,
      status: string(value.handoff.status) || item.status,
    };
  }
  return result;
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

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`/api/dashboard${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = isRecord(value) ? value : {};
    throw new DashboardApiError(
      response.status,
      string(record.message, 'Não foi possível concluir a solicitação.'),
      record.validation ?? record.issues,
    );
  }
  return value;
}

export async function getQueue(signal?: AbortSignal): Promise<QueueResponse> {
  return parseQueueResponse(await request('/queue', { signal }));
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

export async function getProtocolAnamnesisAnswers(
  protocolId: string,
  signal?: AbortSignal,
): Promise<AnamnesisAnswers> {
  return parseAnamnesisAnswers(
    await request(`/queue/protocol/${encodeURIComponent(protocolId)}/anamnesis`, { signal }),
  );
}

/**
 * Mesmas respostas, mas partindo direto de uma sessão PAR-Q (o olho da caixa "Revisão
 * Humana Obrigatória" — item ainda não virou protocolo, então não há `protocolId`).
 */
export async function getParqAnamnesisAnswers(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AnamnesisAnswers> {
  return parseAnamnesisAnswers(
    await request(`/queue/parq/${encodeURIComponent(sessionId)}/anamnesis`, { signal }),
  );
}

/** O olho da fila chama uma das duas acima conforme o `kind` do item — sem `if` espalhado. */
export async function getAnamnesisAnswers(
  kind: 'PROTOCOL' | 'PARQ',
  id: string,
  signal?: AbortSignal,
): Promise<AnamnesisAnswers> {
  return kind === 'PROTOCOL'
    ? getProtocolAnamnesisAnswers(id, signal)
    : getParqAnamnesisAnswers(id, signal);
}

export async function getOperations(signal?: AbortSignal): Promise<OperationsResponse> {
  return parseOperations(await request('/operations', { signal }));
}

export async function saveProtocol(
  id: string,
  content: unknown,
  reason: string,
): Promise<ActionResult> {
  return (await request(`/protocols/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ content, reason }),
  })) as ActionResult;
}

export async function signProtocol(id: string): Promise<ActionResult> {
  return (await request(`/protocols/${encodeURIComponent(id)}/sign`, {
    method: 'POST',
    body: JSON.stringify({ confirmation: true }),
  })) as ActionResult;
}

export async function releaseParq(id: string, notes: string): Promise<ActionResult> {
  return (await request(`/parq/${encodeURIComponent(id)}/release`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'RELEASED', notes, confirmation: true }),
  })) as ActionResult;
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
