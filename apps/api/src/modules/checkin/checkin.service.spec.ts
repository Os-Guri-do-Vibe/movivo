import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkoutCompletionService } from '../workout/workout-completion.service';
import { CheckinService } from './checkin.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROTOCOL_ID = '22222222-2222-4222-8222-222222222222';
const CHECKIN_ID = '33333333-3333-4333-8333-333333333333';

function makeService(
  existing: { id: string; sentAt: Date | null } | undefined,
  inserted?: { id: string; sentAt: Date | null },
  consentActive = true,
) {
  const returning = vi.fn(async () => (inserted ? [inserted] : []));
  const insertChain = {
    values: () => ({ onConflictDoNothing: () => ({ returning }) }),
  };
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => (existing ? [existing] : []),
  };
  const updateWhere = vi.fn(async (_args?: unknown[]) => []);
  const tx = {
    insert: () => insertChain,
    select: () => selectChain,
    update: () => ({ set: () => ({ where: updateWhere }) }),
  } as never;
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as TenantDatabase;
  const cipher = {
    encryptHealth: vi.fn(async () => Buffer.from('cipher')),
  } as unknown as HealthCipherService;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as PinoLogger;
  const consent = {
    hasActiveForUser: vi.fn(async () => consentActive),
  } as unknown as HealthConsentService;
  return {
    service: new CheckinService(
      db,
      cipher,
      consent,
      queues,
      { emit: vi.fn() } as unknown as DashboardQueueEventsService,
      {
        recordFromCheckin: vi.fn(async () => 0),
      } as unknown as WorkoutCompletionService,
      logger,
    ),
    enqueue,
    updateWhere,
  };
}

function makeInteractiveService(
  selections: unknown[][],
  decrypted: string[] = [JSON.stringify({})],
  consentActive = true,
  advanceSucceeds = true,
) {
  const updateWhere = vi.fn(async (_args?: unknown[]) => []);
  const insertConflict = vi.fn(async () => []);
  const tx = {
    select: vi.fn(() => {
      const result = selections.shift() ?? [];
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        for: () => chain,
        orderBy: () => chain,
        limit: async () => result,
      };
      return chain;
    }),
    update: () => ({
      set: () => ({
        where: (...args: unknown[]) => {
          updateWhere(args);
          return { returning: async () => (advanceSucceeds ? [{ id: CHECKIN_ID }] : []) };
        },
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: insertConflict }) }),
  } as never;
  const runAsUser = vi.fn(
    (_id: string, _role: string, callback: (value: unknown) => Promise<unknown>) => callback(tx),
  );
  const db = { runAsUser } as unknown as TenantDatabase;
  const encryptHealth = vi.fn(async () => Buffer.from('encrypted'));
  const decryptHealth = vi.fn(async () => decrypted.shift() ?? JSON.stringify({}));
  const cipher = { encryptHealth, decryptHealth } as unknown as HealthCipherService;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as PinoLogger;
  return {
    service: new CheckinService(
      db,
      cipher,
      {
        hasActiveForUser: vi.fn(async () => consentActive),
      } as unknown as HealthConsentService,
      queues,
      { emit: vi.fn() } as unknown as DashboardQueueEventsService,
      {
        recordFromCheckin: vi.fn(async () => 0),
      } as unknown as WorkoutCompletionService,
      logger,
    ),
    enqueue,
    encryptHealth,
    decryptHealth,
    updateWhere,
    insertConflict,
    runAsUser,
  };
}

