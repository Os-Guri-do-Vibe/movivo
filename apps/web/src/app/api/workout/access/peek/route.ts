import 'server-only';

import type { NextRequest } from 'next/server';

import { publicEnv } from '@/lib/env';

const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token') ?? '';
  if (token.length < 40 || token.length > 100) return Response.json({ firstName: null });
  try {
    const response = await fetch(`${API_BASE}/workouts/access/peek?token=${token}`, {
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => null)) as { firstName?: unknown } | null;
    const firstName = typeof payload?.firstName === 'string' ? payload.firstName : null;
    return Response.json(
      { firstName },
      {
        headers: {
          'Cache-Control': 'private, no-store, max-age=0',
          'Referrer-Policy': 'no-referrer',
        },
      },
    );
  } catch {
    return Response.json({ firstName: null });
  }
}
