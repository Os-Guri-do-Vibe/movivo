import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ControlCenterRole } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import type { AuditService } from './audit.service';
import type { FinanceService } from './finance.service';
import { SystemScriptsService } from './system-scripts.service';

const ADMIN: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: ControlCenterRole.ADMIN,
  jti: '22222222-2222-4222-8222-222222222222',
};
const ENGINEER: AuthenticatedUser = { ...ADMIN, role: ControlCenterRole.ENGINEERING };

function fakeJob(
  data: Record<string, unknown>,
  state: {
    processedOn?: number;
    finishedOn?: number;
    failedReason?: string;
    returnvalue?: unknown;
  },
) {
  return { data, timestamp: 1_000, ...state };
}

function setup(jobs: unknown[] = []) {
  const getJobs = vi.fn(async () => jobs);
  const enqueue = vi.fn(async () => 'job-1');
  const queues = { get: vi.fn(() => ({ getJobs })), enqueue } as unknown as QueueManager;
  const tx = {};
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const append = vi.fn(async () => undefined);
  const audit = { append } as unknown as AuditService;
  const materializeRecurring = vi.fn(async () => ({ data: { created: 2 } }));
  const finance = { materializeRecurring } as unknown as FinanceService;
  const refresh = vi.fn(async () => undefined);
  const catalog = { refresh } as unknown as ExerciseCatalogProvider;
  const service = new SystemScriptsService(queues, db, audit, finance, catalog);
  return { service, enqueue, getJobs, append, materializeRecurring, refresh };
}

describe('SystemScriptsService.list', () => {
  it('lista crons, rotinas e scripts de terminal; terminal nunca é executável', async () => {
    const { service } = setup();
    const { data } = await service.list(ADMIN);
    const byKind = (kind: string) => data.scripts.filter((script) => script.kind === kind);

    expect(byKind('CRON').map((script) => script.id)).toEqual([
      'workout-daily-scan',
      'training-daily-scan',
      'weekly-check-in-scan',
      'checkin-weekly-scan',
      'subscription-period-scan',
      'outbox-relay-scan',
    ]);
    expect(byKind('ROUTINE')).toHaveLength(2);
    expect(byKind('TERMINAL').length).toBeGreaterThan(0);
    for (const script of byKind('TERMINAL')) {
      expect(script.runnable).toBe(false);
      expect(script.command).toBeTruthy();
    }
  });

  it('mostra a última execução manual com o resumo do resultado', async () => {
    const { service } = setup([
      fakeJob(
        { kind: 'SCAN', manual: true, scriptId: 'workout-daily-scan' },
        {
          processedOn: 2_000,
          finishedOn: 3_000,
          returnvalue: { status: 'SCANNED', eligible: 10, sent: 4 },
        },
      ),
      // Job do agendamento regular (sem `manual`) nunca aparece como execução manual.
      fakeJob(
        { kind: 'SCAN' },
        { processedOn: 9_000, finishedOn: 9_500, returnvalue: { sent: 99 } },
      ),
    ]);
    const { data } = await service.list(ADMIN);
    const workout = data.scripts.find((script) => script.id === 'workout-daily-scan');

    expect(workout?.lastRun).toEqual({
      state: 'COMPLETED',
      at: new Date(3_000).toISOString(),
      summary: '10 elegíveis · 4 na fila de envio',
    });
  });

  it('marca a rotina financeira como não executável para quem não tem as permissões financeiras', async () => {
    const { service } = setup();
    const { data } = await service.list(ENGINEER);
    const finance = data.scripts.find((script) => script.id === 'finance-recurring-expenses');
    expect(finance?.runnable).toBe(false);
    expect(finance?.notRunnableReason).toMatch(/financeiras/);
  });
});

describe('SystemScriptsService.run', () => {
  it('enfileira o cron na própria fila com force, sem tocar no agendamento, e audita', async () => {
    const { service, enqueue, append } = setup();
    const { data } = await service.run(ADMIN, 'workout-daily-scan');

    expect(data.status).toBe('ENQUEUED');
    expect(enqueue).toHaveBeenCalledWith(
      'workout-daily',
      'manual-daily-workout-scan',
      expect.objectContaining({
        kind: 'SCAN',
        force: true,
        manual: true,
        requestedBy: ADMIN.userId,
      }),
      { jobId: expect.stringMatching(/^manual-workout-daily-scan-/) },
    );
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ADMIN.userId,
        action: 'system.script.run',
        changes: { script: 'workout-daily-scan', kind: 'CRON', status: 'ENQUEUED' },
      }),
    );
  });

  it('recusa uma segunda execução enquanto a manual anterior está em andamento', async () => {
    const { service, enqueue } = setup([
      fakeJob(
        { kind: 'SCAN', manual: true, scriptId: 'subscription-period-scan' },
        { processedOn: 2_000 },
      ),
    ]);
    await expect(service.run(ADMIN, 'subscription-period-scan')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('permite nova execução depois que a anterior terminou', async () => {
    const { service, enqueue } = setup([
      fakeJob(
        { kind: 'SCAN', manual: true, scriptId: 'subscription-period-scan' },
        { processedOn: 2_000, finishedOn: 3_000, returnvalue: { created: 0 } },
      ),
    ]);
    await service.run(ADMIN, 'subscription-period-scan');
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('executa a atualização do catálogo de exercícios na hora', async () => {
    const { service, refresh, append } = setup();
    const { data } = await service.run(ADMIN, 'exercise-catalog-refresh');
    expect(refresh).toHaveBeenCalledOnce();
    expect(data.status).toBe('COMPLETED');
    expect(append).toHaveBeenCalledOnce();
  });

  it('executa as despesas recorrentes só com permissão financeira', async () => {
    const { service, materializeRecurring } = setup();
    const { data } = await service.run(ADMIN, 'finance-recurring-expenses');
    expect(materializeRecurring).toHaveBeenCalledWith(ADMIN);
    expect(data.message).toMatch(/2 despesa/);

    await expect(service.run(ENGINEER, 'finance-recurring-expenses')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(materializeRecurring).toHaveBeenCalledOnce();
  });

  it('recusa script de terminal e id inexistente, sem auditar', async () => {
    const { service, append } = setup();
    await expect(service.run(ADMIN, 'reset-staff-mfa')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.run(ADMIN, 'nao-existe')).rejects.toBeInstanceOf(NotFoundException);
    expect(append).not.toHaveBeenCalled();
  });
});
