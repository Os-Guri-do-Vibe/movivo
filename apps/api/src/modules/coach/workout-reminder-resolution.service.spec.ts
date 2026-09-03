import { describe, expect, it, vi } from 'vitest';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import { WorkoutReminderResolutionService } from './workout-reminder-resolution.service';

function service(text: string) {
  const complete = vi.fn(async () => ({ text, model: 'deepseek-v4-pro' }));
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  return {
    complete,
    resolver: new WorkoutReminderResolutionService(
      { complete } as unknown as LlmRouter,
      logger as never,
    ),
  };
}

const request = {
  userId: '11111111-1111-4111-8111-111111111111',
  operationId: 'operation',
  user: {},
  message: 'beleza, me manda o link as 16h',
  personaSlot: null,
};

describe('WorkoutReminderResolutionService', () => {
  it('usa a IA para transformar linguagem natural em horario validado', async () => {
    const { resolver, complete } = service('{"time":"16:00"}');

    await expect(resolver.resolve(request)).resolves.toMatchObject({
      resolved: true,
      time: '16:00',
      model: 'deepseek-v4-pro',
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        json: true,
        temperature: 0,
        intent: 'workout_reminder_time_resolution',
      }),
    );
  });

  it.each(['{"time":"25:00"}', '{"time":"4"}', 'resposta sem json'])(
    'nao altera nada quando a saida nao e um horario seguro: %s',
    async (output) => {
      const { resolver } = service(output);
      await expect(resolver.resolve(request)).resolves.toMatchObject({ resolved: false });
    },
  );

  it('mantem pedidos ambiguos sem resolucao', async () => {
    const { resolver } = service('{"time":null}');
    await expect(
      resolver.resolve({ ...request, message: 'manda mais tarde' }),
    ).resolves.toMatchObject({
      resolved: false,
    });
  });
});
