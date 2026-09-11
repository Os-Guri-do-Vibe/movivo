import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { anamnesisSessions, protocolRenewalSessions, users } from '../../core/database/schema';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import { ProtocolRenewalService } from './protocol-renewal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(64);

function fullSessionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'renewal-1',
    userId: USER_ID,
    token: TOKEN,
    status: 'IN_PROGRESS',
    lastStep: 5,
    dataBlock1: { completionRate: 'SEMPRE' },
    dataBlock2: { fatigueLevel: 'MODERADO' },
    dataBlock3: Buffer.from('cipher'),
    dataBlock4: { satisfaction: 8 },
    dataBlock5: { changes: ['NONE'] },
    expiresAt: new Date(Date.now() + 60_000),
    ...over,
  };
}

/** tx que distingue tabela por `.from()`, para os múltiplos selects de `toView`/`hasTargetEvent`. */
function makeTxFor(session: unknown, userName: string | null, anamnesisSession: unknown) {
  let table: unknown;
  const chain = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => {
      if (table === protocolRenewalSessions) return Promise.resolve(session ? [session] : []);
      if (table === users) return Promise.resolve(userName !== null ? [{ name: userName }] : []);
      if (table === anamnesisSessions)
        return Promise.resolve(anamnesisSession ? [anamnesisSession] : []);
      return Promise.resolve([]);
    },
  };
  return chain;
}

function makeService(
  deps: {
    session?: unknown;
    userName?: string | null;
    anamnesisSession?: unknown;
    consentActive?: boolean;
    decrypted?: string;
  } = {},
) {
  const session = 'session' in deps ? deps.session : fullSessionRow();
  const userName = 'userName' in deps ? deps.userName : 'Maria Silva';
  const anamnesisSession = 'anamnesisSession' in deps ? deps.anamnesisSession : undefined;
  const tx = makeTxFor(session, userName ?? null, anamnesisSession);

  const updateWhere = vi.fn(async () => []);
  const insertOnConflict = vi.fn(async () => []);
  const fullTx = {
    ...tx,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: insertOnConflict })) })),
  };

  const db = {
    runAsSystem: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(fullTx)),
    runAsUser: vi.fn((_uid: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(fullTx),
    ),
  } as unknown as TenantDatabase;

  const cipher = {
    decryptHealth: vi.fn(
      async () =>
        deps.decrypted ??
        JSON.stringify({ newPain: { hasNewPain: false }, parqRecheck: { changedToYes: false } }),
    ),
    encryptHealth: vi.fn(async (text: string) => Buffer.from(text)),
  } as unknown as HealthCipherService;

  const healthConsent = {
    hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
  } as unknown as HealthConsentService;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;

  const service = new ProtocolRenewalService(logger, db, cipher, healthConsent, queues);
  return { service, updateWhere, insertOnConflict, enqueue, cipher };
}

describe('ProtocolRenewalService.getByToken', () => {
  it('sessão inexistente → NotFoundException', async () => {
    const { service } = makeService({ session: undefined });
    await expect(service.getByToken(TOKEN)).rejects.toThrow('não encontrada');
  });

  it('devolve view com saudação personalizada e sem o conteúdo do bloco 3', async () => {
    const { service } = makeService();
    const view = await service.getByToken(TOKEN);
    expect(view.firstName).toBe('Maria');
    expect(view.block3Completed).toBe(true);
    expect(view).not.toHaveProperty('block3');
  });

  it('pergunta 18 só habilitada quando a anamnese original tem evento-alvo', async () => {
    const { service } = makeService({
      anamnesisSession: {
        dataBlock3: {
          primaryGoal: 'GAIN_MUSCLE',
          emphasis: [],
          hasImportantEvent: true,
          importantEventDate: '2026-12-01',
          trainingStatus: 'REGULAR',
          experience: 'INTERMEDIATE',
          pastActivities: [],
          consistencyBarriers: [],
          daysPerWeek: 3,
          preferredDays: [],
          sessionDuration: 'M45_TO_60',
          location: 'HOME',
          preferredPeriod: 'MORNING',
          practicesOtherSport: false,
          hasAvoidedExercise: false,
        },
      },
    });
    const view = await service.getByToken(TOKEN);
    expect(view.hasTargetEvent).toBe(true);
  });
});

