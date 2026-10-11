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
const call = (body: string, id = ID) =>
  POST(new Request('http://localhost/x', { method: 'POST', body }) as never, {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  Object.values(bff).forEach((mock) => 'mockReset' in mock && mock.mockReset());
  bff.errorResponse.mockImplementation(
    (error: unknown) => new Response(String(error), { status: 400 }),
  );
  bff.forwardBackendJson.mockResolvedValue(new Response('{}', { status: 201 }));
  bff.authenticatedBackendFetch.mockResolvedValue(new Response('{}'));
});

describe('POST /api/dashboard/substitutions/[id]/review-hold', () => {
  it.each([true, false])(
    'encaminha active=%s ao backend depois de checar a origem',
    async (active) => {
      await call(JSON.stringify({ active }));
      expect(bff.assertTrustedMutation).toHaveBeenCalledTimes(1);
      expect(bff.authenticatedBackendFetch).toHaveBeenCalledWith(
        `/professional/dashboard/substitutions/${ID}/review-hold`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ active }) }),
      );
    },
  );

  it('só repassa o campo conhecido (nada além de active vai ao backend)', async () => {
    await call(JSON.stringify({ active: true, role: 'ADMIN', protocolId: 'outro' }));
    const init = bff.authenticatedBackendFetch.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ active: true });
  });

  it.each(['', 'não é json', '{}', '{"active":"sim"}', '{"active":1}'])(
    'rejeita corpo inválido (%j) sem chamar o backend',
    async (body) => {
      await call(body);
      expect(bff.errorResponse).toHaveBeenCalled();
      expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    },
  );

  it('rejeita id que não é UUID sem chamar o backend', async () => {
    await call(JSON.stringify({ active: true }), 'nao-e-uuid');
    expect(bff.errorResponse).toHaveBeenCalled();
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
  });

  it('origem não confiável é barrada antes de qualquer coisa', async () => {
    bff.assertTrustedMutation.mockImplementation(() => {
      throw new bff.BffError(403, 'Origem da solicitação não autorizada.');
    });
    await call(JSON.stringify({ active: true }));
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalled();
  });
});
