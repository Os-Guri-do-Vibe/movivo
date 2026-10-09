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
const MAX_MULTIPART_BYTES = MAX_AVATAR_BYTES + 64 * 1024;

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);

    const advertised = Number(request.headers.get('content-length'));
    if (Number.isFinite(advertised) && advertised > MAX_MULTIPART_BYTES) {
      throw new BffError(413, 'Arquivo excede o tamanho máximo permitido.');
    }

    const reader = request.body?.getReader();
    if (!reader) throw new BffError(400, 'Envie um arquivo de imagem.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_MULTIPART_BYTES)
          throw new BffError(413, 'Arquivo excede o tamanho máximo permitido.');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    const boundedRequest = new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
      body: new Blob(chunks.map((chunk) => Uint8Array.from(chunk))),
    });
    const incoming = await boundedRequest.formData().catch(() => null);
    const file = incoming?.get('avatar');
    if (!file || typeof file === 'string') throw new BffError(400, 'Envie um arquivo de imagem.');
    if (file.size > MAX_AVATAR_BYTES)
      throw new BffError(413, 'Arquivo excede o tamanho máximo permitido.');

    const outgoing = new FormData();
    outgoing.set('avatar', new Blob([await file.arrayBuffer()], { type: file.type }), file.name);

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
