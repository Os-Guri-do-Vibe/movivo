import { type NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';
import { isAllowedControlMutationPath } from '../../_lib/control-mutation-path';

const SAFE_SEGMENT = /^[a-z0-9-]+$/i;
const MAX_MUTATION_BODY_BYTES = 2 * 1024 * 1024;

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const advertised = Number(request.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > MAX_MUTATION_BODY_BYTES) {
    throw new BffError(413, 'Corpo excede o limite permitido.');
  }
  const raw = await request.text();
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_MUTATION_BODY_BYTES) {
    throw new BffError(
      raw ? 413 : 400,
      raw ? 'Corpo excede o limite permitido.' : 'Corpo inválido.',
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new BffError(400, 'Corpo inválido.');
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await params;
    if (!path.length || path.some((segment) => !SAFE_SEGMENT.test(segment))) {
      return errorResponse(new BffError(400, 'Caminho inválido.'));
    }
    const query = request.nextUrl.search;
    const response = await authenticatedBackendFetch(`/control-center/${path.join('/')}${query}`);
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    assertTrustedMutation(request);
    const { path } = await params;
    const target = path.join('/');
    if (!isAllowedControlMutationPath(target)) {
      return errorResponse(new BffError(404, 'Rota inexistente.'));
    }
    const body = await readBoundedJson(request);
    const response = await authenticatedBackendFetch(`/control-center/${target}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
