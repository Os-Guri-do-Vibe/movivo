import type { NextRequest } from 'next/server';

import { failure, forwardSessionAction } from '../../../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    return await forwardSessionAction(request, 'phone/verify', 'POST');
  } catch (error) {
    return failure(error);
  }
}
