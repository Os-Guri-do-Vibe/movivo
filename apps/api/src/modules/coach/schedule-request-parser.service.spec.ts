import { describe, expect, it, vi } from 'vitest';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import { scrubPII } from '../ai-coach/llm/pii-scrubber';
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

const WEEKDAY_NAMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

function request(overrides: Partial<ParseScheduleRequest> = {}): ParseScheduleRequest {
  return {
    userId: 'u1',
    operationId: 'op',
    user: {} as never,
    message: 'amanhã quero descansar',
    today: '2026-10-20',
    week: WEEK.map((date, index) => ({
      date,
      weekday: WEEKDAY_NAMES[index] as string,
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
    { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() } as never,
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
        date: 'HOJE',
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
      conflict: null,
    });
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      json: true,
      temperature: 0,
      dataClass: 'HEALTH',
    });
  });

  it('aceita JSON dentro de cerca de código', async () => {
    const { service } = make('```json\n{"action":"DESCANSAR","date":"AMANHA"}\n```');
    expect((await service.parse(request())).date).toBe('2026-10-21');
  });

  it('descarta data fora da semana e chave que não existe (alucinação), sem aceitar nada solto', async () => {
    const { service } = make(
      JSON.stringify({
        action: 'REORGANIZAR',
        date: 'FORA_DA_SEMANA',
        sessionKey: 'Z',
        leaveOut: [
          { date: 'FORA_DA_SEMANA', sessionKey: 'Z' },
          { date: 'SAB', sessionKey: null },
        ],
        placements: [
          { sessionKey: 'A', date: 'QUI' },
          { sessionKey: 'B', date: null },
          { sessionKey: 'Z', date: 'SEX' },
          { sessionKey: 'A', date: 'FORA_DA_SEMANA' },
        ],
      }),
    );
    const parsed = await service.parse(request());
    expect(parsed.date).toBeNull();
    // A data pedida fora da semana é guardada à parte: o fluxo a recusa em vez de assumir "hoje".
    expect(parsed.invalidDate).toBe('2026-10-26');
    expect(parsed.sessionKey).toBeNull();
    expect(parsed.leaveOut).toEqual([{ date: '2026-10-24' }]);
    expect(parsed.placements).toEqual([
      { sessionKey: 'A', date: '2026-10-22' },
      { sessionKey: 'B', date: null },
    ]);
  });

  it('hoje, amanhã, ontem e o dia da semana viram a data certa; a sigla e o nome por extenso valem', async () => {
    const day = async (value: string) =>
      (
        await make(JSON.stringify({ action: 'TREINAR', date: value })).service.parse(
          request({
            recentDays: [
              { date: '2026-10-19', weekday: 'segunda' },
              { date: '2026-10-18', weekday: 'domingo' },
            ],
          }),
        )
      ).date;
    expect(await day('HOJE')).toBe('2026-10-20');
    expect(await day('amanha')).toBe('2026-10-21');
    expect(await day('SEX')).toBe('2026-10-23');
    expect(await day('Sexta')).toBe('2026-10-23');
    expect(await day('sábado')).toBe('2026-10-24');
    expect(await day('ONTEM')).toBe('2026-10-19');
    expect(await day('ANTEONTEM')).toBe('2026-10-18');
  });

  it('"amanhã" que cai na semana seguinte (hoje é domingo) é recusado como fora da semana', async () => {
    const { service } = make(JSON.stringify({ action: 'TREINAR', date: 'AMANHA' }));
    const parsed = await service.parse(request({ today: '2026-10-25' }));
    expect(parsed.date).toBeNull();
    expect(parsed.invalidDate).toBe('2026-10-26');
  });

  it('"não disse a data" (null) e "pediu uma data que a regra recusa" são coisas diferentes', async () => {
    const without = make(JSON.stringify({ action: 'TREINAR', date: null, sessionKey: 'A' }));
    expect((await without.service.parse(request())).invalidDate).toBeNull();

    const nextWeek = make(
      JSON.stringify({ action: 'TREINAR', date: 'FORA_DA_SEMANA', sessionKey: 'A' }),
    );
    const parsed = await nextWeek.service.parse(request());
    expect(parsed.date).toBeNull();
    expect(parsed.invalidDate).toBe('2026-10-26');
  });

  it('colocação com data fora da semana também marca o pedido como inválido (não some em silêncio)', async () => {
    const { service } = make(
      JSON.stringify({
        action: 'REORGANIZAR',
        placements: [{ sessionKey: 'A', date: 'FORA_DA_SEMANA' }],
      }),
    );
    const parsed = await service.parse(request());
    expect(parsed.placements).toEqual([]);
    expect(parsed.invalidDate).toBe('2026-10-26');
  });

  it('referência desconhecida é só ignorada, sem recusar o pedido', async () => {
    const { service } = make(
      JSON.stringify({ action: 'TREINAR', date: 'depois de amanhã', sessionKey: 'A' }),
    );
    const parsed = await service.parse(request());
    expect(parsed.date).toBeNull();
    expect(parsed.invalidDate).toBeNull();
  });

  it('o prompt manda indicar dia fora da semana por FORA_DA_SEMANA (quem recusa é o servidor)', async () => {
    const { service, complete } = make(JSON.stringify({ action: 'OUTRO' }));
    await service.parse(request());
    const call = complete.mock.calls[0]?.[0] as unknown as { system: string };
    expect(call.system).toContain('FORA_DA_SEMANA');
    expect(call.system).toContain('date NUNCA é uma data');
  });

  /**
   * Regressão (produção, 21/10): o `LlmRouter` passa todo o conteúdo pelo scrubber, que troca
   * `AAAA-MM-DD` por `[data]`. O parser via a semana inteira como `[data]`, inventava uma data e
   * a recusa saía como "esse dia já passou". O que o modelo recebe, DEPOIS do scrubber real,
   * precisa continuar dizendo qual dia é qual.
   */
  it('o que chega ao modelo depois do scrubber ainda identifica hoje e cada dia da semana', async () => {
    const { service, complete } = make(JSON.stringify({ action: 'OUTRO' }));
    await service.parse(request({ today: '2026-10-21' }));
    const call = complete.mock.calls[0]?.[0] as unknown as {
      messages: Array<{ content: string }>;
    };
    const scrubbed = scrubPII(call.messages[0]?.content ?? '', {
      name: 'Gabriel Teste',
      email: null,
      phoneNumber: null,
      birthDate: null,
    } as never);
    expect(scrubbed).not.toContain('[data]');
    expect(scrubbed).toContain('"hoje":{"dia":"HOJE","weekday":"quarta"}');
    expect(scrubbed).toContain('"dia":"SEX"');
    expect(scrubbed).toContain('"ehHoje":true');
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
      conflict: null,
    });
  });

  it('resposta à pergunta "pular ou empurrar?" vira conflict SKIP ou PUSH', async () => {
    const skip = make(JSON.stringify({ action: 'ESCOLHA', conflict: 'PULAR' }));
    expect((await skip.service.parse(request())).conflict).toBe('SKIP');
    const push = make(JSON.stringify({ action: 'ESCOLHA', conflict: 'EMPURRAR' }));
    expect((await push.service.parse(request())).conflict).toBe('PUSH');
    const none = make(JSON.stringify({ action: 'ESCOLHA', conflict: null }));
    expect((await none.service.parse(request())).conflict).toBeNull();
  });
});
