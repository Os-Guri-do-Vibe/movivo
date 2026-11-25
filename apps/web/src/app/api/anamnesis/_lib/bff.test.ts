/**
 * BFF da anamnese: o token fica no cookie httpOnly e nunca volta ao navegador; a aba só
 * conhece a referência da sessão. As escritas conferem origem e referência, e a API
 * recebe o IP e o user-agent do visitante (rate limit e evidência de consentimento).
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jar = vi.hoisted(() => {
  process.env.MOVIVO_API_URL = 'http://api.test/api/v1';
  return new Map<string, { value: string; options?: Record<string, unknown> }>();
});

vi.mock('@/lib/env', () => ({
  publicEnv: { apiUrl: 'http://api.test/api/v1', siteUrl: 'https://movivo.test' },
  secureCookies: true,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const cookie = jar.get(name);
      return cookie ? { name, value: cookie.value } : undefined;
    },
    set: (name: string, value: string, options: Record<string, unknown>) =>
      jar.set(name, { value, options }),
    delete: (arg: string | { name: string }) =>
      jar.delete(typeof arg === 'string' ? arg : arg.name),
  }),
}));

import { POST as start } from '../start/route';
import { POST as consents } from '../session/consents/route';
import { GET as session } from '../session/route';
import { DELETE as deletePhoto, PUT as putPhoto } from '../session/photo/[angle]/route';
import { PATCH as step } from '../session/step/[n]/route';

import { sessionRef } from './bff';

const ORIGIN = 'http://app.test';
const TOKEN = 'a'.repeat(64);
const COOKIE = 'movivo_anamnesis_session';
const SESSION = { status: 'IN_PROGRESS', currentStep: 1 };

function request(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: init.headers,
    body: init.body,
  });
}

function writeHeaders(extra: Record<string, string> = {}) {
  return { origin: ORIGIN, 'sec-fetch-site': 'same-origin', ...extra };
}

function photoParams(angle: string) {
  return { params: Promise.resolve({ angle }) };
}

function stepParams(n: string) {
  return { params: Promise.resolve({ n }) };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  jar.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/anamnesis/start', () => {
  it('guarda o token em cookie httpOnly e devolve só referência + estado', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ token: TOKEN, expiresAt: 'x', currentStep: 1 }))
      .mockResolvedValueOnce(Response.json(SESSION));

    const response = await start(
      request('/api/anamnesis/start', {
        method: 'POST',
        headers: writeHeaders({ 'x-real-ip': '203.0.113.7', 'user-agent': 'Navegador/1.0' }),
        body: JSON.stringify({ planId: 'ANNUAL', attribution: {} }),
      }),
    );

    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ref: sessionRef(TOKEN), session: SESSION });
    expect(text).not.toContain(TOKEN);

    expect(jar.get(COOKIE)).toEqual({
      value: TOKEN,
      options: expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/api/anamnesis',
      }),
    });
    expect(jar.get(COOKIE)?.options).not.toHaveProperty('maxAge');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.test/api/v1/anamnesis/start');
    expect(init.body).toBe(JSON.stringify({ planId: 'ANNUAL', attribution: {} }));
    const headers = new Headers(init.headers);
    expect(headers.get('X-Forwarded-For')).toBe('203.0.113.7');
    expect(headers.get('User-Agent')).toBe('Navegador/1.0');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`http://api.test/api/v1/anamnesis/session/${TOKEN}`);
  });

  it('aceita a origem pública do site quando o Next vê a URL interna (produção atrás do Nginx)', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ token: TOKEN }))
      .mockResolvedValueOnce(Response.json(SESSION));
    const response = await start(
      new NextRequest('https://localhost:3000/api/anamnesis/start', {
        method: 'POST',
        headers: { origin: 'https://movivo.test', 'sec-fetch-site': 'same-origin' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(200);
    expect(jar.get(COOKIE)?.value).toBe(TOKEN);
  });

  it('recusa origem cruzada sem chamar a API', async () => {
    const response = await start(
      request('/api/anamnesis/start', {
        method: 'POST',
        headers: { origin: 'https://evil.test' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jar.has(COOKIE)).toBe(false);
  });
});

describe('GET /api/anamnesis/session', () => {
  it('sem cookie: 404 sem chamar a API', async () => {
    const response = await session(request('/api/anamnesis/session'));
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('token recusado pela API sai do cookie', async () => {
    jar.set(COOKIE, { value: TOKEN });
    fetchMock.mockResolvedValue(Response.json({ message: 'não encontrada' }, { status: 404 }));
    const response = await session(request('/api/anamnesis/session'));
    expect(response.status).toBe(404);
    expect(jar.has(COOKIE)).toBe(false);
  });

  it('retoma a sessão do cookie com a referência', async () => {
    jar.set(COOKIE, { value: TOKEN });
    fetchMock.mockResolvedValue(Response.json({ ...SESSION, currentStep: 2 }));
    const response = await session(request('/api/anamnesis/session'));
    expect(await response.json()).toEqual({
      ref: sessionRef(TOKEN),
      session: { ...SESSION, currentStep: 2 },
    });
  });
});

describe('escritas na sessão', () => {
  it('referência de outra sessão (cookie trocado por outra aba): 412 sem gravar nada', async () => {
    jar.set(COOKIE, { value: TOKEN });
    const response = await step(
      request('/api/anamnesis/session/step/2', {
        method: 'PATCH',
        headers: writeHeaders({ 'x-anamnesis-ref': sessionRef('b'.repeat(64)) }),
        body: '{}',
      }),
      stepParams('2'),
    );
    expect(response.status).toBe(412);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('encaminha a etapa para a sessão do cookie', async () => {
    jar.set(COOKIE, { value: TOKEN });
    fetchMock.mockResolvedValue(Response.json({ currentStep: 3 }));
    const response = await step(
      request('/api/anamnesis/session/step/2', {
        method: 'PATCH',
        headers: writeHeaders({ 'x-anamnesis-ref': sessionRef(TOKEN) }),
        body: '{"anamnesis":{}}',
      }),
      stepParams('2'),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/api/v1/anamnesis/session/${TOKEN}/step/2`);
    expect(init).toMatchObject({ method: 'PATCH', body: '{"anamnesis":{}}' });
  });

  it('etapa fora de 1–3 não chega à API', async () => {
    jar.set(COOKIE, { value: TOKEN });
    const response = await step(
      request('/api/anamnesis/session/step/..', {
        method: 'PATCH',
        headers: writeHeaders({ 'x-anamnesis-ref': sessionRef(TOKEN) }),
        body: '{}',
      }),
      stepParams('..'),
    );
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consentimento: 204 da API passa adiante, com IP e user-agent do visitante', async () => {
    jar.set(COOKIE, { value: TOKEN });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await consents(
      request('/api/anamnesis/session/consents', {
        method: 'POST',
        headers: writeHeaders({
          'x-anamnesis-ref': sessionRef(TOKEN),
          'x-real-ip': '198.51.100.4',
          'user-agent': 'Navegador/2.0',
        }),
        body: '{"consents":[]}',
      }),
    );
    expect(response.status).toBe(204);
    const headers = new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('X-Forwarded-For')).toBe('198.51.100.4');
    expect(headers.get('User-Agent')).toBe('Navegador/2.0');
  });
});

describe('fotos do corpo', () => {
  const headers = () =>
    writeHeaders({ 'x-anamnesis-ref': sessionRef(TOKEN), 'content-type': 'image/jpeg' });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  function photoRequest(
    method: 'PUT' | 'DELETE',
    angle: string,
    extra: Record<string, string> = {},
  ) {
    return new NextRequest(`${ORIGIN}/api/anamnesis/session/photo/${angle}`, {
      method,
      headers: { ...headers(), ...extra },
      body: method === 'PUT' ? jpeg : undefined,
    });
  }

  it('encaminha os bytes da imagem para a posição, com o tipo declarado', async () => {
    jar.set(COOKIE, { value: TOKEN });
    fetchMock.mockResolvedValue(Response.json({ angle: 'FRONT' }));
    const response = await putPhoto(photoRequest('PUT', 'FRONT'), photoParams('FRONT'));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/api/v1/anamnesis/session/${TOKEN}/photo/FRONT`);
    expect(init.method).toBe('PUT');
    expect(new Headers(init.headers).get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(jpeg);
  });

  it('apaga a foto da posição', async () => {
    jar.set(COOKIE, { value: TOKEN });
    fetchMock.mockResolvedValue(Response.json({ angle: 'LEFT' }));
    const response = await deletePhoto(photoRequest('DELETE', 'LEFT'), photoParams('LEFT'));
    expect(response.status).toBe(200);
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('posição inexistente, tipo que não é imagem e aba trocada nunca chegam à API', async () => {
    jar.set(COOKIE, { value: TOKEN });
    expect((await putPhoto(photoRequest('PUT', 'TOP'), photoParams('TOP'))).status).toBe(404);
    expect(
      (
        await putPhoto(
          photoRequest('PUT', 'BACK', { 'content-type': 'application/pdf' }),
          photoParams('BACK'),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await putPhoto(
          photoRequest('PUT', 'BACK', { 'x-anamnesis-ref': sessionRef('b'.repeat(64)) }),
          photoParams('BACK'),
        )
      ).status,
    ).toBe(412);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recusa origem cruzada', async () => {
    jar.set(COOKIE, { value: TOKEN });
    const response = await putPhoto(
      photoRequest('PUT', 'BACK', { origin: 'https://evil.test' }),
      photoParams('BACK'),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tamanho declarado acima do teto é recusado antes de ler o corpo', async () => {
    jar.set(COOKIE, { value: TOKEN });
    const response = await putPhoto(
      photoRequest('PUT', 'FRONT', { 'content-length': String(7 * 1024 * 1024) }),
      photoParams('FRONT'),
    );
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('robustez e logs', () => {
  const stepRequest = (body: string) =>
    request('/api/anamnesis/session/step/2', {
      method: 'PATCH',
      headers: writeHeaders({ 'x-anamnesis-ref': sessionRef(TOKEN) }),
      body,
    });

  it('corpo de etapa acima de 64 KB não chega à API', async () => {
    jar.set(COOKIE, { value: TOKEN });
    const response = await step(stepRequest('x'.repeat(65 * 1024)), stepParams('2'));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('erro interno da API vira mensagem genérica e o log não leva token nem detalhe', async () => {
    jar.set(COOKIE, { value: TOKEN });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(Response.json({ message: 'stack: db failed' }, { status: 500 }));
    const response = await step(stepRequest('{}'), stepParams('2'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'Não foi possível concluir agora.' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    expect(log).toHaveBeenCalledWith('anamnesis_upstream_failed', { route: 'step/2', status: 500 });
    log.mockRestore();
  });

  it('API fora do ar responde 502 em PT-BR e registra só a rota lógica', async () => {
    jar.set(COOKIE, { value: TOKEN });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(
      new TypeError(`fetch failed http://api.test/anamnesis/session/${TOKEN}/step/2`),
    );
    const response = await step(stepRequest('{}'), stepParams('2'));
    expect(response.status).toBe(502);
    expect((await response.json()).message).toMatch(/Tente de novo/);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });
});
