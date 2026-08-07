import { describe, expect, it, vi } from 'vitest';

import { DashboardQueueEventsService } from './dashboard-queue-events.service';

describe('DashboardQueueEventsService', () => {
  it('emite apenas invalidacao minima, heartbeat e libera o listener no unsubscribe', () => {
    vi.useFakeTimers();
    const service = new DashboardQueueEventsService();
    const received: unknown[] = [];
    const subscription = service.stream().subscribe((event) => received.push(event));

    expect(service.activeConnections()).toBe(1);
    service.emit('checkin');
    expect(received[0]).toEqual({
      type: 'queue.updated',
      data: { invalidate: true },
    });
    expect(JSON.stringify(received[0])).not.toMatch(/userId|phone|content|pain/i);

    vi.advanceTimersByTime(25_000);
    expect(received[1]).toEqual({
      type: 'heartbeat',
      data: {},
    });

    vi.advanceTimersByTime(5 * 60_000 - 25_000);
    expect(service.activeConnections()).toBe(0);
    subscription.unsubscribe();
    service.onModuleDestroy();
    vi.useRealTimers();
  });
});
