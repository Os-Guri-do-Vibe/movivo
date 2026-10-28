/** Cliente do registro alimentar. Fala só com o BFF (`/api/training/nutrition/*`). */
import {
  foodDaySchema,
  foodLogDraftSchema,
  foodSearchResultSchema,
  type ConfirmFoodLogRequest,
  type FoodDay,
  type FoodLogDraft,
  type FoodSearchResult,
  type InterpretFoodTextRequest,
  type ManualFoodLogRequest,
  type MealSlot,
} from '@movivo/shared';
import { TrainingApiError } from './training-api';

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api/training/nutrition${path}`, {
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

export async function getFoodDay(date?: string): Promise<FoodDay> {
  return foodDaySchema.parse(
    await request(`/day${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  );
}

export async function draftFromText(body: InterpretFoodTextRequest): Promise<FoodLogDraft> {
  return foodLogDraftSchema.parse(
    await request('/logs/text', { method: 'POST', body: JSON.stringify(body) }),
  );
}

export async function draftFromPhoto(file: File, meal?: MealSlot): Promise<FoodLogDraft> {
  const form = new FormData();
  form.set('file', file, file.name);
  if (meal) form.set('meal', meal);
  return foodLogDraftSchema.parse(await request('/logs/photo', { method: 'POST', body: form }));
}

export async function confirmFoodLog(logId: string, body: ConfirmFoodLogRequest): Promise<void> {
  await request(`/logs/${encodeURIComponent(logId)}/confirm`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function addFoodLog(body: ManualFoodLogRequest): Promise<void> {
  await request('/logs', { method: 'POST', body: JSON.stringify(body) });
}

export async function removeFoodLog(logId: string): Promise<void> {
  await request(`/logs/${encodeURIComponent(logId)}`, { method: 'DELETE' });
}

export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  return foodSearchResultSchema
    .array()
    .parse(await request(`/foods?q=${encodeURIComponent(query)}`));
}
