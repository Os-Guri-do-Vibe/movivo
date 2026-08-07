import {
  authenticatedBackendFetch,
  DASHBOARD_PRIVATE_HEADERS,
  errorResponse,
  forwardBackendJson,
} from '../../_lib/bff';

export async function GET() {
  try {
    const response = await authenticatedBackendFetch('/professional/dashboard/queue/events', {
      headers: { Accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) return forwardBackendJson(response);

    return new Response(response.body, {
      headers: {
        ...DASHBOARD_PRIVATE_HEADERS,
        'Cache-Control': 'private, no-store, no-cache, max-age=0, no-transform',
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';
