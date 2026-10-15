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
    new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(value) }) as never,
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  Object.values(bff).forEach((mock) => 'mockReset' in mock && mock.mockReset());
  bff.errorResponse.mockImplementation(
    (error: unknown) => new Response(String(error), { status: 400 }),
  );
  bff.forwardBackendJson.mockResolvedValue(new Response('{}', { status: 200 }));
  bff.authenticatedBackendFetch.mockResolvedValue(new Response('{}'));
});

describe('POST /api/dashboard/protocols/[id]/sign', () => {
  it('encaminha a confirmação e as divergências reconhecidas', async () => {
    await call({ confirmation: true, acknowledgedConflicts: ['ISOLATION_AS_BASE:x'] });
    expect(bff.assertTrustedMutation).toHaveBeenCalledTimes(1);
    const request = bff.authenticatedBackendFetch.mock.calls[0]?.[1] as { body: string };
    expect(bff.authenticatedBackendFetch.mock.calls[0]?.[0]).toBe(
      `/professional/dashboard/protocols/${ID}/sign`,
    );
    expect(JSON.parse(request.body)).toEqual({
      confirmation: true,
      acknowledgedConflicts: ['ISOLATION_AS_BASE:x'],
    });
  });

  it('assinatura sem divergências continua só com a confirmação', async () => {
    await call({ confirmation: true });
    const request = bff.authenticatedBackendFetch.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({ confirmation: true });
  });

  it.each([
    [{ confirmation: false }, ID],
    [{}, ID],
    [{ confirmation: true, acknowledgedConflicts: 'x' }, ID],
    [{ confirmation: true }, 'nao-e-uuid'],
  ])('recusa corpo ou id inválido sem chamar o backend', async (body, id) => {
    await call(body, id);
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });
});
