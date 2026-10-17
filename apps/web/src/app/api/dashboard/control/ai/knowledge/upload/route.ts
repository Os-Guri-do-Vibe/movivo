import { MAX_KNOWLEDGE_DOCUMENT_BYTES } from '@movivo/shared';
import { NextResponse, type NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../../_lib/bff';

/**
 * Upload de artigo científico (multipart). Mesmo teto da API (`MAX_KNOWLEDGE_DOCUMENT_BYTES`):
 * serve só para recusar cedo, antes de bufferizar o corpo inteiro. O limite de verdade
 * (configurável) e a validação de formato continuam na API.
 */
const MAX_MULTIPART_BYTES = MAX_KNOWLEDGE_DOCUMENT_BYTES + 64 * 1024;
const TOO_LARGE = 'O arquivo excede o tamanho máximo permitido.';
const OPTIONAL_FIELDS = ['title', 'author', 'sourceUrl'] as const;

export async function POST(request: NextRequest) {
  try {
    assertTrustedMutation(request);

    const advertised = Number(request.headers.get('content-length'));
    if (Number.isFinite(advertised) && advertised > MAX_MULTIPART_BYTES) {
      throw new BffError(413, TOO_LARGE);
    }

    const reader = request.body?.getReader();
    if (!reader) throw new BffError(400, 'Envie um arquivo.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_MULTIPART_BYTES) throw new BffError(413, TOO_LARGE);
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
    const file = incoming?.get('file');
    if (!incoming || !file || typeof file === 'string')
      throw new BffError(400, 'Envie um arquivo.');
    if (file.size > MAX_KNOWLEDGE_DOCUMENT_BYTES) throw new BffError(413, TOO_LARGE);

    const outgoing = new FormData();
    outgoing.set('file', new Blob([await file.arrayBuffer()], { type: file.type }), file.name);
    for (const field of OPTIONAL_FIELDS) {
      const value = incoming.get(field);
      if (typeof value === 'string' && value.trim() !== '') outgoing.set(field, value);
    }

    // Sem `Content-Type` manual: o `fetch` monta o boundary do multipart sozinho.
    const response = await authenticatedBackendFetch('/control-center/ai/knowledge/upload', {
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
