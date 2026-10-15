import { uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

/**
 * Autocomplete do exercício no editor de protocolo (fila de revisão e detalhe do aluno). Só
 * repassa a busca: quem decide o que é exercício oficial é o catálogo publicado no backend.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (q.length < 1 || q.length > 80) throw new BffError(400, 'Digite o nome do exercício.');
    const params = new URLSearchParams({ q });
    const protocolId = request.nextUrl.searchParams.get('protocolId');
    if (protocolId) {
      if (!uuidSchema.safeParse(protocolId).success) throw new BffError(400, 'Protocolo inválido.');
      params.set('protocolId', protocolId);
    }
    const response = await authenticatedBackendFetch(
      `/professional/dashboard/exercise-catalog/search?${params.toString()}`,
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';
