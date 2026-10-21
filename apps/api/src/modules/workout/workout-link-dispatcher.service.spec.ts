import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { RedisKeyBuilder } from '../../core/redis';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { ShortLinkService } from '../short-link/short-link.service';
import type { WorkoutAccessService } from './workout-access.service';
import { WorkoutLinkDispatcherService } from './workout-link-dispatcher.service';
import type { WorkoutJournalService } from './workout-journal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function workout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'w-1',
    status: 'PLANNED',
    prescription: { focus: 'Costas e Bíceps', dayLabel: 'A', exercises: [] },
    ...overrides,
  };
}

function make(options: {
  workout?: ReturnType<typeof workout> | null;
  timezone?: string;
  throttled?: boolean;
  noProtocol?: boolean;
  noStudent?: boolean;
}) {
  const order: string[] = [];
  const student = options.noStudent
    ? []
    : [{ name: 'Gabriel Souza', timezone: options.timezone ?? 'America/Sao_Paulo' }];
  const db = {
    runAsSystem: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => student }) }) }),
      }),
    ),
  } as unknown as TenantDatabase;
  const journal = {
    refreshPlannedSession: vi.fn(async () => 'UNCHANGED'),
    journal: vi.fn(async () => {
      if (options.noProtocol) throw new NotFoundException();
      return { workout: options.workout === undefined ? workout() : options.workout };
    }),
  } as unknown as WorkoutJournalService;
  const access = {
    revokePendingMagicLinks: vi.fn(async () => {
      order.push('revoke');
      return 1;
    }),
    createMagicLink: vi.fn(async () => {
      order.push('create');
      return 'https://movivo.test/treino/acessar#token=secret';
    }),
  } as unknown as WorkoutAccessService;
  const redis = {
    set: vi.fn(async (...args: unknown[]) =>
      args.includes('NX') && options.throttled ? null : 'OK',
    ),
  };
  const enqueue = vi.fn(async () => 'job');
  const service = new WorkoutLinkDispatcherService(
    db,
    journal,
    access,
    { create: vi.fn(async () => 'aB3xK9pQ') } as unknown as ShortLinkService,
    { enqueue } as unknown as QueueManager,
    { whatsapp: { publicSiteUrl: 'https://movivo.test' } } as unknown as AppConfigService,
    redis as never,
    {
      forUser: (id: string, ...p: string[]) => `u:${id}:${p.join(':')}`,
    } as unknown as RedisKeyBuilder,
    { setContext: vi.fn(), info: vi.fn() } as never,
  );
  return { service, journal, access, redis, enqueue, order };
}

// 2026-10-20T18:30Z = 15:30 em São Paulo.
const AFTERNOON = new Date('2026-10-20T18:30:00.000Z');

