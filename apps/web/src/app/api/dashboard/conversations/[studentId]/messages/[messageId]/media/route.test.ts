import { afterEach, describe, expect, it, vi } from 'vitest';

const backendFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../../../_lib/bff', () => ({
  authenticatedBackendFetch: backendFetch,
  BffError: class BffError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { GET } from './route';

const STUDENT = '11111111-1111-4111-8111-111111111111';
const MESSAGE = '22222222-2222-4222-8222-222222222222';
const params = (studentId = STUDENT, messageId = MESSAGE) => ({
  params: Promise.resolve({ studentId, messageId }),
});
const upstream = (bytes: number[], type = 'audio/ogg', status = 200) =>
  new Response(new Uint8Array(bytes), { status, headers: { 'content-type': type } });
const req = (range?: string) =>
  new Request('http://app.test', range ? { headers: { range } } : undefined);

afterEach(() => backendFetch.mockReset());

describe('GET /api/dashboard/conversations/[studentId]/messages/[messageId]/media', () => {
  it('404 sem chamar a API para ids que não são UUID', async () => {
    expect((await GET(req(), params('../x', MESSAGE))).status).toBe(404);
    expect((await GET(req(), params(STUDENT, 'nao-e-uuid'))).status).toBe(404);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it('repassa os bytes same-origin, sem cache e com nosniff', async () => {
    backendFetch.mockResolvedValue(upstream([1, 2, 3, 4], 'audio/ogg'));
    const res = await GET(req(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/ogg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(backendFetch).toHaveBeenCalledWith(
      `/control-center/conversations/${STUDENT}/messages/${MESSAGE}/media`,
      expect.anything(),
    );
  });

  it('Range: devolve 206 só com o trecho pedido (o <audio> precisa para avançar/voltar)', async () => {
    backendFetch.mockResolvedValue(upstream([10, 11, 12, 13, 14]));
    const res = await GET(req('bytes=1-2'), params());
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 1-2/5');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([11, 12]));
  });

  it('Range aberto e por sufixo', async () => {
    backendFetch.mockResolvedValue(upstream([10, 11, 12, 13, 14]));
    const open = await GET(req('bytes=3-'), params());
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(new Uint8Array([13, 14]));
    backendFetch.mockResolvedValue(upstream([10, 11, 12, 13, 14]));
    const suffix = await GET(req('bytes=-2'), params());
    expect(suffix.headers.get('content-range')).toBe('bytes 3-4/5');
  });

  it('Range fora do arquivo ou malformado → 416', async () => {
    for (const range of ['bytes=9-12', 'bytes=-', 'bytes=3-1', 'items=0-1']) {
      backendFetch.mockResolvedValue(upstream([1, 2, 3]));
      const res = await GET(req(range), params());
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe('bytes */3');
    }
  });

  it('só repassa áudio/imagem — qualquer outro tipo vira 404', async () => {
    for (const type of ['text/html', 'application/pdf', 'image/']) {
      backendFetch.mockResolvedValue(upstream([1], type));
      expect((await GET(req(), params())).status).toBe(404);
    }
  });

  it('API sem a mídia (404/409/5xx) → 404; sessão expirada propaga 401/403', async () => {
    backendFetch.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await GET(req(), params())).status).toBe(404);
    backendFetch.mockResolvedValue(new Response(null, { status: 500 }));
    expect((await GET(req(), params())).status).toBe(404);
    backendFetch.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET(req(), params())).status).toBe(401);
    backendFetch.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await GET(req(), params())).status).toBe(403);
  });

  it('arquivo vazio ou acima do teto → 404', async () => {
    backendFetch.mockResolvedValue(upstream([]));
    expect((await GET(req(), params())).status).toBe(404);
    backendFetch.mockResolvedValue(
      new Response(new Uint8Array(10 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'audio/ogg' },
      }),
    );
    expect((await GET(req(), params())).status).toBe(404);
  });
});
