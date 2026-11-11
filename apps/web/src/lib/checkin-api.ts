/** Cliente do check-in e da evolução. Fala só com o BFF (`/api/training/*`). */
import {
  checkInQuestionSchema,
  type CheckInAnswers,
  type CheckInQuestion,
  type MeasurementInput,
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

export interface CurrentCheckIn {
  id: string;
  questions: CheckInQuestion[];
}

/** `null` quando não há check-in aberto. */
export async function getCurrentCheckIn(): Promise<CurrentCheckIn | null> {
  try {
    const payload = (await request('/check-ins/current')) as { id: string; questions: unknown[] };
    return { id: payload.id, questions: checkInQuestionSchema.array().parse(payload.questions) };
  } catch (caught) {
    if (caught instanceof TrainingApiError && caught.status === 404) return null;
    throw caught;
  }
}

export async function answerCheckIn(id: string, answers: CheckInAnswers): Promise<void> {
  await request(`/check-ins/${encodeURIComponent(id)}/answers`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export interface EvolutionView {
  firstName: string | null;
  strategyTitle: string | null;
  milestones: { milestone: { description: string }; dueOn: string; status: string }[];
  tasks: { title: string; target: number; progress: number; windowEnd: string; status: string }[];
  measurements: Record<string, { on: string; value: number }[]>;
  weeks: { weekStart: string; sessions: number; load: number }[];
}

export async function getEvolution(): Promise<EvolutionView> {
  return (await request('/evolution')) as EvolutionView;
}

export async function addMeasurements(measurements: MeasurementInput[]): Promise<void> {
  await request('/evolution/measurements', {
    method: 'POST',
    body: JSON.stringify({ measurements }),
  });
}
