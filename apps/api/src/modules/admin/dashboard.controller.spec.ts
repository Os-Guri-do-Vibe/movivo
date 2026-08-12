import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ROLES_KEY } from '../auth/roles.decorator';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

const professional: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'PROFESSIONAL',
  jti: 'jti',
};

describe('DashboardController SSE', () => {
  it('mantém mutações CREF-only e libera a leitura da fila para ADMIN', () => {
    const stream = { subscribe: vi.fn() };
    const events = vi.fn(() => stream);
    const controller = new DashboardController({ events } as unknown as DashboardService);

    expect(Reflect.getMetadata(ROLES_KEY, DashboardController)).toEqual(['PROFESSIONAL']);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.events)).toEqual([
      'PROFESSIONAL',
      'ADMIN',
    ]);
    expect(
      Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.signProtocol),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.releaseParq),
    ).toBeUndefined();
    expect(controller.events(professional)).toBe(stream);
    expect(events).toHaveBeenCalledWith(professional);
  });

  it('declara headers anti-cache e anti-buffering no endpoint', () => {
    const headers = Reflect.getMetadata(
      '__headers__',
      DashboardController.prototype.events,
    ) as Array<{ name: string; value: string }>;
    expect(headers).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'private, no-store, no-transform' },
        { name: 'X-Accel-Buffering', value: 'no' },
      ]),
    );
  });
});
