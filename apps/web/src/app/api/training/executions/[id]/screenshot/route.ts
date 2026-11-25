import type { NextRequest } from 'next/server';

import { assertSameOrigin, failure, forward, trainingBackendFetch } from '../../../_lib/bff';

const MAX_BYTES = 6 * 1024 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
      return failure(new Error('Envie uma imagem de até 6 MB.'));
    }
    const form = new FormData();
    form.set('file', file, file.name);
    return forward(
      await trainingBackendFetch(`/training/executions/${encodeURIComponent(id)}/screenshot`, {
        method: 'POST',
        body: form,
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
