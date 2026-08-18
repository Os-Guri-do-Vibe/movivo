import type { ProtocolStructure } from '@movivo/shared';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import { users } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { OutboundMessage, WhatsappTransport } from './whatsapp-transport';
import { WhatsappOutboundWorker, type WhatsappOutboundJob } from './whatsapp-outbound.worker';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function structure(): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'A',
        focus: 'Full',
        exercises: [
          {
            exerciseId: 'goblet_squat',
            name: 'Agachamento',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

interface Deps {
  phone?: string | null;
  proto?: {
    status: string;
    approvalStatus: string;
    signedAt?: Date;
    signatureHash?: string;
    professionalId?: string;
  } | null;
  markerExists?: boolean;
  consentActive?: boolean;
}

/** tx falso: distingue users/protocols pela tabela passada em `.from()`. */
function makeTx(deps: Deps) {
  let table: unknown;
  const proto =
    deps.proto === undefined
      ? {
          id: 'p1',
          content: structure(),
          status: 'ACTIVE',
          approvalStatus: 'AUTO_APPROVED',
          signedAt: new Date(),
          signatureHash: 'a'.repeat(64),
          professionalId: '00000000-0000-4000-8000-000000000001',
        }
      : deps.proto;
  const chain = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    limit: () =>
      Promise.resolve(
        table === users
          ? deps.phone === null
            ? []
            : [{ phoneNumber: deps.phone ?? '+5541999999999' }]
          : proto
            ? [proto]
            : [],
      ),
  };
  return chain;
}

function makeWorker(deps: Deps = {}) {
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const db = {
    runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx(deps)),
    ),
  } as unknown as TenantDatabase;
  const redis = {
    exists: vi.fn(() => Promise.resolve(deps.markerExists ? 1 : 0)),
    set: vi.fn(() => Promise.resolve('OK')),
  } as unknown as Redis;
  const keys = new RedisKeyBuilder('movivo');
  const send = vi.fn((_m: OutboundMessage) => Promise.resolve());
  const sendTyping = vi.fn((_to: string) => Promise.resolve());
  const sendTemplate = vi.fn((_to: string, _templateName: string, _variables?: readonly string[]) =>
    Promise.resolve(),
  );
  const transport = {
    send,
    sendTemplate,
    sendTyping,
    hasCredentials: () => true,
  } as unknown as WhatsappTransport;
  const config = {
    whatsapp: { publicSiteUrl: 'https://movivo.test', araraBaseUrl: '', araraApiKey: undefined },
  } as unknown as AppConfigService;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  const worker = new WhatsappOutboundWorker(
    workers,
    db,
    redis,
    keys,
    transport,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
    config,
    { agentName: vi.fn(async () => 'MOVI') } as never,
    logger,
  );
  return { worker, send, sendTemplate, sendTyping, redis };
}

function job(data: Partial<WhatsappOutboundJob>): Job<WhatsappOutboundJob> {
  return { data: { userId: USER_ID, type: 'CONFIRMATION', ...data } } as Job<WhatsappOutboundJob>;
}

describe('WhatsappOutboundWorker.process (US-2.5)', () => {
  it('PHONE_VERIFICATION: usa Template (fora da janela de 24h), não texto livre', async () => {
    const { worker, send, sendTemplate } = makeWorker();
    const res = await worker.process(
      job({
        userId: null,
        type: 'PHONE_VERIFICATION',
        phoneNumber: '+5541999999999',
        code: '123456',
      }),
    );
    expect(res.status).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledWith('+5541999999999', 'verificacao_numero', ['123456']);
    expect(send).not.toHaveBeenCalled();
  });

  it('PHONE_VERIFICATION sem telefone ou código: descarta sem enviar', async () => {
    const { worker, sendTemplate } = makeWorker();
    const res = await worker.process(job({ userId: null, type: 'PHONE_VERIFICATION' }));
    expect(res.status).toBe('INVALID');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('descarta outbound de saude enfileirado antes da revogacao', async () => {
    const { worker, send } = makeWorker({ consentActive: false });
    await expect(
      worker.process(job({ type: 'CHECKIN_MESSAGE', text: 'check-in' })),
    ).resolves.toEqual({ status: 'CONSENT_REVOKED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('permite confirmacao de revogacao mesmo sem consentimento ativo', async () => {
    const { worker, send } = makeWorker({ consentActive: false });
    await expect(
      worker.process(job({ type: 'CONSENT_STATUS', text: 'consentimento revogado' })),
    ).resolves.toEqual({ status: 'SENT' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('confirmação: envia uma bolha e marca como enviado', async () => {
    const { worker, send, redis } = makeWorker();
    const res = await worker.process(job({ type: 'CONFIRMATION' }));
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalled();
  });

  it('variante de cuidado é enviada para PAR-Q de risco', async () => {
    const { worker, send } = makeWorker();
    await worker.process(job({ type: 'CONFIRMATION_CARE' }));
    expect(send.mock.calls[0]?.[0]?.text).toMatch(/revisar/i);
  });

  it('COACH_MESSAGE: envia o texto dinâmico em bolhas (US-3.5)', async () => {
    const { worker, send } = makeWorker();
    const res = await worker.process(
      job({ type: 'COACH_MESSAGE', text: 'Oi!\n---\nComo foi o treino?', dedupeId: 'c1' }),
    );
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('TYPING: dispara o indicador de digitação, sem marcador nem texto (US-3.5)', async () => {
    const { worker, send, sendTyping } = makeWorker();
    const res = await worker.process(job({ type: 'TYPING' }));
    expect(res.status).toBe('TYPING');
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('entrega AUTO_APPROVED/ACTIVE: envia 3 bolhas com link e emite protocol_sent', async () => {
    const { worker, send } = makeWorker();
    const res = await worker.process(
      job({ type: 'PROTOCOL_DELIVERY', protocolId: 'p1', protocolVersion: 1 }),
    );
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[0]?.text).toContain('https://movivo.test/protocolo/p1');
  });

  it('entrega bloqueada: protocolo não aprovado não envia nada', async () => {
    const { worker, send } = makeWorker({
      proto: { status: 'PENDING_SIGNATURE', approvalStatus: 'PENDING_REVIEW' },
    });
    const res = await worker.process(job({ type: 'PROTOCOL_DELIVERY', protocolVersion: 1 }));
    expect(res.status).toBe('SKIPPED');
    expect(send).not.toHaveBeenCalled();
  });

  it('idempotência: marcador presente → não reenvia', async () => {
    const { worker, send } = makeWorker({ markerExists: true });
    const res = await worker.process(job({ type: 'PROTOCOL_DELIVERY', protocolVersion: 1 }));
    expect(res.status).toBe('ALREADY_SENT');
    expect(send).not.toHaveBeenCalled();
  });

  it('sem telefone → não envia', async () => {
    const { worker, send } = makeWorker({ phone: null });
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('NO_PHONE');
    expect(send).not.toHaveBeenCalled();
  });

  it('espera (30min de atraso): sem protocolo aprovado ainda, envia a mensagem', async () => {
    const { worker, send } = makeWorker({ proto: null });
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('espera (30min de atraso): profissional já aprovou nesse meio tempo → não reenvia nada', async () => {
    // Default de `makeTx` já é um protocolo ACTIVE/AUTO_APPROVED — reconfirmado na hora
    // do envio (não só no enqueue), então a mensagem de "ainda estou preparando" não sai
    // depois que a entrega real já resolveu.
    const { worker, send } = makeWorker({});
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('SKIPPED');
    expect(send).not.toHaveBeenCalled();
  });
});
