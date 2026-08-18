import { uuidSchema } from '@movivo/shared';

import {
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../../_lib/bff';

/**
 * Achado 2026-08-18: o olho da fila (`AnamnesisAnswersModal`) chama
 * `/api/dashboard/queue/{kind}/{id}/anamnesis`, mas essa rota nunca existiu no BFF — só
 * `queue/[kind]/[id]/route.ts` (sem `/anamnesis`) foi criada quando a feature nasceu.
 * Só PROTOCOL/PARQ têm endpoint de anamnese no backend (handoff/check-in não aparecem
 * nesta fila — ver docstring de `DashboardService.queue()`).
 */
const KINDS = new Set(['PROTOCOL', 'PARQ']);

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
    const response = await authenticatedBackendFetch(
      `/professional/dashboard/queue/${kind.toLowerCase()}/${id}/anamnesis`,
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';
