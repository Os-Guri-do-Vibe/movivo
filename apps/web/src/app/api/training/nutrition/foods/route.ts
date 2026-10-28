import type { NextRequest } from 'next/server';

import { failure, trainingBackendFetch } from '../../_lib/bff';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q') ?? '';
    const response = await trainingBackendFetch(`/nutrition/foods?q=${encodeURIComponent(q)}`);
    const payload = await response.json().catch(() => []);
    return Response.json(payload, {
      status: response.status,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  } catch (error) {
    return failure(error);
  }
}
