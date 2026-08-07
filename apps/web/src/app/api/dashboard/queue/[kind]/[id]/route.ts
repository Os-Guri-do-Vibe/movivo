import { uuidSchema } from '@movivo/shared';

import {
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../_lib/bff';

const KINDS = new Set(['PROTOCOL', 'HANDOFF', 'PARQ', 'CHECKIN']);

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
