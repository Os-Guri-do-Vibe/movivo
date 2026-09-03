import { NextResponse, type NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

/**
 * Mesmo teto absoluto do multer no backend (`AVATAR_UPLOAD_HARD_CEILING_BYTES`) — só
 * pra recusar cedo, antes de bufferizar o multipart inteiro na Route Handler. O limite
 * de verdade, configurável, continua sendo enforced pela API.
 */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);

    const advertised = Number(request.headers.get('content-length'));
    if (Number.isFinite(advertised) && advertised > MAX_AVATAR_BYTES) {
      throw new BffError(413, 'Arquivo excede o tamanho máximo permitido.');
    }

    const incoming = await request.formData().catch(() => null);
    const file = incoming?.get('avatar');
    if (!(file instanceof File)) throw new BffError(400, 'Envie um arquivo de imagem.');

    const outgoing = new FormData();
    outgoing.set('avatar', file, file.name);

    // Sem `Content-Type` manual: o `fetch` monta o boundary do multipart sozinho.
    const response = await authenticatedBackendFetch('/account/avatar', {
      method: 'POST',
      body: outgoing,
    });
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 405 });
}
