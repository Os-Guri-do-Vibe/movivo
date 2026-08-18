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

  it('rota de respostas da anamnese: PROFESSIONAL/ADMIN, delega pro service', async () => {
    const anamnesisAnswers = vi.fn(async () => ({ userId: 'u1' }));
    const controller = new DashboardController({
      anamnesisAnswers,
    } as unknown as DashboardService);

    expect(
      Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.anamnesisAnswers),
    ).toEqual(['PROFESSIONAL', 'ADMIN']);
    await expect(controller.anamnesisAnswers(professional, 'proto-1')).resolves.toEqual({
      userId: 'u1',
    });
    expect(anamnesisAnswers).toHaveBeenCalledWith(professional, 'proto-1');
  });

  it('rota de respostas da anamnese via PAR-Q: PROFESSIONAL/ADMIN, delega pro service', async () => {
    const parqAnamnesisAnswers = vi.fn(async () => ({ userId: 'u1' }));
    const controller = new DashboardController({
      parqAnamnesisAnswers,
    } as unknown as DashboardService);

    expect(
      Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.parqAnamnesisAnswers),
    ).toEqual(['PROFESSIONAL', 'ADMIN']);
    await expect(controller.parqAnamnesisAnswers(professional, 'session-1')).resolves.toEqual({
      userId: 'u1',
    });
    expect(parqAnamnesisAnswers).toHaveBeenCalledWith(professional, 'session-1');
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
