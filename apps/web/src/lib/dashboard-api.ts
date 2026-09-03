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
  SubstitutionDetail,
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
  return value === 'PARQ' || value === 'EDIT' || value === 'AI_SUBSTITUTION' ? value : null;
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
  if (isRecord(value.handoff)) {
    result.handoff = {
      reason: string(value.handoff.reason) || item.summary,
      level: string(value.handoff.level) || item.severity,
      status: string(value.handoff.status) || item.status,
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

function parseSubstitutionDetail(value: Record<string, unknown>): SubstitutionDetail {
  const status = value.status;
  if (status !== 'PENDING' && status !== 'RELEASED' && status !== 'DISCARDED') {
    throw new DashboardApiError(502, 'Estado da substituição inválido.');
  }
  const diff = isRecord(value.diff) ? value.diff : {};
  return {
    id: string(value.id),
    protocolId: string(value.protocolId),
    from: parseExerciseRef(value.from),
    to: parseExerciseRef(value.to),
    diff: {
      type: 'EXERCISE_SUBSTITUTION',
      from: parseExerciseRef(diff.from),
      to: parseExerciseRef(diff.to),
      sessionsAffected: Array.isArray(diff.sessionsAffected)
        ? diff.sessionsAffected.map((s) => string(s)).filter(Boolean)
        : [],
    },
    changeReason: string(value.changeReason),
    status,
    decidedAt: typeof value.decidedAt === 'string' ? value.decidedAt : null,
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

/**
 * Assinatura do protocolo. Desde 2026-08-24 é também a ÚNICA liberação de PAR-Q: quando
 * o protocolo vem de uma sessão bloqueada (`QueueItem.origin === 'PARQ'`), o backend
 * libera o PAR-Q dentro da própria assinatura — não existe mais ação separada.
 */
export async function signProtocol(id: string): Promise<ActionResult> {
  return (await request(`/protocols/${encodeURIComponent(id)}/sign`, {
    method: 'POST',
    body: JSON.stringify({ confirmation: true }),
  })) as ActionResult;
}

/** Aprova a proposta de substituição de exercício ANTES da janela de 30 min. */
export async function approveSubstitutionNow(id: string): Promise<ActionResult> {
  return (await request(`/substitutions/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  })) as ActionResult;
}

/** Recusa a proposta — mantém o exercício original, sem tocar no protocolo do aluno. */
export async function discardSubstitution(id: string): Promise<ActionResult> {
  return (await request(`/substitutions/${encodeURIComponent(id)}/discard`, {
    method: 'POST',
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
