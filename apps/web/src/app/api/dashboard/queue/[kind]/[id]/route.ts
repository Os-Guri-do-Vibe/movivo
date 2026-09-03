import { uuidSchema } from '@movivo/shared';

import {
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../_lib/bff';

/**
 * Espelha `kindSchema` do backend — `PARQ` saiu do enum em 2026-08-24. `SUBSTITUTION`
 * faltava aqui desde que a feature nasceu em 2026-09-02 (achado 2026-09-03, ao testar
 * as novas seções de fila): o card renderizava, mas "Abrir caso" sempre voltava 400 —
 * a tela de detalhe (e os botões Aprovar/Recusar dentro dela) nunca era alcançada.
 */
const KINDS = new Set(['PROTOCOL', 'HANDOFF', 'CHECKIN', 'SUBSTITUTION']);

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  try {
    const { kind: rawKind, id } = await context.params;
    const kind = rawKind.toUpperCase();
    if (!KINDS.has(kind) || !uuidSchema.safeParse(id).success) {
      throw new BffError(400, 'Item da fila inválido.');
    }
    const response = await authenticatedBackendFetch(`/professional/dashboard/queue/${kind}/${id}`);
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';
