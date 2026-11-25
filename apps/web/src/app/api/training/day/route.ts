import type { NextRequest } from 'next/server';

import { failure, forward, trainingBackendFetch } from '../_lib/bff';

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date');
    return forward(
      await trainingBackendFetch(`/training/day${date ? `?date=${encodeURIComponent(date)}` : ''}`),
    );
  } catch (error) {
    return failure(error);
  }
}
