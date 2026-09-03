/**
 * Testes do cliente HTTP da conta do dashboard (`account-api.ts`): parse defensivo do
 * perfil, e os quatro caminhos de request (perfil, atualização, senha, avatar) nos seus
 * ramos de sucesso e erro. `fetch` é mockado — o contrato do backend é exercitado no E2E.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  changeAccountPassword,
  getAccountProfile,
  updateAccountProfile,
  uploadAccountAvatar,
} from './account-api';
import { DashboardApiError } from './dashboard-api';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function emptyResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => '' } as Response;
}

const profileBody = {
  name: 'Rodrigo Barros',
  email: 'rodrigo@example.com',
  phoneNumber: '+5511999999999',
  avatarUrl: null,
  role: 'ADMIN',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAccountProfile', () => {
  it('GET no perfil e devolve os dados normalizados', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, profileBody));
    vi.stubGlobal('fetch', fetchMock);

    const profile = await getAccountProfile();

    expect(profile).toEqual({
      name: 'Rodrigo Barros',
      email: 'rodrigo@example.com',
      phoneNumber: '+5511999999999',
      avatarUrl: null,
      role: 'ADMIN',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/dashboard/account/profile');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('reescreve o avatar para a rota same-origin quando o nome de arquivo é válido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          ...profileBody,
          avatarUrl:
            'http://api.movivo.test/api/v1/account/avatar/11111111-1111-4111-8111-111111111111.png',
        }),
      ),
    );

    const profile = await getAccountProfile();

    expect(profile.avatarUrl).toBe(
      '/api/dashboard/account/avatar/11111111-1111-4111-8111-111111111111.png',
    );
  });

  it('degrada nome e email ausentes para null, preservando telefone e papel', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { phoneNumber: '+5511988887777', avatarUrl: null, role: 'SUPPORT' }),
        ),
    );

    const profile = await getAccountProfile();

    expect(profile).toEqual({
      name: null,
      email: null,
      phoneNumber: '+5511988887777',
      avatarUrl: null,
      role: 'SUPPORT',
    });
  });

  it('lança DashboardApiError 502 quando o payload foge do contrato', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { role: 'ADMIN' })));

    await expect(getAccountProfile()).rejects.toThrow(DashboardApiError);
    await expect(getAccountProfile()).rejects.toMatchObject({ status: 502 });
  });

  it('lança DashboardApiError 502 quando o papel não é reconhecido', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { phoneNumber: '+5511988887777', avatarUrl: null, role: 'ALIEN' }),
        ),
    );

    await expect(getAccountProfile()).rejects.toThrow(/formato inesperado/);
  });

  it('propaga o AbortSignal para o fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, profileBody));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await getAccountProfile(controller.signal);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('em erro do servidor, usa a mensagem devolvida e preserva issues', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(422, { message: 'Telefone inválido.', issues: [{ path: 'phoneNumber' }] }),
        ),
    );

    await expect(getAccountProfile()).rejects.toMatchObject({
      status: 422,
      message: 'Telefone inválido.',
      details: [{ path: 'phoneNumber' }],
    });
  });

  it('em erro sem corpo JSON, cai na mensagem padrão', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(emptyResponse(500)));

    await expect(getAccountProfile()).rejects.toMatchObject({
      status: 500,
      message: 'Não foi possível concluir a solicitação.',
    });
  });

  it('em erro cujo corpo não é um objeto JSON, também cai na mensagem padrão', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => '"apenas texto"',
      } as Response),
    );

    await expect(getAccountProfile()).rejects.toMatchObject({
      status: 500,
      message: 'Não foi possível concluir a solicitação.',
    });
  });

  it('em corpo com JSON inválido, trata como vazio', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, text: async () => '{not json' } as Response),
    );

    await expect(getAccountProfile()).rejects.toMatchObject({ status: 500 });
  });
});

describe('updateAccountProfile', () => {
  it('PATCH com o input serializado e devolve o perfil atualizado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ...profileBody, name: 'Novo Nome' }));
    vi.stubGlobal('fetch', fetchMock);

    const profile = await updateAccountProfile({ name: 'Novo Nome' });

    expect(profile.name).toBe('Novo Nome');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/dashboard/account/profile');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Novo Nome' });
  });
});

describe('changeAccountPassword', () => {
  it('POST com as senhas e não devolve nada em sucesso', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      changeAccountPassword({ currentPassword: 'antiga123', newPassword: 'nova12345' }),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/dashboard/account/password');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      currentPassword: 'antiga123',
      newPassword: 'nova12345',
    });
  });

  it('em senha atual incorreta, propaga a mensagem do servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { message: 'Senha atual incorreta.' })),
    );

    await expect(
      changeAccountPassword({ currentPassword: 'errada', newPassword: 'nova12345' }),
    ).rejects.toMatchObject({ status: 401, message: 'Senha atual incorreta.' });
  });
});

describe('uploadAccountAvatar', () => {
  it('POST multipart com o arquivo e devolve o perfil com o avatar reescrito', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ...profileBody,
        avatarUrl:
          'http://api.movivo.test/api/v1/account/avatar/22222222-2222-4222-8222-222222222222.jpg',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['conteudo'], 'foto.jpg', { type: 'image/jpeg' });

    const profile = await uploadAccountAvatar(file);

    expect(profile.avatarUrl).toBe(
      '/api/dashboard/account/avatar/22222222-2222-4222-8222-222222222222.jpg',
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/dashboard/account/avatar');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    const body = init.body as FormData;
    expect(body.get('avatar')).toBe(file);
  });

  it('em falha de envio, usa a mensagem padrão de avatar quando o servidor não informa uma', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(413, {})));
    const file = new File(['conteudo'], 'foto.jpg', { type: 'image/jpeg' });

    await expect(uploadAccountAvatar(file)).rejects.toMatchObject({
      status: 413,
      message: 'Não foi possível enviar a foto.',
    });
  });

  it('em falha de envio com mensagem do servidor, propaga o texto recebido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(415, { message: 'Formato de imagem não suportado.' })),
    );
    const file = new File(['conteudo'], 'foto.svg', { type: 'image/svg+xml' });

    await expect(uploadAccountAvatar(file)).rejects.toMatchObject({
      status: 415,
      message: 'Formato de imagem não suportado.',
    });
  });
});
