import { describe, expect, it, vi } from 'vitest';

import { FoodChatService, outsideTable } from './food-chat.service';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-11T18:00:00Z');
const MANGO = {
  foodItemId: '22222222-2222-4222-8222-222222222222',
  label: 'manga',
  grams: 200,
  portionSource: 'ESTIMATED' as const,
  matchedName: 'Manga, Haden, crua',
};
const TOTALS = {
  energyKcal: 128,
  proteinG: 1,
  carbsG: 34,
  fatG: 0,
  fiberG: 3,
  micros: {},
  unmatchedItems: 0,
};
const DAY = {
  firstName: 'Ana',
  today: '2026-11-11',
  date: '2026-11-11',
  dayType: 'REST',
  targets: null,
  logs: [
    { id: 'log-cafe', meal: 'BREAKFAST', items: [], totals: TOTALS, confirmed: true },
    { id: 'log-novo', meal: 'AFTERNOON_SNACK', items: [], totals: TOTALS, confirmed: true },
  ],
  totals: { energyKcal: 128, proteinG: 1, carbsG: 34, fatG: 0, fiberG: 3 },
  hasPlan: false,
};

function build(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => keys.forEach((key) => store.delete(key))),
  };
  const foods = {
    activePlan: vi.fn().mockResolvedValue(null),
    day: vi.fn().mockResolvedValue(DAY),
    readText: vi.fn().mockResolvedValue({
      meal: 'AFTERNOON_SNACK',
      items: [MANGO],
      totals: TOTALS,
      needsClarification: null,
      discard: false,
    }),
    readPhoto: vi.fn(),
    draftFromText: vi.fn().mockResolvedValue({
      logId: 'log-novo',
      meal: 'AFTERNOON_SNACK',
      items: [MANGO],
      totals: TOTALS,
      needsClarification: null,
    }),
    draftFromPhoto: vi.fn(),
    confirm: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue(null),
    latestLog: vi.fn().mockResolvedValue(null),
    replaceItems: vi.fn().mockResolvedValue(TOTALS),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const runner = { run: vi.fn().mockResolvedValue({ output: { comment: 'Boa escolha.' } }) };
  const state = { read: vi.fn().mockResolvedValue({ slices: { identity: {} }, version: 1 }) };
  const keys = { forUser: (_user: string, ...parts: string[]) => parts.join(':') };
  const service = new FoodChatService(
    foods as never,
    runner as never,
    state as never,
    { render: vi.fn() } as never,
    {} as never,
    redis as never,
    keys as never,
    { setContext: vi.fn(), warn: vi.fn() } as never,
  );
  return { service, foods, redis, store };
}

describe('FoodChatService · consulta sem registro', () => {
  it('"quantas calorias tem uma manga?" responde os números e não grava nada', async () => {
    const { service, foods, store } = build();
    const reply = await service.queryText(USER, 'quantas calorias tem uma manga?', NOW);
    expect(reply.status).toBe('ANSWERED');
    expect(reply.messages[0]).toMatch(/Calorias: 128 kcal/);
    expect(reply.messages[0]).toMatch(/não registrei nada/);
    expect(foods.draftFromText).not.toHaveBeenCalled();
    expect(foods.confirm).not.toHaveBeenCalled();
    // O que foi consultado fica guardado: "comi" depois vira registro sem repetir.
    expect(JSON.parse(store.get('meal-log:query') as string)).toEqual([
      { label: 'manga', grams: 200 },
    ]);
  });

  it('"comi" depois da consulta registra o que foi consultado e encerra a consulta', async () => {
    const { service, foods, store } = build();
    await service.queryText(USER, 'quantas calorias tem uma manga?', NOW);
    const reply = await service.logText(USER, 'comi', NOW);
    expect(foods.draftFromText.mock.calls[0]?.[3]).toMatchObject({
      queried: [{ label: 'manga', grams: 200 }],
    });
    expect(foods.confirm).toHaveBeenCalledOnce();
    expect(reply.status).toBe('LOGGED');
    expect(reply.messages[0]).toMatch(/Registrei seu lanche da tarde/);
    expect(reply.messages[0]).toMatch(/Essa refeição teve:\nCalorias: 128 kcal/);
    expect(store.has('meal-log:query')).toBe(false);
  });

  it('foto com legenda de pergunta também é só consulta', async () => {
    const readPhoto = vi.fn().mockResolvedValue({
      meal: 'LUNCH',
      items: [MANGO],
      totals: TOTALS,
      needsClarification: null,
      discard: false,
    });
    const { service, foods } = build({ readPhoto });
    const reply = await service.queryPhoto(
      USER,
      { mediaType: 'image/jpeg', base64: 'AAAA' },
      'quantas calorias tem isso?',
      NOW,
    );
    expect(reply.status).toBe('ANSWERED');
    expect(reply.messages[0]).toMatch(/estimativa pela foto/);
    expect(foods.draftFromPhoto).not.toHaveBeenCalled();
    expect(foods.confirm).not.toHaveBeenCalled();
  });
});

