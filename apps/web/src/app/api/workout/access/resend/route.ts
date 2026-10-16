import 'server-only';

import type { NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

import { assertSameOrigin, failure, forward, WorkoutBffError } from '../../_lib/bff';

const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length < 40 || body.token.length > 100) {
      throw new WorkoutBffError(400, 'Link invalido.');
    }
    const response = await fetch(`${API_BASE}/workouts/access/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: body.token }),
      cache: 'no-store',
    });
    return forward(response);
  } catch (error) {
    return failure(error);
  }
}
