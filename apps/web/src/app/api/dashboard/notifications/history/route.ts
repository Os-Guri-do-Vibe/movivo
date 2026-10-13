import type { NextRequest } from 'next/server';

import { authenticatedBackendFetch, errorResponse, forwardBackendJson } from '../../_lib/bff';

const STATES = new Set(['all', 'unread']);
const TYPES = new Set(['all', 'alert', 'queue']);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const params = new URLSearchParams();
    const state = searchParams.get('state');
    const type = searchParams.get('type');
    const cursor = searchParams.get('cursor');
    if (state && STATES.has(state)) params.set('state', state);
    if (type && TYPES.has(type)) params.set('type', type);
    // O cursor é opaco; o backend o valida. Aqui só se limita o tamanho.
    if (cursor && cursor.length <= 300) params.set('cursor', cursor);
    const response = await authenticatedBackendFetch(
      `/professional/dashboard/notifications/history?${params}`,
    );
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}
