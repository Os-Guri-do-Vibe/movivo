import { uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from './bff';

/**
 * Tela de revisão aberta (`active: true`) ou fechada (`active: false`), para protocolo e para
 * troca de exercício. POST para o `navigator.sendBeacon` conseguir soltar a trava ao fechar
 * a aba. `backendPath` é o caminho do recurso no backend, sem o id (ex.: `protocols`).
 */
export async function forwardReviewHold(
  request: NextRequest,
  rawId: string,
  resource: 'protocols' | 'substitutions',
  invalidIdMessage: string,
) {
  try {
    assertTrustedMutation(request);
    if (!uuidSchema.safeParse(rawId).success) throw new BffError(400, invalidIdMessage);

    // `sendBeacon` com Blob JSON chega como texto; o parse é explícito e estrito.
    const body = (await request.json().catch(() => null)) as { active?: unknown } | null;
    if (!body || typeof body.active !== 'boolean') throw new BffError(400, 'Corpo inválido.');

    const response = await authenticatedBackendFetch(
      `/professional/dashboard/${resource}/${rawId}/review-hold`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Só o campo conhecido segue para o backend.
        body: JSON.stringify({ active: body.active }),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
