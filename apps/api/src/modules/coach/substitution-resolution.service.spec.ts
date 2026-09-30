import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import {
  SubstitutionResolutionService,
  type ResolveTurnRequest,
} from './substitution-resolution.service';

const OFFERED = [
  { id: 'supino_reto_halter', name: 'Supino Reto (Halter)' },
  { id: 'flexao_diamante', name: 'Flexão Diamante' },
];
const OTHERS = [{ id: 'supino_inclinado_halter', name: 'Supino Inclinado (Halter)' }];

function make(text: string) {
  const complete = vi.fn().mockResolvedValue({ text, model: 'deepseek-v4-pro' });
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return {
    service: new SubstitutionResolutionService({ complete } as unknown as LlmRouter, logger),
    complete,
  };
}

function request(over: Partial<ResolveTurnRequest> = {}): ResolveTurnRequest {
  return {
    userId: 'u1',
    operationId: 'op-1',
    user: {},
    recentConversation: 'Aluno: pode ser o primeiro, só hoje',
    personaSlot: null,
    targets: [
      {
        targetId: 'supino_reto_barra',
        targetName: 'Supino Reto (Barra)',
        offered: OFFERED,
        others: OTHERS,
        current: { chosenName: null, scope: null },
      },
    ],
    ...over,
  };
}

const read = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    topic: 'CONTINUE',
    pain: false,
    targets: [
      {
        targetId: 'supino_reto_barra',
        chosenExerciseId: null,
        scope: null,
        rejectedOffered: false,
        requestedOutsideList: false,
        ...over,
      },
    ],
  });

