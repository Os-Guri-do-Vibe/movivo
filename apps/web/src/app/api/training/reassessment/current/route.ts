import { failure, forward, trainingBackendFetch } from '../../_lib/bff';

export async function GET() {
  try {
    return forward(await trainingBackendFetch('/reassessment/current'));
  } catch (error) {
    return failure(error);
  }
}
