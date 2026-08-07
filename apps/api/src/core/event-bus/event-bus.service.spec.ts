import { describe, expect, it, vi } from 'vitest';

import { DomainEventBus } from './event-bus.service';

describe('DomainEventBus', () => {
  it('roteia sem acoplar os modulos e permite cancelar o handler', async () => {
    const bus = new DomainEventBus();
    const handler = vi.fn(async ({ id }: { id: string }) => id === 'ok');
    const unregister = bus.register('test', handler);
    await expect(bus.request('test', { id: 'ok' })).resolves.toBe(true);
    unregister();
    await expect(bus.request('test', { id: 'ok' })).resolves.toBeUndefined();
  });

  it('falha fechado para registro duplicado', () => {
    const bus = new DomainEventBus();
    bus.register('test', async () => true);
    expect(() => bus.register('test', async () => false)).toThrow('handler ja registrado');
  });
});
