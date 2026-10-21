import { uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../_lib/bff';

/** "Gerar protocolo novamente": só o campo de confirmação conhecido segue para o backend. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Protocolo inválido.');
    const body = (await request.json().catch(() => ({}))) as {
      confirmOverwriteEdit?: unknown;
    } | null;
    const confirmOverwriteEdit = body?.confirmOverwriteEdit;
    if (confirmOverwriteEdit !== undefined && confirmOverwriteEdit !== true) {
      throw new BffError(400, 'Corpo inválido.');
    }
    const response = await authenticatedBackendFetch(
      `/professional/dashboard/protocols/${id}/regenerate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmOverwriteEdit ? { confirmOverwriteEdit: true } : {}),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
