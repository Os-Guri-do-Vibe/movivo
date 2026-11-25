import { NextResponse, type NextRequest } from 'next/server';

import { shareCardPreviewSchema } from '@movivo/shared';

import {
  assertSameOrigin,
  failure,
  forwardImage,
  trainingPublicFetch,
  TrainingBffError,
} from '../../_lib/bff';
import { studentDemoEnabled } from '@/lib/student-demo';

/**
 * Cartão a partir de dados de exemplo, para a página de demonstração do diário. Fora do
 * ambiente local a rota não existe (404), como a própria página.
 */
export async function POST(request: NextRequest) {
  if (!studentDemoEnabled()) return new NextResponse(null, { status: 404 });
  try {
    assertSameOrigin(request);
    const parsed = shareCardPreviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new TrainingBffError(400, 'Dados do cartão inválidos.');
    return forwardImage(
      await trainingPublicFetch('/training/share-card/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      }),
    );
  } catch (error) {
    return failure(error);
  }
}
