import { beforeEach, describe, expect, it, vi } from 'vitest';

const bff = vi.hoisted(() => ({
  assertTrustedMutation: vi.fn(),
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

import { POST } from './route';

const UUID = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id: UUID }) };

function post(body?: unknown) {
  return new Request('http://app.test', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never;
}

beforeEach(() => {
  Object.values(bff).forEach((value) => {
    if (typeof value === 'function' && 'mockReset' in value)
      (value as ReturnType<typeof vi.fn>).mockReset();
  });
  bff.authenticatedBackendFetch.mockResolvedValue(new Response(null));
  bff.forwardBackendJson.mockResolvedValue('forwarded');
});

describe('POST /api/dashboard/substitutions/[id]/approve', () => {
  it('sem corpo: aprova todos os itens como estão', async () => {
    const result = await POST(post(), context);
    expect(bff.assertTrustedMutation).toHaveBeenCalled();
    expect(bff.authenticatedBackendFetch).toHaveBeenCalledWith(
      `/professional/dashboard/substitutions/${UUID}/approve`,
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    expect(result).toBe('forwarded');
  });

  it('troca em lote: encaminha a decisão do profissional por item', async () => {
    const items = [
      { index: 0, action: 'APPROVE', toExerciseId: 'afundo' },
      { index: 1, action: 'DISCARD' },
    ];
    await POST(post({ items }), context);
    const call = bff.authenticatedBackendFetch.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(call[1].body)).toEqual({ items });
  });

  it.each([
    ['índice fora do intervalo de itens', { items: [{ index: 3, action: 'APPROVE' }] }],
    ['ação desconhecida', { items: [{ index: 0, action: 'TALVEZ' }] }],
    [
      'mais de 3 decisões',
      {
        items: [0, 1, 2, 0].map((index) => ({ index, action: 'APPROVE' })),
      },
    ],
    ['campo extra', { items: [], extra: true }],
  ])('recusa corpo inválido (%s) sem chamar o backend', async (_label, body) => {
    await POST(post(body), context);
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });

  it('recusa id fora do formato UUID sem chamar o backend', async () => {
    await POST(post(), { params: Promise.resolve({ id: 'nao-e-uuid' }) });
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });
});
