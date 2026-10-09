import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const backendFetch = vi.hoisted(() => vi.fn());
vi.mock('../../_lib/bff', () => ({
  assertTrustedMutation: () => undefined,
  authenticatedBackendFetch: backendFetch,
  BffError: class BffError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
  errorResponse: (error: { status?: number }) =>
    new Response(null, { status: error.status ?? 500 }),
  forwardBackendJson: (response: Response) => response,
}));

import { POST } from './route';

afterEach(() => backendFetch.mockReset());

describe('POST /api/dashboard/account/avatar', () => {
  it('encaminha multipart pequeno com boundary reconstruído', async () => {
    const body = new FormData();
    body.set(
      'avatar',
      new File([new Uint8Array([137, 80, 78, 71])], 'foto.png', { type: 'image/png' }),
    );
    backendFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await POST(
      new NextRequest('http://app.test/api/dashboard/account/avatar', { method: 'POST', body }),
    );

    expect(response.status).toBe(200);
    expect(backendFetch).toHaveBeenCalledWith(
      '/account/avatar',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
  });

  it('limita multipart sem Content-Length antes de chamar a API', async () => {
    const body = new FormData();
    body.set(
      'avatar',
      new File([new Uint8Array(5 * 1024 * 1024 + 128 * 1024)], 'foto.png', { type: 'image/png' }),
    );
    const request = new NextRequest('http://app.test/api/dashboard/account/avatar', {
      method: 'POST',
      body,
    });
    request.headers.delete('content-length');

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
