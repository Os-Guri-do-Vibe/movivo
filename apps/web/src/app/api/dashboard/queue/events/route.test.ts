import { beforeEach, describe, expect, it, vi } from 'vitest';

const bff = vi.hoisted(() => ({
  authenticatedBackendFetch: vi.fn(),
  errorResponse: vi.fn(),
  forwardBackendJson: vi.fn(),
}));

vi.mock('../../_lib/bff', () => ({
  ...bff,
  DASHBOARD_PRIVATE_HEADERS: {
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
  },
}));

import { GET } from './route';

beforeEach(() => Object.values(bff).forEach((mock) => mock.mockReset()));

describe('GET /api/dashboard/queue/events', () => {
  it('encaminha SSE sem cache/buffering e propaga cancelamento ao upstream', async () => {
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    bff.authenticatedBackendFetch.mockResolvedValue(
      new Response(upstream, { headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const response = await GET();

    expect(bff.authenticatedBackendFetch).toHaveBeenCalledWith(
      '/professional/dashboard/queue/events',
      { headers: { Accept: 'text/event-stream' } },
    );
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Cache-Control')).toContain('no-transform');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');

    await response.body?.cancel();
    expect(cancelled).toBe(true);
  });

  it.each([401, 403])('não abre stream quando o backend devolve %s', async (status) => {
    const upstream = new Response(JSON.stringify({ message: 'Sessão inválida.' }), { status });
    const forwarded = new Response(null, { status });
    bff.authenticatedBackendFetch.mockResolvedValue(upstream);
    bff.forwardBackendJson.mockResolvedValue(forwarded);

    await expect(GET()).resolves.toBe(forwarded);
    expect(bff.forwardBackendJson).toHaveBeenCalledWith(upstream);
  });
});
