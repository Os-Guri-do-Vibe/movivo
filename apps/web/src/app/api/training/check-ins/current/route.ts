import { failure, forward, trainingBackendFetch } from '../../_lib/bff';

export async function GET() {
  try {
    return forward(await trainingBackendFetch('/check-ins/current'));
  } catch (error) {
    return failure(error);
  }
}
