import type { NextRequest } from 'next/server';

import { assertSameOrigin, failure, forward, trainingBackendFetch } from '../../../../_lib/bff';

const MAX_BYTES = 5 * 1024 * 1024;
const ANGLES = new Set(['FRONT', 'RIGHT', 'BACK', 'LEFT']);

type Context = { params: Promise<{ id: string; angle: string }> };

export async function PUT(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const { id, angle } = await context.params;
    if (!ANGLES.has(angle)) return failure(new Error('Posição inválida.'));
    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
      return failure(new Error('Envie uma imagem de até 5 MB.'));
    }
    const form = new FormData();
    form.set('file', file, file.name);
    return forward(
      await trainingBackendFetch(
        `/reassessment/${encodeURIComponent(id)}/photos/${encodeURIComponent(angle)}`,
        { method: 'PUT', body: form },
      ),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const { id, angle } = await context.params;
    if (!ANGLES.has(angle)) return failure(new Error('Posição inválida.'));
    return forward(
      await trainingBackendFetch(
        `/reassessment/${encodeURIComponent(id)}/photos/${encodeURIComponent(angle)}`,
        { method: 'DELETE' },
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
