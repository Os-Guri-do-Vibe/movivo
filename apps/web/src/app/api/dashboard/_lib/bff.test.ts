import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => mocks }));
import {
  logoutBackend,
  authenticatedBackendFetch,
  BFF_ACCESS_COOKIE,
  BFF_REFRESH_COOKIE,
} from './bff';
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('logout envia apenas refresh mesmo sem access e só limpa após confirmação', async () => {
  mocks.get.mockImplementation((name) =>
    name === BFF_REFRESH_COOKIE ? { value: 'opaque.refresh' } : undefined,
  );
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  await logoutBackend();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(/auth\/logout\/refresh$/),
    expect.objectContaining({
      method: 'POST',
      headers: { Cookie: 'movivo_refresh=opaque.refresh' },
    }),
  );
  expect(mocks.delete).toHaveBeenCalledWith(BFF_REFRESH_COOKIE);
});
it.each([401, 500, 503])(
  'falha %s não descarta credencial necessária para tentar revogar novamente',
  async (status) => {
    mocks.get.mockReturnValue({ value: 'opaque.refresh' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(logoutBackend()).rejects.toThrow(/encerrar/);
    expect(mocks.delete).not.toHaveBeenCalled();
  },
);
it('falha de rede não simula revogação', async () => {
  mocks.get.mockReturnValue({ value: 'opaque.refresh' });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(logoutBackend()).rejects.toThrow('offline');
  expect(mocks.delete).not.toHaveBeenCalled();
});
it('cookie inventado não autentica operação protegida', async () => {
  mocks.get.mockImplementation((name) =>
    name === BFF_ACCESS_COOKIE ? { value: 'forged' } : undefined,
  );
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  await expect(authenticatedBackendFetch('/account/profile')).rejects.toThrow(/ausente/);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toMatch(/auth\/me$/);
});
