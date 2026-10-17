import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const backendFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../../_lib/bff', () => ({
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

const URL = 'http://app.test/api/dashboard/control/ai/knowledge/upload';

describe('POST /api/dashboard/control/ai/knowledge/upload', () => {
  it('encaminha o artigo como multipart, só com os campos conhecidos', async () => {
    const body = new FormData();
    body.set('file', new File(['%PDF-1.7 conteudo'], 'estudo.pdf', { type: 'application/pdf' }));
    body.set('title', 'Meu estudo');
    body.set('author', '');
    body.set('role', 'ADMIN');
    backendFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await POST(new NextRequest(URL, { method: 'POST', body }));

    expect(response.status).toBe(200);
    expect(backendFetch).toHaveBeenCalledWith(
      '/control-center/ai/knowledge/upload',
      expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
    );
    const sent = (backendFetch.mock.calls[0]?.[1] as { body: FormData }).body;
    expect(sent.get('title')).toBe('Meu estudo');
    expect(sent.has('author')).toBe(false);
    expect(sent.has('role')).toBe(false);
    // O nome do arquivo (extensão) é o que a API valida; o jsdom perde o nome no parse do
    // multipart, então aqui só confirmamos que o arquivo segue junto. No Node real o nome é
    // preservado (conferido à mão).
    expect(sent.get('file')).toBeInstanceOf(Blob);
  });

  it('recusa requisição sem arquivo antes de chamar a API', async () => {
    const body = new FormData();
    body.set('title', 'sem arquivo');
    const response = await POST(new NextRequest(URL, { method: 'POST', body }));
    expect(response.status).toBe(400);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it('limita o multipart sem Content-Length antes de chamar a API', async () => {
    const body = new FormData();
    body.set('file', new File([new Uint8Array(10 * 1024 * 1024 + 128 * 1024)], 'enorme.pdf'));
    const request = new NextRequest(URL, { method: 'POST', body });
    request.headers.delete('content-length');

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
