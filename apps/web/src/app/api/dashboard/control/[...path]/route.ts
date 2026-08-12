import { type NextRequest } from 'next/server';

import {
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

const SAFE_SEGMENT = /^[a-z0-9-]+$/i;

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
