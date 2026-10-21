import { beforeEach, describe, expect, it, vi } from 'vitest';

const bff = vi.hoisted(() => ({
  assertTrustedMutation: vi.fn(),
  authenticatedBackendFetch: vi.fn(),
  errorResponse: vi.fn((error: unknown) => new Response(String(error), { status: 400 })),
  forwardBackendJson: vi.fn(),
  BffError: class BffError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('../../../_lib/bff', () => bff);

import { POST } from './route';

const ID = '11111111-1111-4111-8111-111111111111';
const call = (value: unknown, id = ID) =>
  POST(
    new Request('http://localhost/x', {
      method: 'POST',
      body: value === undefined ? undefined : JSON.stringify(value),
    }) as never,
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  Object.values(bff).forEach((mock) => 'mockReset' in mock && mock.mockReset());
  bff.errorResponse.mockImplementation(
    (error: unknown) => new Response(String(error), { status: 400 }),
  );
  bff.forwardBackendJson.mockResolvedValue(new Response('{}', { status: 202 }));
  bff.authenticatedBackendFetch.mockResolvedValue(new Response('{}'));
});

describe('POST /api/dashboard/protocols/[id]/regenerate', () => {
  it('encaminha o pedido sem corpo como objeto vazio', async () => {
    await call(undefined);
    expect(bff.assertTrustedMutation).toHaveBeenCalledTimes(1);
    expect(bff.authenticatedBackendFetch.mock.calls[0]?.[0]).toBe(
      `/professional/dashboard/protocols/${ID}/regenerate`,
    );
    const init = bff.authenticatedBackendFetch.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({});
  });

  it('encaminha a confirmação de descarte da edição e nada além dela', async () => {
    await call({ confirmOverwriteEdit: true, extra: 'x' });
    const init = bff.authenticatedBackendFetch.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ confirmOverwriteEdit: true });
  });

  it.each([
    [{ confirmOverwriteEdit: 'sim' }, ID],
    [{ confirmOverwriteEdit: false }, ID],
    [{}, 'nao-e-uuid'],
  ])('recusa corpo ou id inválido sem chamar o backend', async (body, id) => {
    await call(body, id);
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });
});
