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
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Sessão PAR-Q inválida.');
    const body = await request.json().catch(() => null);
    const decision = isRecord(body) && typeof body.decision === 'string' ? body.decision : '';
    const notes = isRecord(body) && typeof body.notes === 'string' ? body.notes.trim() : '';
    if (
      decision !== 'RELEASED' ||
      body?.confirmation !== true ||
      notes.length < 5 ||
      notes.length > 1000
    ) {
      throw new BffError(400, 'Revise a decisão e a confirmação da liberação.');
    }
    const response = await authenticatedBackendFetch(`/professional/dashboard/parq/${id}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'RELEASED', notes, confirmation: true }),
    });
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
