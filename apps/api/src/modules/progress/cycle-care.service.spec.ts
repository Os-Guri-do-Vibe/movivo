import { describe, expect, it, vi } from 'vitest';

import { AgentTaskError } from '../../core/agents/agent-runner';
import { CycleCareService } from './cycle-care.service';
import { FERTILE_WINDOW_DISCLAIMER } from './cycle-care-tasks';

const USER = '11111111-1111-4111-8111-111111111111';
/** 12:00 UTC = 09:00 em São Paulo. */
const at = (day: string) => new Date(`${day}T12:00:00Z`);
const CYCLE = { lastStart: '2026-10-01', typicalLength: 28, cyclesLogged: 2 };

function build(options: { cycle?: object | null; gate?: boolean; runner?: unknown } = {}) {
  const markers = new Set<string>();
  const redis = {
    exists: vi.fn(async (key: string) => (markers.has(key) ? 1 : 0)),
    set: vi.fn(async (key: string) => markers.add(key)),
  };
  const state = {
    read: vi.fn(async (_user: string, _slices: string[], now: Date) => {
      if (options.cycle === null) return { slices: { cycle: null, identity: {} } };
      const today = now.toISOString().slice(0, 10);
      const cycleDay =
        Math.round((Date.parse(today) - Date.parse(CYCLE.lastStart)) / 86_400_000) + 1;
      return {
        slices: {
          cycle: { ...CYCLE, cycleDay, phase: 'LUTEAL', ...options.cycle },
          identity: { biologicalSex: 'FEMALE' },
        },
      };
    }),
  };
  const runner = (options.runner as { run: ReturnType<typeof vi.fn> }) ?? {
    run: vi.fn().mockResolvedValue({ output: { messages: ['Marina, um lembrete com carinho.'] } }),
  };
  const messenger = { send: vi.fn().mockResolvedValue(undefined) };
  const outreach = {
    tryAcquireToday: vi.fn().mockResolvedValue(options.gate ?? true),
    release: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const db = { runAsUser: vi.fn().mockResolvedValue([]) };
  const service = new CycleCareService(
    db as never,
    runner as never,
    state as never,
    { render: vi.fn() } as never,
    {
      loadUser: vi.fn().mockResolvedValue({ firstName: 'Marina', timezone: 'America/Sao_Paulo' }),
    } as never,
    messenger as never,
    outreach as never,
    redis as never,
    { forUser: (_user: string, ...parts: string[]) => parts.join(':') } as never,
    { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
  );
  return { service, runner, messenger, outreach, markers };
}

describe('CycleCareService', () => {
  it('sem autorização do ciclo (ou sem registro) não manda nada', async () => {
    const { service, runner, outreach } = build({ cycle: null });
    expect(await service.run(USER, at('2026-10-27'))).toEqual({
      status: 'SKIPPED',
      reason: 'NO_CYCLE',
    });
    expect(runner.run).not.toHaveBeenCalled();
    expect(outreach.tryAcquireToday).not.toHaveBeenCalled();
  });

  it('avisa que a menstruação está chegando, uma vez por ciclo', async () => {
    const { service, runner, messenger, outreach } = build();
    expect(await service.run(USER, at('2026-10-27'))).toEqual({
      status: 'SENT',
      event: 'PERIOD_SOON',
    });
    expect(runner.run.mock.calls[0]?.[1]).toMatchObject({
      event: 'PERIOD_SOON',
      expectedPeriodOn: '29/10',
      daysUntilPeriod: 2,
      fertileWindow: null,
      firstName: 'Marina',
    });
    expect(messenger.send).toHaveBeenCalledWith(
      USER,
      ['Marina, um lembrete com carinho.'],
      'cycle_PERIOD_SOON_2026-10-01',
    );
    expect(outreach.record).toHaveBeenCalledWith(USER, 'CYCLE_CARE', { strategy: 'PERIOD_SOON' });
    // No dia seguinte a janela do marco ainda está aberta, mas ele já foi enviado.
    expect(await service.run(USER, at('2026-10-28'))).toEqual({ status: 'NOTHING_TO_DO' });
    expect(messenger.send).toHaveBeenCalledOnce();
  });

  it('a janela fértil estimada sai com as datas e o aviso fixo', async () => {
    const { service, runner, messenger } = build();
    await service.run(USER, at('2026-10-09'));
    expect(runner.run.mock.calls[0]?.[1]).toMatchObject({
      event: 'FERTILE_WINDOW',
      fertileWindow: { from: '09/10', to: '15/10' },
    });
    expect(messenger.send.mock.calls[0]?.[1]).toEqual([
      'Marina, um lembrete com carinho.',
      FERTILE_WINDOW_DISCLAIMER,
    ]);
  });

  it('respeita o limite de um contato proativo por dia e tenta de novo no dia seguinte', async () => {
    const blocked = build({ gate: false });
    expect(await blocked.service.run(USER, at('2026-10-27'))).toEqual({
      status: 'SKIPPED',
      reason: 'OTHER_CONTACT_TODAY',
    });
    expect(blocked.runner.run).not.toHaveBeenCalled();
    expect(blocked.markers.size).toBe(0);
  });

  it('sem texto válido do agente, libera o dia e não marca o marco como enviado', async () => {
    const runner = {
      run: vi.fn().mockRejectedValue(new AgentTaskError('medical.cycle_care', [], [])),
    };
    const { service, messenger, outreach, markers } = build({ runner });
    expect(await service.run(USER, at('2026-10-27'))).toEqual({
      status: 'SKIPPED',
      reason: 'NO_MESSAGE',
    });
    expect(outreach.release).toHaveBeenCalledWith(USER, '2026-10-27');
    expect(messenger.send).not.toHaveBeenCalled();
    expect(markers.size).toBe(0);
  });

  it('fora dos marcos não há contato', async () => {
    const { service, outreach } = build();
    expect(await service.run(USER, at('2026-10-05'))).toEqual({ status: 'NOTHING_TO_DO' });
    expect(outreach.tryAcquireToday).not.toHaveBeenCalled();
  });
});
