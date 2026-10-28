import type { NextRequest } from 'next/server';

import { failure, resumeSession } from '../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    return await resumeSession(request);
  } catch (error) {
    return failure(error);
  }
}
