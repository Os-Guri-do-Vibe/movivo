import type { NextRequest } from 'next/server';

import { failure, startSession } from '../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    return await startSession(request);
  } catch (error) {
    return failure(error);
  }
}
