import type { NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

import { assertSameOrigin, failure, forward, TrainingBffError } from '../../_lib/bff';

const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length < 40 || body.token.length > 100) {
      throw new TrainingBffError(400, 'Link invalido.');
    }
    return forward(
      await fetch(`${API_BASE}/training/access/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: body.token }),
        cache: 'no-store',
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
