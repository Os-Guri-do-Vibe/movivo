/** Cliente da reavaliação de ciclo. Fala só com o BFF (`/api/training/*`). */
import {
  cycleReassessmentViewSchema,
  type CycleReassessmentAnswers,
  type CycleReassessmentView,
} from '@movivo/shared';

import { TrainingApiError } from './training-api';

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
  if (response.status === 204) return null;
  const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
  if (!response.ok) {
    throw new TrainingApiError(
      response.status,
      typeof payload?.message === 'string' ? payload.message : 'Não foi possível concluir.',
    );
  }
  return payload;
}

/** `null` quando o aluno ainda não tem reavaliação de ciclo. */
export async function getReassessment(): Promise<CycleReassessmentView | null> {
  try {
    return cycleReassessmentViewSchema.parse(await request('/reassessment/current'));
  } catch (caught) {
    if (caught instanceof TrainingApiError && caught.status === 404) return null;
    throw caught;
  }
}

export type ReassessmentAngle = 'FRONT' | 'RIGHT' | 'BACK' | 'LEFT';

export async function uploadReassessmentPhoto(
  id: string,
  angle: ReassessmentAngle,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.set('file', file, file.name);
  await request(`/reassessment/${encodeURIComponent(id)}/photos/${angle}`, {
    method: 'PUT',
    body: form,
  });
}

export async function deleteReassessmentPhoto(id: string, angle: ReassessmentAngle): Promise<void> {
  await request(`/reassessment/${encodeURIComponent(id)}/photos/${angle}`, { method: 'DELETE' });
}

export async function submitReassessment(
  id: string,
  answers: CycleReassessmentAnswers,
): Promise<void> {
  await request(`/reassessment/${encodeURIComponent(id)}/answers`, {
    method: 'POST',
    body: JSON.stringify(answers),
  });
}
