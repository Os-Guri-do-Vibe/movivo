import { describe, expect, it, vi } from 'vitest';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import {
  quickScheduleAction,
  ScheduleRequestParserService,
  type ParseScheduleRequest,
} from './schedule-request-parser.service';

const WEEK = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
];

function request(overrides: Partial<ParseScheduleRequest> = {}): ParseScheduleRequest {
  return {
    userId: 'u1',
    operationId: 'op',
    user: {} as never,
    message: 'amanhã quero descansar',
    today: '2026-10-20',
    week: WEEK.map((date) => ({
      date,
      weekday: 'dia',
      sessionKey: null,
      situation: 'descanso' as const,
    })),
    sessions: [
      { key: 'A', label: 'A (Costas)' },
      { key: 'B', label: 'B (Pernas)' },
    ],
    personaSlot: null,
    ...overrides,
  };
}

function make(llmText: string | Error) {
  const complete = vi.fn(async (_input: unknown) => {
    if (llmText instanceof Error) throw llmText;
    return { text: llmText };
  });
  const service = new ScheduleRequestParserService(
    { complete } as unknown as LlmRouter,
    { setContext: vi.fn(), warn: vi.fn() } as never,
  );
  return { service, complete };
}

describe('quickScheduleAction', () => {
  it.each([
    'desfaz a mudança',
    'pode desfazer?',
    'volta como estava',
    'volta pro plano original',
    'cancela o ajuste',
  ])('reconhece "%s" como desfazer sem chamar a IA', (message) => {
    expect(quickScheduleAction(message)).toBe('DESFAZER');
  });

  it.each(['amanhã quero descansar', 'posso treinar hoje?', 'tô desfazendo as malas'])(
    'não confunde "%s"',
    (message) => {
      expect(quickScheduleAction(message)).toBeNull();
    },
  );
});

describe('ScheduleRequestParserService.parse', () => {
  it('desfazer é reconhecido por regra, sem chamar o modelo', async () => {
    const { service, complete } = make('{}');
    const parsed = await service.parse(request({ message: 'desfaz isso por favor' }));
    expect(parsed.action).toBe('DESFAZER');
    expect(complete).not.toHaveBeenCalled();
  });

  it('traduz o pedido do modelo para ação, data e treino da semana', async () => {
    const { service, complete } = make(
      JSON.stringify({
        action: 'TREINAR',
        date: '2026-10-20',
        sessionKey: 'A',
        leaveOut: [],
        placements: [],
      }),
    );
    const parsed = await service.parse(request({ message: 'hoje posso fazer o A?' }));
    expect(parsed).toEqual({
      action: 'TREINAR',
      date: '2026-10-20',
      invalidDate: null,
      sessionKey: 'A',
      leaveOut: [],
      placements: [],
    });
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      json: true,
      temperature: 0,
      dataClass: 'HEALTH',
    });
  });

  it('aceita JSON dentro de cerca de código', async () => {
    const { service } = make('```json\n{"action":"DESCANSAR","date":"2026-10-21"}\n```');
    expect((await service.parse(request())).date).toBe('2026-10-21');
  });

  it('descarta data fora da semana e chave que não existe (alucinação), sem aceitar nada solto', async () => {
    const { service } = make(
      JSON.stringify({
        action: 'REORGANIZAR',
        date: '2026-11-30',
        sessionKey: 'Z',
        leaveOut: [
          { date: '2027-01-01', sessionKey: 'Z' },
          { date: '2026-10-24', sessionKey: null },
        ],
        placements: [
          { sessionKey: 'A', date: '2026-10-22' },
          { sessionKey: 'B', date: null },
          { sessionKey: 'Z', date: '2026-10-23' },
          { sessionKey: 'A', date: '2030-01-01' },
        ],
      }),
    );
    const parsed = await service.parse(request());
    expect(parsed.date).toBeNull();
    // A data pedida fora da semana é guardada à parte: o fluxo a recusa em vez de assumir "hoje".
    expect(parsed.invalidDate).toBe('2026-11-30');
    expect(parsed.sessionKey).toBeNull();
    expect(parsed.leaveOut).toEqual([{ date: '2026-10-24' }]);
    expect(parsed.placements).toEqual([
      { sessionKey: 'A', date: '2026-10-22' },
      { sessionKey: 'B', date: null },
    ]);
  });

  it('"não disse a data" (null) e "pediu uma data que a regra recusa" são coisas diferentes', async () => {
    const without = make(JSON.stringify({ action: 'TREINAR', date: null, sessionKey: 'A' }));
    expect((await without.service.parse(request())).invalidDate).toBeNull();

    const nextWeek = make(
      JSON.stringify({ action: 'TREINAR', date: '2026-10-29', sessionKey: 'A' }),
    );
    const parsed = await nextWeek.service.parse(request());
    expect(parsed.date).toBeNull();
    expect(parsed.invalidDate).toBe('2026-10-29');
  });

  it('colocação com data fora da semana também marca o pedido como inválido (não some em silêncio)', async () => {
    const { service } = make(
      JSON.stringify({
        action: 'REORGANIZAR',
        placements: [{ sessionKey: 'A', date: '2026-10-30' }],
      }),
    );
    const parsed = await service.parse(request());
    expect(parsed.placements).toEqual([]);
    expect(parsed.invalidDate).toBe('2026-10-30');
  });

  it('data mal formada (não é AAAA-MM-DD) é só ignorada, sem recusar o pedido', async () => {
    const { service } = make(
      JSON.stringify({ action: 'TREINAR', date: 'quinta', sessionKey: 'A' }),
    );
    const parsed = await service.parse(request());
    expect(parsed.date).toBeNull();
    expect(parsed.invalidDate).toBeNull();
  });

  it('o prompt manda devolver a data real mesmo fora da semana (quem recusa é o servidor)', async () => {
    const { service, complete } = make(JSON.stringify({ action: 'OUTRO' }));
    await service.parse(request());
    const call = complete.mock.calls[0]?.[0] as unknown as { system: string };
    expect(call.system).toContain('FORA desta semana');
  });

  it('o texto do aluno e a pergunta em aberto viajam como dado não confiável', async () => {
    const { service, complete } = make(
      JSON.stringify({ action: 'ESCOLHA', leaveOut: [{ sessionKey: 'B' }] }),
    );
    await service.parse(
      request({ message: 'o segundo', openQuestion: 'Qual treino fica de fora?' }),
    );
    const call = complete.mock.calls[0]?.[0] as unknown as {
      messages: Array<{ content: string }>;
      system: string;
    };
    expect(call.messages[0]?.content).toContain('Qual treino fica de fora?');
    expect(call.messages[0]?.content).toContain('o segundo');
    expect(call.system).toContain('NÃO decide nada');
  });

  it.each([
    ['resposta que não é JSON', 'desculpe, não entendi'],
    ['campo desconhecido', '{"action":"TREINAR","extra":1}'],
    ['ação inválida', '{"action":"APAGAR_TUDO"}'],
    ['falha do provedor', new Error('429')],
  ])('%s vira OUTRO, nunca um pedido inventado', async (_label, output) => {
    const { service } = make(output as string | Error);
    expect(await service.parse(request())).toEqual({
      action: 'OUTRO',
      date: null,
      invalidDate: null,
      sessionKey: null,
      leaveOut: [],
      placements: [],
    });
  });
});
