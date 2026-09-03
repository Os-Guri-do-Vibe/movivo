import { beforeEach, describe, expect, it, vi } from 'vitest';

const bff = vi.hoisted(() => ({
  authenticatedBackendFetch: vi.fn(),
  errorResponse: vi.fn(),
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

import { GET } from './route';

const UUID = '11111111-1111-4111-8111-111111111111';

function params(kind: string, id: string) {
  return { params: Promise.resolve({ kind, id }) };
}

beforeEach(() => {
  Object.values(bff).forEach((value) => {
    if (typeof value === 'function' && 'mockReset' in value)
      (value as ReturnType<typeof vi.fn>).mockReset();
  });
  bff.forwardBackendJson.mockResolvedValue('forwarded');
});

describe('GET /api/dashboard/queue/[kind]/[id]', () => {
  // Achado 2026-09-03: `SUBSTITUTION` faltava aqui desde que a feature nasceu
  // (2026-09-02) — "Abrir caso" na fila sempre voltava 400 pra esse kind, e a tela de
  // detalhe (com os botões Aprovar/Recusar) nunca era alcançada.
  it.each(['PROTOCOL', 'HANDOFF', 'CHECKIN', 'SUBSTITUTION'])(
    'encaminha %s válido pro backend',
    async (kind) => {
      bff.authenticatedBackendFetch.mockResolvedValue(new Response(null));
      const result = await GET(new Request('http://app.test'), params(kind.toLowerCase(), UUID));

      expect(bff.authenticatedBackendFetch).toHaveBeenCalledWith(
        `/professional/dashboard/queue/${kind}/${UUID}`,
      );
      expect(bff.forwardBackendJson).toHaveBeenCalled();
      expect(result).toBe('forwarded');
    },
  );

  it('recusa kind desconhecido sem chamar o backend', async () => {
    await GET(new Request('http://app.test'), params('parq', UUID));
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });

  it('recusa id fora do formato UUID sem chamar o backend', async () => {
    await GET(new Request('http://app.test'), params('protocol', 'nao-e-uuid'));
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });
});
