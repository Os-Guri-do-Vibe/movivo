import {
  publishExerciseCatalogEntrySchema,
  substitutionItemEditSchema,
  uuidSchema,
} from '@movivo/shared';
import type { NextRequest } from 'next/server';

import {
  assertTrustedMutation,
  authenticatedBackendFetch,
  BffError,
  errorResponse,
  forwardBackendJson,
} from '../../../../../_lib/bff';

// Mesma definição de índice de item usada nas decisões de aprovação.
const itemIndexSchema = substitutionItemEditSchema.shape.index;

/**
 * Achado 2026-09-09: única rota que publica um exercício NOVO no catálogo a partir de uma
 * proposta de substituição (item `catalogGap` — aluno pediu algo que não existe em lugar
 * nenhum da base). Achado 2026-09-30 (troca em lote): liga o exercício publicado ao ITEM
 * indicado e NÃO aprova a proposta — o profissional decide na tela única, item a item. Mesmo
 * `publishExerciseCatalogEntrySchema` que o backend usa: valida aqui pra devolver erro de
 * formato antes de bater na API, não só confiar no proxy.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; index: string }> },
) {
  try {
    assertTrustedMutation(request);
    const { id, index } = await context.params;
    if (!uuidSchema.safeParse(id).success) throw new BffError(400, 'Proposta inválida.');
    const parsedIndex = itemIndexSchema.safeParse(Number(index));
    if (!parsedIndex.success) throw new BffError(400, 'Item inválido.');

    const body = await request.json().catch(() => null);
    const parsed = publishExerciseCatalogEntrySchema.safeParse(body);
    if (!parsed.success) throw new BffError(400, 'Revise os campos do exercício.');

    const response = await authenticatedBackendFetch(
      `/professional/dashboard/substitutions/${id}/items/${parsedIndex.data}/catalog-exercise`,
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