describe('FoodChatService · correção de qualquer refeição', () => {
  const breakfast = {
    id: 'log-cafe',
    meal: 'BREAKFAST',
    loggedOn: '2026-11-11',
    items: [{ foodItemId: null, label: 'ovo', grams: 100, portionSource: 'ESTIMATED' }],
  };

  it('corrige a refeição que o aluno citou, mesmo não sendo a última', async () => {
    const latestLog = vi.fn().mockResolvedValue(breakfast);
    const { service, foods, store } = build({ latestLog });
    store.set('meal-log:last', 'log-almoco');
    const reply = await service.correct(
      USER,
      'no café da manhã foram 3 ovos',
      { meal: 'BREAKFAST' },
      NOW,
    );
    expect(latestLog).toHaveBeenCalledWith(USER, '2026-11-11', 'BREAKFAST');
    expect(foods.find).not.toHaveBeenCalled();
    expect(foods.readText.mock.calls[0]?.[3]).toMatchObject({
      previous: { meal: 'BREAKFAST', items: [{ label: 'ovo', grams: 100 }] },
    });
    expect(foods.replaceItems).toHaveBeenCalledWith(USER, 'log-cafe', 'AFTERNOON_SNACK', [
      expect.objectContaining({ label: 'manga' }),
    ]);
    expect(reply?.messages[0]).toMatch(/^Corrigido!/);
  });

  it('sem citar a refeição, vale o último registro do chat', async () => {
    const find = vi.fn().mockResolvedValue({ ...breakfast, id: 'log-almoco', meal: 'LUNCH' });
    const { service, foods, store } = build({ find });
    store.set('meal-log:last', 'log-almoco');
    await service.correct(USER, 'na verdade foram 3 ovos', {}, NOW);
    expect(find).toHaveBeenCalledWith(USER, 'log-almoco');
    expect(foods.replaceItems.mock.calls[0]?.[1]).toBe('log-almoco');
  });

  it('refeição de ontem é procurada no dia anterior', async () => {
    const latestLog = vi
      .fn()
      .mockResolvedValue({ ...breakfast, meal: 'DINNER', loggedOn: '2026-11-10' });
    const { service, foods } = build({ latestLog });
    await service.correct(
      USER,
      'ontem no jantar foram 2',
      { meal: 'DINNER', yesterday: true },
      NOW,
    );
    expect(latestLog).toHaveBeenCalledWith(USER, '2026-11-10', 'DINNER');
    // A resposta mostra o dia do registro corrigido, não o de hoje.
    expect(foods.day).toHaveBeenLastCalledWith(USER, '2026-11-10', NOW);
  });

  it('"não comi isso, apaga" remove o registro', async () => {
    const latestLog = vi.fn().mockResolvedValue(breakfast);
    const readText = vi.fn().mockResolvedValue({
      meal: 'BREAKFAST',
      items: [],
      totals: TOTALS,
      needsClarification: null,
      discard: true,
    });
    const { service, foods } = build({ latestLog, readText });
    const reply = await service.correct(USER, 'apaga o café', { meal: 'BREAKFAST' }, NOW);
    expect(foods.remove).toHaveBeenCalledWith(USER, 'log-cafe');
    expect(foods.replaceItems).not.toHaveBeenCalled();
    expect(reply?.messages[0]).toMatch(/apaguei o registro do seu café da manhã/);
  });

  it('sem registro para corrigir devolve nulo (quem chama trata como registro novo)', async () => {
    const { service } = build();
    expect(await service.correct(USER, 'no jantar foram 2', { meal: 'DINNER' }, NOW)).toBeNull();
  });
});

describe('itens fora da tabela', () => {
  it('separa o que entrou por estimativa do que ficou sem número', () => {
    expect(
      outsideTable([
        { foodItemId: MANGO.foodItemId, label: 'manga', grams: 1, portionSource: 'ESTIMATED' },
        {
          foodItemId: null,
          label: 'pizza',
          grams: 1,
          portionSource: 'ESTIMATED',
          estimatedPer100g: { energyKcal: 270, proteinG: 11, carbsG: 30, fatG: 11, fiberG: 2 },
        },
        { foodItemId: null, label: 'farofa da vó', grams: 1, portionSource: 'ESTIMATED' },
      ]),
    ).toEqual({ estimatedLabels: ['pizza'], unmatchedLabels: ['farofa da vó'] });
  });
});
