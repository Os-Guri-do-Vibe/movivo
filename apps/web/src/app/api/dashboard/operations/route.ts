import { authenticatedBackendFetch, errorResponse, forwardBackendJson } from '../_lib/bff';

export async function GET() {
  try {
    const response = await authenticatedBackendFetch('/professional/dashboard/operations');
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';
