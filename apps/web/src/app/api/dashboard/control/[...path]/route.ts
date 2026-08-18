import { type NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

const SAFE_SEGMENT = /^[a-z0-9-]+$/i;

/**
 * Allowlist de mutações: o proxy de leitura é genérico, o de escrita não pode ser.
 * A autorização real continua no backend (capability por rota); esta lista só evita
 * que o BFF vire um caminho universal de POST para qualquer rota do Control Center.
 */
const MUTATION_PATHS = new Set([
  'ai/persona',
  'ai/persona/rollback',
  // Painel "Sistema → Integração" (EvolutionAPI, ferramenta INTERNA de teste).
  'integration/whatsapp/instance',
]);

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
    if (!MUTATION_PATHS.has(target)) return errorResponse(new BffError(404, 'Rota inexistente.'));
    const body = await request.json().catch(() => null);
    if (body === null) return errorResponse(new BffError(400, 'Corpo inválido.'));
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
