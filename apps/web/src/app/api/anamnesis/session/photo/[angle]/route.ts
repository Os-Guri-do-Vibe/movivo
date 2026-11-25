import type { NextRequest } from 'next/server';

import { failure, forwardSessionPhoto } from '../../../_lib/bff';

type Context = { params: Promise<{ angle: string }> };

export async function PUT(request: NextRequest, context: Context) {
  try {
    return await forwardSessionPhoto(request, (await context.params).angle, 'PUT');
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    return await forwardSessionPhoto(request, (await context.params).angle, 'DELETE');
  } catch (error) {
    return failure(error);
  }
}
