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
  it('libera leitura da fila e as mutações (assinar/editar/resolver) para PROFESSIONAL/ADMIN', () => {
    const stream = { subscribe: vi.fn() };
    const events = vi.fn(() => stream);
    const controller = new DashboardController({ events } as unknown as DashboardService);

    // A classe herda só `PROFESSIONAL` (linha de base); achado 2026-08-22 — ADMIN
    // (conta fundador) ganhou as mesmas mutações via `@Roles` explícito por método.
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController)).toEqual(['PROFESSIONAL']);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.events)).toEqual([
      'PROFESSIONAL',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.editProtocol)).toEqual([
      'PROFESSIONAL',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.signProtocol)).toEqual([
      'PROFESSIONAL',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.resolveHandoff)).toEqual([
      'PROFESSIONAL',
      'ADMIN',
    ]);
    expect(controller.events(professional)).toBe(stream);
    expect(events).toHaveBeenCalledWith(professional);
  });

  it('rota de respostas da anamnese: PROFESSIONAL/ADMIN, delega pro service', async () => {
    const anamnesisAnswers = vi.fn(async () => ({ userId: 'u1' }));
    const controller = new DashboardController({
      anamnesisAnswers,
    } as unknown as DashboardService);

    expect(Reflect.getMetadata(ROLES_KEY, DashboardController.prototype.anamnesisAnswers)).toEqual([
      'PROFESSIONAL',
      'ADMIN',
    ]);
    await expect(controller.anamnesisAnswers(professional, 'proto-1')).resolves.toEqual({
      userId: 'u1',
    });
    expect(anamnesisAnswers).toHaveBeenCalledWith(professional, 'proto-1');
  });

  /**
   * 2026-08-24: PAR-Q não tem mais rota própria. `POST /parq/:id/release` e
   * `GET /queue/parq/:id/anamnesis` foram removidas junto com a tela separada — assinar o
   * protocolo é o que libera o PAR-Q, e a anamnese é lida pela rota do protocolo.
   */
  it('não expõe mais rotas próprias de PAR-Q', () => {
    const controller = DashboardController.prototype as unknown as Record<string, unknown>;
    expect(controller.releaseParq).toBeUndefined();
    expect(controller.parqAnamnesisAnswers).toBeUndefined();
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
