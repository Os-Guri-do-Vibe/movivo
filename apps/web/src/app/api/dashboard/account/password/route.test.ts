import { beforeEach, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
const bff = vi.hoisted(() => ({
  assertTrustedMutation: vi.fn(),
  authenticatedBackendFetch: vi.fn(),
  clearSession: vi.fn(),
  forwardBackendJson: vi.fn(),
  errorResponse: vi.fn(),
}));
vi.mock('../../_lib/bff', () => ({
  ...bff,
  DASHBOARD_PRIVATE_HEADERS: { 'Cache-Control': 'private, no-store' },
  BffError: class extends Error {},
}));
import { POST } from './route';
beforeEach(() => vi.clearAllMocks());
const request = () =>
  ({
    json: async () => ({ currentPassword: 'atual', newPassword: 'Senha-Nova-123!' }),
  }) as NextRequest;
it('limpa os cookies somente após o backend revogar as sessões na troca de senha', async () => {
  bff.authenticatedBackendFetch.mockResolvedValue(new Response(null, { status: 204 }));
  expect((await POST(request())).status).toBe(204);
  expect(bff.clearSession).toHaveBeenCalledOnce();
});
it('preserva cookies se a troca de senha for recusada', async () => {
  const upstream = new Response('{}', { status: 401 });
  bff.authenticatedBackendFetch.mockResolvedValue(upstream);
  bff.forwardBackendJson.mockReturnValue(upstream);
  expect((await POST(request())).status).toBe(401);
  expect(bff.clearSession).not.toHaveBeenCalled();
});
