/**
 * Cliente da página de treino do aluno. Fala só com o BFF (`/api/training/*`), que guarda a
 * sessão num cookie HttpOnly; o navegador nunca vê o token.
 */
import {
  executionViewSchema,
  shareCardOptionsSchema,
  type DailyCheckIn,
  trainingDaySchema,
  type ExecutionView,
  type FinishExecutionRequest,
  type LogExternalRequest,
  type SaveMetricsRequest,
  type SaveSetsRequest,
  type ShareCardData,
  type ShareCardLayout,
  type ShareCardOptions,
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

/** Print do relógio/app: a visão propõe as métricas e o aluno confirma. */
export async function uploadScreenshot(executionId: string, file: File): Promise<ExecutionView> {
  const form = new FormData();
  form.set('file', file, file.name);
  const payload = (await request(`/executions/${encodeURIComponent(executionId)}/screenshot`, {
    method: 'POST',
    body: form,
  })) as { view?: unknown } | null;
  return executionViewSchema.parse(payload?.view);
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

export async function saveCheckIn(body: DailyCheckIn): Promise<void> {
  await request('/check-in', { method: 'POST', body: JSON.stringify(body) });
}

export type { ShareCardOptions };

/** Modelos e números do cartão de um treino fechado. */
export async function getShareCard(executionId: string): Promise<ShareCardOptions> {
  const payload = await request(`/executions/${encodeURIComponent(executionId)}/share-card`);
  return shareCardOptionsSchema.parse(payload);
}

/** Lê o PNG do cartão; erro com status para o painel saber se vale tentar de novo. */
async function pngOf(response: Response): Promise<Blob> {
  if (!response.ok) {
    throw new TrainingApiError(response.status, 'Não foi possível carregar a imagem do treino.');
  }
  const blob = await response.blob();
  if (blob.size === 0 || !blob.type.startsWith('image/png')) {
    throw new TrainingApiError(502, 'A imagem do treino veio vazia.');
  }
  return blob;
}

/** O PNG do cartão (1080×1920, fundo transparente) no modelo escolhido. Desenhado no servidor. */
export async function getShareCardImage(
  executionId: string,
  layout: ShareCardLayout,
  signal?: AbortSignal,
): Promise<Blob> {
  const query = new URLSearchParams({ layout });
  return pngOf(
    await fetch(
      `/api/training/executions/${encodeURIComponent(executionId)}/share-card/image?${query}`,
      { credentials: 'same-origin', signal },
    ),
  );
}

/** Cartão a partir de dados de exemplo, sem treino gravado (só a demonstração local). */
export async function previewShareCardImage(
  data: ShareCardData,
  layout: ShareCardLayout,
  signal?: AbortSignal,
): Promise<Blob> {
  return pngOf(
    await fetch('/api/training/share-card/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, layout }),
      credentials: 'same-origin',
      signal,
    }),
  );
}
