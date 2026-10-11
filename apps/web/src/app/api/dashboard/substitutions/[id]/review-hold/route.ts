import type { NextRequest } from 'next/server';

import { forwardReviewHold } from '../../../_lib/review-hold';

/** Tela de revisão da troca de exercício aberta ou fechada (trava do envio automático). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return forwardReviewHold(request, id, 'substitutions', 'Proposta inválida.');
}
