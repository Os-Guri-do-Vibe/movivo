import { beforeEach, describe, expect, it, vi } from 'vitest';

import { protocolContent } from '../../../../../../../test/dashboard-fixtures';

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
const body = {
  content: protocolContent,
  expectedVersion: 1,
  reason: 'Troca manual segura',
  confirmation: true,
};
const call = (value: unknown, id = ID) =>
  POST(
    new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(value) }) as never,
    {
      params: Promise.resolve({ id }),
    },
  );

beforeEach(() => {
  Object.values(bff).forEach((mock) => 'mockReset' in mock && mock.mockReset());
  bff.errorResponse.mockImplementation(
    (error: unknown) => new Response(String(error), { status: 400 }),
  );
  bff.forwardBackendJson.mockResolvedValue(new Response('{}', { status: 201 }));
  bff.authenticatedBackendFetch.mockResolvedValue(new Response('{}'));
});

describe('POST /api/dashboard/protocols/[id]/amend', () => {
  it('encaminha somente a emenda validada ao backend', async () => {
    await call(body);
    expect(bff.assertTrustedMutation).toHaveBeenCalledTimes(1);
    expect(bff.authenticatedBackendFetch).toHaveBeenCalledWith(
      `/professional/dashboard/protocols/${ID}/amend`,
      expect.objectContaining({ method: 'POST' }),
    );
    const request = bff.authenticatedBackendFetch.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual(body);
  });

  it('repassa as divergências reconhecidas pelo profissional', async () => {
    await call({ ...body, acknowledgedConflicts: ['ISOLATION_AS_BASE:x'] });
    const request = bff.authenticatedBackendFetch.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(request.body)).toEqual({
      ...body,
      acknowledgedConflicts: ['ISOLATION_AS_BASE:x'],
    });
  });

  it.each([
    { ...body, confirmation: false },
    { ...body, acknowledgedConflicts: 'ISOLATION_AS_BASE:x' },
    { ...body, expectedVersion: 0 },
    { ...body, reason: 'ok' },
    { ...body, content: { ...protocolContent, phaseDurationWeeks: 0 } },
  ])('recusa corpo inválido sem chamar o backend', async (invalidBody) => {
    await call(invalidBody);
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });
});
