import { NextResponse } from 'next/server';

import { authenticatedBackendFetch, errorResponse, forwardBackendJson } from '../_lib/bff';

export async function GET() {
  try {
    const response = await authenticatedBackendFetch('/professional/dashboard/queue');
    return forwardBackendJson(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export function OPTIONS() {
  return new NextResponse(null, { status: 405 });
}
