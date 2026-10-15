import { beforeEach, describe, expect, it, vi } from 'vitest';

const bff = vi.hoisted(() => ({
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
vi.mock('../../_lib/bff', () => bff);

import { GET } from './route';

const PROTOCOL_ID = '11111111-1111-4111-8111-111111111111';
const call = (query: string) =>
  GET({
    nextUrl: new URL(`http://localhost/api/dashboard/exercise-catalog/search?${query}`),
  } as never);

beforeEach(() => {
  Object.values(bff).forEach((mock) => 'mockReset' in mock && mock.mockReset());
  bff.errorResponse.mockImplementation(
    (error: unknown) => new Response(String(error), { status: 400 }),
  );
  bff.forwardBackendJson.mockResolvedValue(new Response('{"items":[]}'));
  bff.authenticatedBackendFetch.mockResolvedValue(new Response('{}'));
});

describe('GET /api/dashboard/exercise-catalog/search', () => {
  it('repassa a busca e o protocolo em edição ao backend', async () => {
    await call(`q=${encodeURIComponent(' abdominal prancha ')}&protocolId=${PROTOCOL_ID}`);
    expect(bff.authenticatedBackendFetch).toHaveBeenCalledWith(
      `/professional/dashboard/exercise-catalog/search?q=abdominal+prancha&protocolId=${PROTOCOL_ID}`,
    );
  });

  it.each(['q=', `q=${'a'.repeat(81)}`, 'q=prancha&protocolId=nao-e-uuid'])(
    'recusa consulta inválida (%s) sem chamar o backend',
    async (query) => {
      await call(query);
      expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
      expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
    },
  );
});
