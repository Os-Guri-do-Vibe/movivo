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

vi.mock('../../../../../_lib/bff', () => bff);

import { POST } from './route';

const UUID = '11111111-1111-4111-8111-111111111111';
const EXERCISE = {
  exerciseKey: 'extensora_unilateral',
  changeNote: 'Adicionado a partir de pedido de aluno',
  name: 'Extensora Unilateral',
  pattern: 'ISOLATION',
  muscleGroups: ['quadríceps'],
  equipment: [],
  locations: ['FULL_GYM'],
  levels: ['INICIANTE'],
  contraindicatedFor: [],
  substitutes: [],
};

function call(index: string, body: unknown, id = UUID) {
  return POST(
    new Request('http://app.test', { method: 'POST', body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id, index }) },
  );
}

beforeEach(() => {
  Object.values(bff).forEach((value) => {
    if (typeof value === 'function' && 'mockReset' in value)
      (value as ReturnType<typeof vi.fn>).mockReset();
  });
  bff.authenticatedBackendFetch.mockResolvedValue(new Response(null));
  bff.forwardBackendJson.mockResolvedValue('forwarded');
});

describe('POST /api/dashboard/substitutions/[id]/items/[index]/catalog-exercise', () => {
  it('encaminha o exercício ao item certo da proposta', async () => {
    const result = await call('1', EXERCISE);
    expect(bff.authenticatedBackendFetch).toHaveBeenCalledWith(
      `/professional/dashboard/substitutions/${UUID}/items/1/catalog-exercise`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result).toBe('forwarded');
  });

  it.each(['3', '-1', 'x', '1.5'])(
    'recusa o índice de item %s sem chamar o backend',
    async (index) => {
      await call(index, EXERCISE);
      expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
      expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
    },
  );

  it('recusa exercício fora do schema de publicação sem chamar o backend', async () => {
    await call('0', { ...EXERCISE, name: '' });
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
    expect(bff.errorResponse).toHaveBeenCalledWith(expect.any(bff.BffError));
  });

  it('recusa id fora do formato UUID sem chamar o backend', async () => {
    await call('0', EXERCISE, 'nao-e-uuid');
    expect(bff.authenticatedBackendFetch).not.toHaveBeenCalled();
  });
});
