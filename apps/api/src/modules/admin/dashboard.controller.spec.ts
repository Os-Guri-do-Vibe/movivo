import { firstValueFrom, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ROLES_KEY } from '../auth/roles.decorator';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

const professional: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'PROFESSIONAL',
  jti: 'jti',
  expiresAt: Math.floor(Date.now() / 1000) + 900,
};

describe('DashboardController SSE', () => {
  it('libera leitura da fila e as mutações (assinar/editar/resolver) para PROFESSIONAL/ADMIN', () => {
    const stream = of({ data: { invalidate: true } });
    const events = vi.fn(() => stream);
    const controller = new DashboardController(
      { events } as unknown as DashboardService,
      { assertActiveSession: vi.fn().mockResolvedValue(undefined) } as never,
    );

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
    expect(controller.events(professional)).toBeDefined();
    expect(events).toHaveBeenCalledWith(professional);
  });

  it('rota de respostas da anamnese: PROFESSIONAL/ADMIN, delega pro service', async () => {
    const anamnesisAnswers = vi.fn(async () => ({ userId: 'u1' }));
    const controller = new DashboardController(
      {
        anamnesisAnswers,
      } as unknown as DashboardService,
      {} as never,
    );

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

describe('SSE respeita o estado atual de autenticação', () => {
  it('revalida antes de cada evento e não transmite após revogação', async () => {
    const auth = { assertActiveSession: vi.fn().mockRejectedValue(new Error('Revogada')) };
    const controller = new DashboardController(
      { events: () => of({ data: { invalidate: true } }) } as never,
      auth as never,
    );
    await expect(firstValueFrom(controller.events(professional))).rejects.toThrow('Revogada');
    expect(auth.assertActiveSession).toHaveBeenCalledWith(
      professional.userId,
      professional.role,
      professional.jti,
    );
  });
  it('não abre stream sem prazo validado', () => {
    const controller = new DashboardController({} as never, {} as never);
    expect(() => controller.events({ ...professional, expiresAt: undefined })).toThrow('expirada');
  });
  it('encerra o stream no instante de expiração mesmo sem eventos', async () => {
    vi.useFakeTimers();
    try {
      const controller = new DashboardController(
        { events: () => new Subject() } as never,
        {} as never,
      );
      const complete = vi.fn();
      const expiresAt = Math.floor(Date.now() / 1000) + 1;
      controller.events({ ...professional, expiresAt }).subscribe({ complete });
      await vi.advanceTimersByTimeAsync(1000);
      expect(complete).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
