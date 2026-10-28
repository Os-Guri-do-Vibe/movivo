/**
 * Cliente da página de treino do aluno. Fala só com o BFF (`/api/training/*`), que guarda a
 * sessão num cookie HttpOnly; o navegador nunca vê o token.
 */
import {
  executionViewSchema,
  trainingDaySchema,
  type ExecutionView,
  type FinishExecutionRequest,
  type LogExternalRequest,
  type SaveMetricsRequest,
  type SaveSetsRequest,
  type TrainingDay,
} from '@movivo/shared';

export class TrainingApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api/training${path}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
  if (!response.ok) {
    const message =
      typeof payload?.message === 'string' ? payload.message : 'Não foi possível concluir.';
    throw new TrainingApiError(response.status, message);
  }
  return payload;
}

export async function getTrainingDay(date?: string): Promise<TrainingDay> {
  const payload = await request(`/day${date ? `?date=${encodeURIComponent(date)}` : ''}`);
  return trainingDaySchema.parse(payload);
}

export async function startSession(scheduledSessionId: string): Promise<ExecutionView> {
  const payload = await request(`/sessions/${encodeURIComponent(scheduledSessionId)}/start`, {
    method: 'POST',
  });
  return executionViewSchema.parse(payload);
}

export async function saveSets(executionId: string, body: SaveSetsRequest): Promise<ExecutionView> {
  const payload = await request(`/executions/${encodeURIComponent(executionId)}/sets`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return executionViewSchema.parse(payload);
}

export async function saveMetrics(
  executionId: string,
  body: SaveMetricsRequest,
): Promise<ExecutionView> {
  const payload = await request(`/executions/${encodeURIComponent(executionId)}/metrics`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return executionViewSchema.parse(payload);
}

export async function uploadActivityFile(executionId: string, file: File): Promise<ExecutionView> {
  const form = new FormData();
  form.set('file', file, file.name);
  const payload = await request(`/executions/${encodeURIComponent(executionId)}/file`, {
    method: 'POST',
    body: form,
  });
  return executionViewSchema.parse(payload);
}

export async function finishExecution(
  executionId: string,
  body: FinishExecutionRequest,
): Promise<ExecutionView> {
  const payload = await request(`/executions/${encodeURIComponent(executionId)}/finish`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return executionViewSchema.parse(payload);
}

export async function logExternal(body: LogExternalRequest): Promise<ExecutionView> {
  const payload = await request('/executions/external', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return executionViewSchema.parse(payload);
}
