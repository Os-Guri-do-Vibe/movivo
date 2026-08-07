import { uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../_lib/bff';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Handoff inválido.');
    const body = await request.json().catch(() => null);
    const resolution =
      isRecord(body) && typeof body.resolution === 'string' ? body.resolution.trim() : '';
    const notes = isRecord(body) && typeof body.notes === 'string' ? body.notes.trim() : '';
    if (
      body?.confirmation !== true ||
      resolution.length < 3 ||
      resolution.length > 80 ||
      notes.length < 3 ||
      notes.length > 1000
    ) {
      throw new BffError(400, 'Revise a resolução e confirme a ação.');
    }
    const response = await authenticatedBackendFetch(
      `/professional/dashboard/handoffs/${id}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, notes, confirmation: true }),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
