import type { NextRequest } from 'next/server';

import { currentSession, failure } from '../_lib/bff';

export async function GET(request: NextRequest) {
  try {
    return await currentSession(request);
  } catch (error) {
    return failure(error);
  }
}