describe('SubstitutionResolutionService.resolveTurn', () => {
  it('lê escolha e alcance explícito na mesma resposta do aluno', async () => {
    const { service } = make(read({ chosenExerciseId: 'supino_reto_halter', scope: 'TODAY' }));
    const result = await service.resolveTurn(request());
    expect(result).toEqual({
      ok: true,
      topic: 'CONTINUE',
      pain: false,
      targets: [
        {
          targetId: 'supino_reto_barra',
          chosenExerciseId: 'supino_reto_halter',
          scope: 'TODAY',
          rejectedOffered: false,
          requestedOutsideList: false,
        },
      ],
    });
  });

  it('aceita escolher uma opção ainda não mostrada (`others`) quando nomeada', async () => {
    const { service } = make(read({ chosenExerciseId: 'supino_inclinado_halter' }));
    const result = await service.resolveTurn(request());
    expect(result).toMatchObject({
      ok: true,
      targets: [{ chosenExerciseId: 'supino_inclinado_halter' }],
    });
  });

  it('id fora das listas recebidas (alucinação) é tratado como sem escolha', async () => {
    const { service } = make(read({ chosenExerciseId: 'agachamento_barra', scope: 'PROTOCOL' }));
    const result = await service.resolveTurn(request());
    // A escolha cai, mas o alcance dito pelo aluno continua valendo.
    expect(result).toMatchObject({
      ok: true,
      targets: [{ chosenExerciseId: null, scope: 'PROTOCOL' }],
    });
  });

  it('o id escolhido precisa ser das listas DAQUELE alvo, não de outro alvo do lote', async () => {
    const { service } = make(
      JSON.stringify({
        topic: 'CONTINUE',
        pain: false,
        targets: [
          {
            targetId: 'supino_reto_barra',
            chosenExerciseId: 'remada_baixa',
            scope: null,
            rejectedOffered: false,
            requestedOutsideList: false,
          },
          {
            targetId: 'remada_curvada',
            chosenExerciseId: 'remada_baixa',
            scope: null,
            rejectedOffered: false,
            requestedOutsideList: false,
          },
        ],
      }),
    );
    const result = await service.resolveTurn(
      request({
        targets: [
          ...request().targets,
          {
            targetId: 'remada_curvada',
            targetName: 'Remada Curvada',
            offered: [{ id: 'remada_baixa', name: 'Remada Baixa' }],
            others: [],
            current: { chosenName: null, scope: null },
          },
        ],
      }),
    );
    if (!result.ok) throw new Error('esperava ok');
    expect(
      result.targets.find((t) => t.targetId === 'supino_reto_barra')?.chosenExerciseId,
    ).toBeNull();
    expect(result.targets.find((t) => t.targetId === 'remada_curvada')?.chosenExerciseId).toBe(
      'remada_baixa',
    );
  });

  it('troca em lote: devolve uma leitura por alvo, com alcance diferente em cada', async () => {
    const { service } = make(
      JSON.stringify({
        topic: 'CONTINUE',
        pain: false,
        targets: [
          {
            targetId: 'supino_reto_barra',
            chosenExerciseId: 'supino_reto_halter',
            scope: 'TODAY',
            rejectedOffered: false,
            requestedOutsideList: false,
          },
          {
            targetId: 'remada_curvada',
            chosenExerciseId: 'remada_baixa',
            scope: 'PROTOCOL',
            rejectedOffered: false,
            requestedOutsideList: false,
          },
        ],
      }),
    );
    const result = await service.resolveTurn(
      request({
        targets: [
          ...request().targets,
          {
            targetId: 'remada_curvada',
            targetName: 'Remada Curvada',
            offered: [{ id: 'remada_baixa', name: 'Remada Baixa' }],
            others: [],
            current: { chosenName: null, scope: null },
          },
        ],
      }),
    );
    if (!result.ok) throw new Error('esperava ok');
    expect(result.targets.map((t) => [t.targetId, t.scope])).toEqual([
      ['supino_reto_barra', 'TODAY'],
      ['remada_curvada', 'PROTOCOL'],
    ]);
  });

  it('ignora alvo desconhecido e leitura repetida do mesmo alvo', async () => {
    const { service } = make(
      JSON.stringify({
        topic: 'CONTINUE',
        pain: false,
        targets: [
          {
            targetId: 'nao_e_alvo',
            chosenExerciseId: null,
            scope: 'TODAY',
            rejectedOffered: false,
            requestedOutsideList: false,
          },
          {
            targetId: 'supino_reto_barra',
            chosenExerciseId: null,
            scope: 'TODAY',
            rejectedOffered: false,
            requestedOutsideList: false,
          },
          {
            targetId: 'supino_reto_barra',
            chosenExerciseId: null,
            scope: 'PROTOCOL',
            rejectedOffered: false,
            requestedOutsideList: false,
          },
        ],
      }),
    );
    const result = await service.resolveTurn(request());
    if (!result.ok) throw new Error('esperava ok');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.scope).toBe('TODAY');
  });

  it('sinaliza recusa das opções oferecidas e pedido de exercício fora das listas', async () => {
    const { service } = make(read({ rejectedOffered: true, requestedOutsideList: true }));
    const result = await service.resolveTurn(request());
    expect(result).toMatchObject({
      ok: true,
      targets: [{ rejectedOffered: true, requestedOutsideList: true }],
    });
  });

  it('sinaliza mudança de assunto e dor', async () => {
    const { service } = make(JSON.stringify({ topic: 'NEW_TOPIC', pain: true, targets: [] }));
    const result = await service.resolveTurn(request());
    expect(result).toEqual({ ok: true, topic: 'NEW_TOPIC', pain: true, targets: [] });
  });

  it('o prompt dá ao motivo sozinho ("tá cheio") o alcance nulo: só o alcance dito vale', async () => {
    const { service, complete } = make(read());
    await service.resolveTurn(request({ recentConversation: 'Aluno: o banco tá cheio' }));
    const system = complete.mock.calls[0]?.[0]?.system as string;
    expect(system).toContain('Um MOTIVO sozinho');
    expect(system).toContain('NÃO define o alcance');
  });

  it('envia a conversa e os alvos (com as listas fechadas) ao modelo', async () => {
    const { service, complete } = make(read());
    await service.resolveTurn(request());
    const content = complete.mock.calls[0]?.[0]?.messages[0]?.content as string;
    expect(content).toContain('pode ser o primeiro, só hoje');
    expect(content).toContain('supino_reto_halter');
    expect(content).toContain('supino_inclinado_halter');
  });

  it('JSON malformado → não lido, sem lançar', async () => {
    const { service } = make('isso não é JSON');
    await expect(service.resolveTurn(request())).resolves.toEqual({ ok: false });
  });

  it('JSON fora do schema → não lido, sem lançar', async () => {
    const { service } = make(JSON.stringify({ topic: 'TALVEZ', pain: false, targets: [] }));
    await expect(service.resolveTurn(request())).resolves.toEqual({ ok: false });
  });

  it('falha do LLM → não lido, sem lançar', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('provedor indisponível'));
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    const service = new SubstitutionResolutionService({ complete } as unknown as LlmRouter, logger);
    await expect(service.resolveTurn(request())).resolves.toEqual({ ok: false });
  });

  it('sem alvos → não lido, sem chamar o LLM', async () => {
    const { service, complete } = make(read());
    await expect(service.resolveTurn(request({ targets: [] }))).resolves.toEqual({ ok: false });
    expect(complete).not.toHaveBeenCalled();
  });
});
