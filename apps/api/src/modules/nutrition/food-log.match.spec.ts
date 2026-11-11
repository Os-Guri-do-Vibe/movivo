import { FOOD_AI_CATEGORY } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { AgentTaskError } from '../../core/agents/agent-runner';
import { FoodLogService } from './food-log.service';

const USER = '11111111-1111-4111-8111-111111111111';
const RICE = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Arroz, tipo 1, cozido',
  category: 'Cereais e derivados',
  per100g: { energyKcal: 128, proteinG: 2.5, carbsG: 28, fatG: 0.2, fiberG: 1.6, micros: {} },
};
const PIZZA_ESTIMATE = { energyKcal: 270, proteinG: 11, carbsG: 30, fatG: 11, fiberG: 2 };
const ADDED = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Pizza de calabresa',
  category: FOOD_AI_CATEGORY,
  per100g: { ...PIZZA_ESTIMATE, micros: {} },
};

function build(options: {
  search?: (q: string) => unknown[];
  resolve?: unknown;
  addEstimated?: ReturnType<typeof vi.fn>;
}) {
  const foods = {
    search: vi.fn(async (q: string) => options.search?.(q) ?? []),
    candidates: vi.fn().mockResolvedValue([RICE]),
    addEstimated: options.addEstimated ?? vi.fn().mockResolvedValue(ADDED),
  };
  const runner = {
    run: vi.fn(async () => {
      if (options.resolve instanceof Error) throw options.resolve;
      return { output: options.resolve };
    }),
  };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const service = new FoodLogService(
    {} as never,
    runner as never,
    foods as never,
    {} as never,
    {} as never,
    logger as never,
  );
  return { service, foods, runner, logger };
}

const item = (label: string) => ({ label, grams: 100, portionSource: 'ESTIMATED' as const });

describe('FoodLogService.match · alimento fora da TACO', () => {
  it('o que a busca acha não chama o agente', async () => {
    const { service, runner } = build({ search: () => [RICE] });
    const [matched] = await service.match(USER, [item('arroz')]);
    expect(matched).toMatchObject({ foodItemId: RICE.id, matchedName: RICE.name });
    expect(matched).not.toHaveProperty('estimatedPer100g');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('o agente acha o mesmo alimento com outro nome: usa a TACO, sem incluir nada', async () => {
    const { service, foods } = build({
      resolve: { items: [{ index: 0, foodItemId: RICE.id, estimate: null }] },
    });
    const [matched] = await service.match(USER, [item('arroz branco cozido')]);
    expect(matched).toMatchObject({ foodItemId: RICE.id, matchedName: RICE.name });
    expect(foods.addEstimated).not.toHaveBeenCalled();
  });

  it('sem o alimento na TACO, a estimativa do agente é incluída na base e usada no registro', async () => {
    const { service, foods, logger } = build({
      resolve: { items: [{ index: 0, foodItemId: null, estimate: PIZZA_ESTIMATE }] },
    });
    const [matched] = await service.match(USER, [item('pizza de calabresa')]);
    expect(foods.addEstimated).toHaveBeenCalledWith('pizza de calabresa', PIZZA_ESTIMATE);
    expect(matched).toMatchObject({
      foodItemId: ADDED.id,
      matchedName: 'Pizza de calabresa',
      estimatedPer100g: PIZZA_ESTIMATE,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'food_added_by_agent' }),
      expect.any(String),
    );
  });

  it('se a inclusão na base falhar, o registro de agora segue com a estimativa', async () => {
    const { service } = build({
      addEstimated: vi.fn().mockRejectedValue(new Error('banco indisponível')),
      resolve: { items: [{ index: 0, foodItemId: null, estimate: PIZZA_ESTIMATE }] },
    });
    const [matched] = await service.match(USER, [item('pizza de calabresa')]);
    expect(matched).toMatchObject({ foodItemId: null, estimatedPer100g: PIZZA_ESTIMATE });
  });

  it('alimento que o agente incluiu antes é achado pela busca e continua avisado como estimativa', async () => {
    const { service, runner } = build({ search: () => [ADDED] });
    const [matched] = await service.match(USER, [item('pizza de calabresa')]);
    expect(matched).toMatchObject({ foodItemId: ADDED.id });
    expect(matched?.estimatedPer100g).toEqual(PIZZA_ESTIMATE);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('agente sem saída válida: o item segue sem correspondência, sem quebrar o registro', async () => {
    const { service, foods } = build({
      resolve: new AgentTaskError('nutrition.resolve_food', [], []),
    });
    const [matched] = await service.match(USER, [item('farofa da vó')]);
    expect(matched).toMatchObject({ foodItemId: null, matchedName: null });
    expect(matched).not.toHaveProperty('estimatedPer100g');
    expect(foods.addEstimated).not.toHaveBeenCalled();
  });
});
