import { publishExerciseCatalogEntrySchema, uuidSchema } from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../_lib/bff';

/**
 * Achado 2026-09-09: única rota que publica um exercício NOVO no catálogo E aprova a
 * substituição no mesmo gesto (proposta `catalogGap` — aluno pediu algo que não existe em
 * lugar nenhum da base). Mesmo `publishExerciseCatalogEntrySchema` que o backend usa —
 * valida aqui pra devolver erro de formato antes de bater na API, não só confiar no proxy.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Proposta inválida.');

    const body = await request.json().catch(() => null);
    const parsed = publishExerciseCatalogEntrySchema.safeParse(body);
    if (!parsed.success) throw new BffError(400, 'Revise os campos do exercício.');

    const response = await authenticatedBackendFetch(
      `/professional/dashboard/substitutions/${id}/add-and-approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      },
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