describe('WorkoutLinkDispatcherService.prepare', () => {
  it('gera o balão com a saudação do horário local do aluno', async () => {
    const { service } = make({});
    const prepared = await service.prepare(USER_ID, 'ON_DEMAND', AFTERNOON);
    expect(prepared).toMatchObject({ status: 'READY', focus: 'Costas e Bíceps', sessionKey: 'A' });
    if (prepared.status === 'READY') {
      expect(prepared.text).toMatch(/^Boa tarde, \*Gabriel\*!/);
      expect(prepared.text).toContain('https://movivo.test/check-in/aB3xK9pQ');
    }
  });

  it('usa o fuso do aluno, não o do servidor: de madrugada em Manaus é "Boa noite"', async () => {
    // 2026-10-20T06:30Z = 02:30 em Manaus (UTC-4) e 03:30 em São Paulo.
    const { service } = make({ timezone: 'America/Manaus' });
    const prepared = await service.prepare(
      USER_ID,
      'ON_DEMAND',
      new Date('2026-10-20T06:30:00.000Z'),
    );
    expect(prepared.status === 'READY' && prepared.text).toMatch(/^Boa noite,/);
  });

  it('revoga os links anteriores ANTES de criar o novo', async () => {
    const { service, order } = make({});
    await service.prepare(USER_ID, 'REFRESH', AFTERNOON);
    expect(order).toEqual(['revoke', 'create']);
  });

  it('marca o dia como decidido para a varredura das 04:00 não reenviar', async () => {
    const { service, redis } = make({});
    await service.prepare(USER_ID, 'ON_DEMAND', AFTERNOON);
    expect(redis.set).toHaveBeenCalledWith(
      `u:${USER_ID}:workout-daily:decided:2026-10-20`,
      '1',
      'EX',
      expect.any(Number),
    );
  });

  it('o texto de cada motivo é diferente (troca avisa que o anterior deixou de valer)', async () => {
    const refresh = await make({}).service.prepare(USER_ID, 'REFRESH', AFTERNOON);
    const resend = await make({}).service.prepare(USER_ID, 'RESEND', AFTERNOON);
    expect(refresh.status === 'READY' && refresh.text).toContain('exercício atualizado');
    expect(resend.status === 'READY' && resend.text).toContain(
      'link do seu check-in diário de hoje',
    );
  });

  it('não gera link sem treino hoje, com treino já concluído ou sem protocolo', async () => {
    expect(await make({ workout: null }).service.prepare(USER_ID, 'ON_DEMAND', AFTERNOON)).toEqual({
      status: 'NO_WORKOUT_TODAY',
    });
    expect(
      await make({ workout: workout({ status: 'COMPLETED' }) }).service.prepare(
        USER_ID,
        'RESEND',
        AFTERNOON,
      ),
    ).toEqual({ status: 'ALREADY_DONE', focus: 'Costas e Bíceps' });
    expect(await make({ noProtocol: true }).service.prepare(USER_ID, 'RESEND', AFTERNOON)).toEqual({
      status: 'NO_PROTOCOL',
    });
    expect(await make({ noStudent: true }).service.prepare(USER_ID, 'RESEND', AFTERNOON)).toEqual({
      status: 'NO_PROTOCOL',
    });
  });

  it('antes de gerar o link, atualiza o treino de hoje para refletir o protocolo vigente', async () => {
    const { service, journal } = make({});
    await service.prepare(USER_ID, 'RESEND', AFTERNOON);
    expect(journal.refreshPlannedSession).toHaveBeenCalledWith(USER_ID, '2026-10-20', AFTERNOON);
  });

  it('REFRESH de quem já começou a treinar não gera link: a atualização vale no próximo treino', async () => {
    const { service, access } = make({ workout: workout({ status: 'IN_PROGRESS' }) });
    expect(await service.prepare(USER_ID, 'REFRESH', AFTERNOON)).toEqual({
      status: 'ALREADY_STARTED',
    });
    expect(access.revokePendingMagicLinks).not.toHaveBeenCalled();
  });

  it('não revoga nada quando não há link a gerar', async () => {
    const { service, access } = make({ workout: null });
    await service.prepare(USER_ID, 'ON_DEMAND', AFTERNOON);
    expect(access.revokePendingMagicLinks).not.toHaveBeenCalled();
  });

  it('segura o reenvio repetido em poucos segundos sem tocar nos links', async () => {
    const { service, access } = make({ throttled: true });
    expect(await service.prepare(USER_ID, 'RESEND', AFTERNOON)).toEqual({ status: 'THROTTLED' });
    expect(access.revokePendingMagicLinks).not.toHaveBeenCalled();
  });

  it('treino em andamento ainda recebe o link (ele pode ter perdido o anterior)', async () => {
    const { service } = make({ workout: workout({ status: 'IN_PROGRESS' }) });
    expect(await service.prepare(USER_ID, 'RESEND', AFTERNOON)).toMatchObject({
      status: 'READY',
      workoutStatus: 'IN_PROGRESS',
    });
  });
});

describe('WorkoutLinkDispatcherService.prepareLateLog', () => {
  const late = { workoutId: 'w-late', date: '2026-10-19', focus: 'Costas e Bíceps' };

  it('gera o link do registro tardio apontando para o dia do treino, com saudação do horário local', async () => {
    const { service, access } = make({});
    const prepared = await service.prepareLateLog(
      USER_ID,
      { ...late, date: '2026-10-19' },
      AFTERNOON,
    );
    expect(access.createMagicLink).toHaveBeenCalledWith(USER_ID, 'w-late', { date: '2026-10-19' });
    expect(prepared?.text).toMatch(/^Boa tarde, \*Gabriel\*!/);
    expect(prepared?.text).toContain('https://movivo.test/check-in/aB3xK9pQ');
    expect(prepared?.text).toContain('sem cronômetro');
  });

  it('não revoga os outros links: o link de hoje continua valendo', async () => {
    const { service, access } = make({});
    await service.prepareLateLog(USER_ID, late, AFTERNOON);
    expect(access.revokePendingMagicLinks).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-10-19', 'treino de ontem'],
    ['2026-10-18', 'treino de anteontem'],
    ['2026-10-17', 'treino de sábado'],
  ])('descreve o dia %s como "%s"', async (date, expected) => {
    // Hoje é 2026-10-20 em São Paulo: ontem é 19, anteontem 18; 17/10 é sábado.
    const { service } = make({});
    const prepared = await service.prepareLateLog(USER_ID, { ...late, date }, AFTERNOON);
    expect(prepared?.text).toContain(expected);
  });

  it('sem aluno, não há o que gerar', async () => {
    const { service } = make({ noStudent: true });
    expect(await service.prepareLateLog(USER_ID, late, AFTERNOON)).toBeNull();
  });
});

describe('WorkoutLinkDispatcherService.send', () => {
  it('enfileira o balão como link do dia, com id de deduplicação próprio', async () => {
    const { service, enqueue } = make({});
    await service.send(USER_ID, 'ON_DEMAND', AFTERNOON);
    expect(enqueue).toHaveBeenCalledWith(
      expect.any(String),
      'workout-daily-link',
      expect.objectContaining({
        userId: USER_ID,
        type: 'WORKOUT_DAILY_LINK',
        dedupeId: expect.stringMatching(/^workout-link-on_demand-/),
      }),
      expect.objectContaining({ jobId: expect.stringMatching(/^wa-workout-link-on_demand-/) }),
    );
  });

  it('não enfileira nada quando o link não pôde ser gerado', async () => {
    const { service, enqueue } = make({ workout: null });
    await service.send(USER_ID, 'ON_DEMAND', AFTERNOON);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
