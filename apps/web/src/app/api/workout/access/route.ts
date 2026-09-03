import type { NextRequest } from 'next/server';

import { assertSameOrigin, exchangeMagicToken, failure, WorkoutBffError } from '../_lib/bff';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { token?: unknown };
    if (typeof body.token !== 'string' || body.token.length < 40 || body.token.length > 100) {
      throw new WorkoutBffError(400, 'Link invalido.');
    }
    const token = body.token;
    await exchangeMagicToken(token);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