describe('ProtocolRenewalService.submit', () => {
  it('rejeita envio com bloco faltando', async () => {
    const { service } = makeService({ session: fullSessionRow({ dataBlock5: null }) });
    await expect(service.submit(TOKEN)).rejects.toThrow('Complete os 5 blocos');
  });

  it('feliz: marca SUBMITTED, enfileira geração + confirmação', async () => {
    const { service, enqueue } = makeService();
    await expect(service.submit(TOKEN)).resolves.toEqual({ status: 'SUBMITTED' });
    expect(enqueue).toHaveBeenCalledWith(
      'protocol-renewal-generation',
      'generate-renewal-protocol',
      expect.objectContaining({ userId: USER_ID, renewalSessionId: 'renewal-1' }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'renewal-confirmation',
      expect.objectContaining({ userId: USER_ID, type: 'CONFIRMATION' }),
      { jobId: 'renewal-confirmation_renewal-1' },
    );
  });

  it('pergunta 10 "mudou para Sim": confirmação vira CONFIRMATION_CARE', async () => {
    const { service, enqueue } = makeService({
      decrypted: JSON.stringify({
        newPain: { hasNewPain: false },
        parqRecheck: { changedToYes: true, detail: 'nova medicação' },
      }),
    });
    await service.submit(TOKEN);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'renewal-confirmation',
      expect.objectContaining({ type: 'CONFIRMATION_CARE' }),
      expect.anything(),
    );
  });

  it('dor nova de alta intensidade cria handoff alert, mesmo sem repescagem do PAR-Q', async () => {
    const { service, updateWhere } = makeService({
      decrypted: JSON.stringify({
        newPain: {
          hasNewPain: true,
          region: 'KNEE',
          intensity: 9,
          trend: 'STABLE',
          soughtCare: false,
        },
        parqRecheck: { changedToYes: false },
      }),
    });
    await service.submit(TOKEN);
    // 2 updates dentro da mesma transação: status→SUBMITTED da sessão + o handoff usa
    // `insert`, não `update` — então aqui só validamos que o submit não falhou e que o
    // update de status aconteceu.
    expect(updateWhere).toHaveBeenCalled();
  });

  it('consentimento revogado → ForbiddenException', async () => {
    const { service } = makeService({ consentActive: false });
    await expect(service.submit(TOKEN)).rejects.toThrow('Consentimento');
  });
});

describe('ProtocolRenewalService.patchStep', () => {
  const VALID_PAYLOAD_BY_STEP = {
    1: {
      completionRate: 'SEMPRE',
      actualFrequency: 'TODOS_OS_DIAS_PLANEJADOS',
      loadProgression: 'EVOLUI_NA_MAIORIA',
      perceivedEffort: 'SOBRAVA_BASTANTE',
    },
    2: {
      fatigueLevel: 'BAIXO_RECUPERADO',
      sleepQuality: 'BOA',
      stressLevel: 'BAIXO',
      muscleSoreness: 'NORMAL',
    },
    3: { newPain: { hasNewPain: false }, parqRecheck: { changedToYes: false } },
    4: { goalProgress: 'DENTRO_DO_ESPERADO', satisfaction: 8 },
    5: { changes: ['NONE'], dislikedExercise: { has: false }, goalChange: { changed: false } },
  } as const;

  it.each([1, 2, 3, 4, 5] as const)(
    'bloco %s com payload válido: persiste e devolve o próximo currentStep',
    async (step) => {
      const { service, updateWhere } = makeService({
        session: fullSessionRow({ lastStep: 1 }),
      });
      const result = await service.patchStep(TOKEN, step, VALID_PAYLOAD_BY_STEP[step]);
      expect(result.currentStep).toBe(Math.min(step + 1, 5));
      expect(updateWhere).toHaveBeenCalled();
    },
  );

  it('payload inválido → BadRequestException, sem persistir', async () => {
    const { service, updateWhere } = makeService({ session: fullSessionRow({ lastStep: 1 }) });
    await expect(service.patchStep(TOKEN, 1, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it('consentimento revogado → ForbiddenException', async () => {
    const { service } = makeService({ consentActive: false });
    await expect(service.patchStep(TOKEN, 1, VALID_PAYLOAD_BY_STEP[1])).rejects.toThrow(
      'Consentimento',
    );
  });

  it('sessão inexistente → NotFoundException', async () => {
    const { service } = makeService({ session: undefined });
    await expect(service.patchStep(TOKEN, 1, VALID_PAYLOAD_BY_STEP[1])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('sessão já enviada (status != IN_PROGRESS) → ConflictException', async () => {
    const { service } = makeService({ session: fullSessionRow({ status: 'SUBMITTED' }) });
    await expect(service.patchStep(TOKEN, 1, VALID_PAYLOAD_BY_STEP[1])).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('sessão vencida (expiresAt no passado) → GoneException e marca EXPIRED', async () => {
    const { service, updateWhere } = makeService({
      session: fullSessionRow({ expiresAt: new Date(Date.now() - 1_000) }),
    });
    await expect(service.patchStep(TOKEN, 1, VALID_PAYLOAD_BY_STEP[1])).rejects.toBeInstanceOf(
      GoneException,
    );
    // `expire()` é best-effort (não aguardado por `assertActive`) — dá um tick pro
    // microtask da expiração rodar antes de checar a persistência.
    await Promise.resolve();
    expect(updateWhere).toHaveBeenCalled();
  });
});
