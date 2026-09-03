import type { NextRequest } from 'next/server';

import { failure, forward, workoutBackendFetch } from '../_lib/bff';

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date');
    return forward(
      await workoutBackendFetch(
        `/workouts/journal${date ? `?date=${encodeURIComponent(date)}` : ''}`,
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
