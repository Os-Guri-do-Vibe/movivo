import { failure, forward, trainingBackendFetch } from '../../../_lib/bff';

/** Modelos e números do cartão de compartilhamento de um treino fechado. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return forward(
      await trainingBackendFetch(`/training/executions/${encodeURIComponent(id)}/share-card`),
    );
  } catch (error) {
    return failure(error);
  }
}