describe('CheckinService.createAndSend', () => {
  it('recupera linha criada antes de enqueue falho quando sentAt ainda e nulo', async () => {
    const { service, enqueue, updateWhere } = makeService({ id: CHECKIN_ID, sentAt: null });
    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 3)).resolves.toBe('SENT');
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'checkin-message',
      expect.objectContaining({ dedupeId: `${CHECKIN_ID}-q1` }),
      expect.objectContaining({ jobId: `wa-${USER_ID}-${CHECKIN_ID}-q1` }),
    );
    expect(updateWhere).toHaveBeenCalledOnce();
  });

  it('nao reenvia quando o marcador duravel sentAt ja existe', async () => {
    const { service, enqueue } = makeService({ id: CHECKIN_ID, sentAt: new Date() });
    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 3)).resolves.toBe('EXISTS');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('usa a linha inserida no caminho nominal', async () => {
    const { service, enqueue } = makeService(undefined, { id: CHECKIN_ID, sentAt: null });
    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 1)).resolves.toBe('SENT');
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'checkin-message',
      expect.objectContaining({ dedupeId: `${CHECKIN_ID}-q1` }),
      expect.any(Object),
    );
  });

  it('nao envia quando conflito nao encontra registro recuperavel', async () => {
    const { service, enqueue } = makeService(undefined);
    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 1)).resolves.toBe('EXISTS');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('nao cria nem envia check-in depois da revogacao', async () => {
    const { service, enqueue } = makeService(undefined, undefined, false);
    await expect(service.createAndSend(USER_ID, PROTOCOL_ID, 1)).resolves.toBe('NO_CONSENT');
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('CheckinService fluxo conversacional', () => {
  it('ignora texto comum e dor quando nao existe check-in aberto', async () => {
    const { service } = makeInteractiveService([[]]);
    await expect(service.tryHandleInbound(USER_ID, undefined, 'ola')).resolves.toBe(false);
    await expect(
      service.tryHandleInbound(USER_ID, undefined, 'estou com dor no joelho'),
    ).resolves.toBe(false);
  });

  it('antecipa check-in somente para protocolo e assinatura ativos', async () => {
    const createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
    const { service, enqueue } = makeInteractiveService([
      [{ protocolId: PROTOCOL_ID, createdAt, totalWeeks: 8 }],
    ]);
    await expect(service.tryHandleInbound(USER_ID, 'checkin:anticipated', '')).resolves.toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      'checkin-weekly',
      'checkin-anticipated',
      expect.objectContaining({ kind: 'SEND', weekNumber: 2 }),
      expect.any(Object),
    );
  });

  it('encerra antecipacao silenciosamente quando usuario nao e elegivel', async () => {
    const { service, enqueue } = makeInteractiveService([[]]);
    await service.startAnticipated(USER_ID);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('percorre as tres perguntas e conclui sem ajuste automatico', async () => {
    const row = (currentQuestion: number) => ({
      id: CHECKIN_ID,
      responsesCipher: Buffer.from('x'),
      completedAt: null,
      currentQuestion,
    });
    const { service, enqueue, updateWhere } = makeInteractiveService(
      [[row(1)], [row(2)], [row(3)]],
      [
        JSON.stringify({}),
        JSON.stringify({ fatigue: 'ADEQUADO' }),
        JSON.stringify({ fatigue: 'ADEQUADO', workouts: 'TRES_MAIS' }),
      ],
    );

    await expect(
      service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:fatigue:ADEQUADO`, ''),
    ).resolves.toBe(true);
    await expect(
      service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:workouts:TRES_MAIS`, ''),
    ).resolves.toBe(true);
    await expect(
      service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:adjustment:MANTER`, ''),
    ).resolves.toBe(true);

    expect(updateWhere).toHaveBeenCalledTimes(6);
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenLastCalledWith(
      'whatsapp-outbound',
      'checkin-message',
      expect.objectContaining({ dedupeId: `${CHECKIN_ID}-done` }),
      expect.any(Object),
    );
  });

  it('cria alerta por ajuste solicitado e por baixa aderencia recorrente', async () => {
    const row = {
      id: CHECKIN_ID,
      responsesCipher: Buffer.from('x'),
      completedAt: null,
      currentQuestion: 3,
    };
    const priorId = '44444444-4444-4444-8444-444444444444';
    const { service, insertConflict, enqueue } = makeInteractiveService(
      [[row], [{ id: priorId, responsesCipher: Buffer.from('prior') }]],
      [
        JSON.stringify({ fatigue: 'PESADO', workouts: 'NENHUM' }),
        JSON.stringify({ workouts: 'UM_DOIS' }),
      ],
    );
    await service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:adjustment:REDUZIR`, '');
    expect(insertConflict).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('roteia dor de check-in aberto para SAFETY e preserva relato cifrado', async () => {
    const open = { id: CHECKIN_ID, responsesCipher: Buffer.from('x') };
    const owned = { ...open, completedAt: null };
    const { service, enqueue, insertConflict, encryptHealth, runAsUser } = makeInteractiveService(
      [[open], [owned]],
      [JSON.stringify({ fatigue: 'ADEQUADO' })],
    );
    await expect(
      service.tryHandleInbound(USER_ID, undefined, 'Senti uma fisgada no ombro'),
    ).resolves.toBe(true);
    expect(encryptHealth).toHaveBeenCalledWith(expect.stringContaining('fisgada no ombro'));
    expect(insertConflict).toHaveBeenCalledOnce();
    // Uma leitura localiza o check-in; persistência cifrada + SAFETY compartilham
    // a segunda e única transação de escrita.
    expect(runAsUser).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'checkin-message',
      expect.objectContaining({ dedupeId: `${CHECKIN_ID}-safety` }),
      expect.any(Object),
    );
  });

  it('nao envia orientacao se a transacao atomica de SAFETY falhar', async () => {
    const open = { id: CHECKIN_ID, responsesCipher: Buffer.from('x') };
    const owned = { ...open, completedAt: null };
    const { service, enqueue, insertConflict } = makeInteractiveService(
      [[open], [owned]],
      [JSON.stringify({})],
    );
    insertConflict.mockRejectedValueOnce(new Error('rollback'));
    await expect(service.tryHandleInbound(USER_ID, undefined, 'dor no quadril')).rejects.toThrow(
      'rollback',
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('ignora botao pertencente a check-in ausente ou ja concluido', async () => {
    const completed = {
      id: CHECKIN_ID,
      responsesCipher: Buffer.from('x'),
      completedAt: new Date(),
      currentQuestion: 4,
    };
    const { service, enqueue } = makeInteractiveService([[], [completed]]);
    await service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:fatigue:LEVE`, '');
    await service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:fatigue:LEVE`, '');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('limita o numero da semana ao intervalo do protocolo', () => {
    const { service } = makeInteractiveService([]);
    expect(service.weekNumber(new Date(Date.now() + 86_400_000), 8)).toBe(1);
    expect(service.weekNumber(new Date(Date.now() - 100 * 86_400_000), 8)).toBe(8);
  });

  it('ignora quick reply fora de ordem sem persistir nem responder', async () => {
    const row = {
      id: CHECKIN_ID,
      responsesCipher: Buffer.from('x'),
      completedAt: null,
      currentQuestion: 1,
    };
    const { service, enqueue, updateWhere } = makeInteractiveService([[row]]);
    await service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:adjustment:MANTER`, '');
    expect(updateWhere).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('nao avanca nem envia em replay perdido pelo compare-and-set', async () => {
    const row = {
      id: CHECKIN_ID,
      responsesCipher: Buffer.from('x'),
      completedAt: null,
      currentQuestion: 1,
    };
    const { service, enqueue } = makeInteractiveService([[row]], [JSON.stringify({})], true, false);
    await service.tryHandleInbound(USER_ID, `checkin:${CHECKIN_ID}:fatigue:LEVE`, '');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(['sem dor', 'meu joelho esta otimo', 'mobilidade articular'])(
    'nao classifica texto seguro como SAFETY: %s',
    async (text) => {
      const { service, enqueue } = makeInteractiveService([]);
      await expect(service.tryHandleInbound(USER_ID, undefined, text)).resolves.toBe(false);
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it.each(['dor no quadril', 'desconforto forte no tornozelo'])(
    'encaminha sinal conservador para SAFETY: %s',
    async (text) => {
      const open = { id: CHECKIN_ID, responsesCipher: Buffer.from('x') };
      const owned = { ...open, completedAt: null, currentQuestion: 1 };
      const { service, enqueue } = makeInteractiveService([[open], [owned]], [JSON.stringify({})]);
      await expect(service.tryHandleInbound(USER_ID, undefined, text)).resolves.toBe(true);
      expect(enqueue).toHaveBeenCalledWith(
        'whatsapp-outbound',
        'checkin-message',
        expect.objectContaining({ dedupeId: `${CHECKIN_ID}-safety` }),
        expect.any(Object),
      );
    },
  );
});
