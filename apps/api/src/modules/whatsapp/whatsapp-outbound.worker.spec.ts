import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import { conversations } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { OutboundMessage, WhatsappTransport } from './whatsapp-transport';
import { WhatsappOutboundWorker, type WhatsappOutboundJob } from './whatsapp-outbound.worker';

const USER_ID = '11111111-1111-4111-8111-111111111111';

interface Deps {
  staffPhone?: string;
  phone?: string | null;
  name?: string | null;
  markerExists?: boolean;
  consentActive?: boolean;
  /** Linhas gravadas em `conversations` (histórico da aba "Conversas"). */
  inserted?: { table: unknown; values: unknown }[];
  /** Simula falha na gravação do histórico. */
  insertFails?: boolean;
}

/** tx falso: a linha de `users` carrega telefone e nome juntos (cada leitura projeta o que quer). */
function makeTx(deps: Deps) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    insert: (t: unknown) => ({
      values: (values: unknown) => {
        if (deps.insertFails) return Promise.reject(new Error('db fora do ar'));
        deps.inserted?.push({ table: t, values });
        return Promise.resolve();
      },
    }),
    limit: () =>
      Promise.resolve(
        deps.phone === null
          ? []
          : [
              {
                phoneNumber: deps.phone ?? '+5541999999999',
                name: deps.name === undefined ? 'Ana Beatriz' : deps.name,
              },
            ],
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
    whatsapp: { publicSiteUrl: 'https://movivo.test', staffQueueAlertPhone: deps.staffPhone },
  } as unknown as AppConfigService;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  const emitMessage = vi.fn();
  const worker = new WhatsappOutboundWorker(
    workers,
    db,
    redis,
    new RedisKeyBuilder('movivo'),
    transport,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
    config,
    logger,
    {
      encryptText: vi.fn(async (text: string) => `enc(${text})`),
    } as unknown as HealthCipherService,
    { emitMessage } as unknown as ConversationEventsService,
  );
  return { worker, send, sendTemplate, sendTyping, redis, emitMessage };
}

function job(data: Partial<WhatsappOutboundJob>): Job<WhatsappOutboundJob> {
  return { data: { userId: USER_ID, type: 'CONFIRMATION', ...data } } as Job<WhatsappOutboundJob>;
}

describe('WhatsappOutboundWorker.process', () => {
  it('PHONE_VERIFICATION: usa Template (fora da janela de 24h), não texto livre', async () => {
    const { worker, send, sendTemplate } = makeWorker();

    const result = await worker.process(
      job({
        userId: null,
        type: 'PHONE_VERIFICATION',
        phoneNumber: '+5541988887777',
        code: '482915',
      }),
    );

    expect(result).toEqual({ status: 'SENT' });
    expect(sendTemplate).toHaveBeenCalledWith('+5541988887777', 'verificacao_numero', ['482915']);
    expect(send).not.toHaveBeenCalled();
  });

  it('PHONE_VERIFICATION sem telefone ou código: descarta sem enviar', async () => {
    const { worker, send, sendTemplate } = makeWorker();

    expect(await worker.process(job({ userId: null, type: 'PHONE_VERIFICATION' }))).toEqual({
      status: 'INVALID',
    });
    expect(send).not.toHaveBeenCalled();
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('STAFF_QUEUE_ALERT: manda o texto ao número da equipe (não ao aluno) e marca como enviado', async () => {
    const { worker, send, redis } = makeWorker({ staffPhone: '+5511900000000' });

    const result = await worker.process(
      job({
        userId: null,
        type: 'STAFF_QUEUE_ALERT',
        text: 'Novo caso na fila MOVIVO',
        dedupeId: 'c1',
      }),
    );

    expect(result).toEqual({ status: 'SENT' });
    expect(send).toHaveBeenCalledWith({ to: '+5511900000000', text: 'Novo caso na fila MOVIVO' });
    expect(redis.set).toHaveBeenCalled();
  });

  it('STAFF_QUEUE_ALERT: sem número configurado fica desligado e não envia', async () => {
    const { worker, send } = makeWorker();

    const result = await worker.process(
      job({ userId: null, type: 'STAFF_QUEUE_ALERT', text: 'x', dedupeId: 'c1' }),
    );

    expect(result).toEqual({ status: 'DISABLED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('STAFF_QUEUE_ALERT: alerta já enviado não reenvia', async () => {
    const { worker, send } = makeWorker({ staffPhone: '+5511900000000', markerExists: true });

    const result = await worker.process(
      job({ userId: null, type: 'STAFF_QUEUE_ALERT', text: 'x', dedupeId: 'c1' }),
    );

    expect(result).toEqual({ status: 'ALREADY_SENT' });
    expect(send).not.toHaveBeenCalled();
  });

  it('descarta outbound de saúde enfileirado antes da revogação', async () => {
    const { worker, send } = makeWorker({ consentActive: false });

    const result = await worker.process(job({ type: 'CONVERSATION_MESSAGE', text: 'oi' }));

    expect(result).toEqual({ status: 'CONSENT_REVOKED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('permite a confirmação de revogação mesmo sem consentimento ativo', async () => {
    const { worker, send } = makeWorker({ consentActive: false });

    const result = await worker.process(
      job({ type: 'CONSENT_STATUS', text: 'Consentimento revogado.' }),
    );

    expect(result).toEqual({ status: 'SENT' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('confirmação: envia uma bolha saudando pelo primeiro nome e marca como enviado', async () => {
    const { worker, send, redis } = makeWorker();

    const result = await worker.process(job({ type: 'CONFIRMATION' }));

    expect(result).toEqual({ status: 'SENT' });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].text).toMatch(/^Olá, Ana! 💚/);
    expect(redis.set).toHaveBeenCalled();
  });

  it('confirmação sem nome salvo: saúda genericamente', async () => {
    const { worker, send } = makeWorker({ name: null });
    await worker.process(job({ type: 'CONFIRMATION' }));
    expect(send.mock.calls[0]?.[0].text).toMatch(/^Olá! 💚/);
  });

  it('variante de cuidado é enviada para PAR-Q de risco', async () => {
    const { worker, send } = makeWorker();
    await worker.process(job({ type: 'CONFIRMATION_CARE' }));
    expect(send.mock.calls[0]?.[0].text).toMatch(/CREF/);
  });

  it('CONVERSATION_MESSAGE: envia o texto em bolhas, com botões de feedback só na última', async () => {
    const { worker, send } = makeWorker();

    await worker.process(
      job({ type: 'CONVERSATION_MESSAGE', text: 'Primeira\n---\nSegunda', feedback: true }),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].buttons).toBeUndefined();
    expect(send.mock.calls[1]?.[0].buttons).toBeDefined();
  });

  it('a mensagem enviada entra no histórico de conversas e o painel é avisado', async () => {
    const inserted: NonNullable<Deps['inserted']> = [];
    const { worker, emitMessage } = makeWorker({ inserted });

    await worker.process(job({ type: 'CONFIRMATION' }));

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.table).toBe(conversations);
    expect(inserted[0]?.values).toMatchObject({
      userId: USER_ID,
      direction: 'OUTBOUND',
      origin: 'SYSTEM',
      sourceType: 'CONFIRMATION',
    });
    expect(emitMessage).toHaveBeenCalledWith(USER_ID, 'OUTBOUND');
  });

  it('várias bolhas: cada bolha enviada vira uma linha do histórico', async () => {
    const inserted: NonNullable<Deps['inserted']> = [];
    const { worker } = makeWorker({ inserted });

    await worker.process(job({ type: 'CHECKIN_MESSAGE', text: 'A\n---\nB\n---\nC' }));

    expect(inserted).toHaveLength(3);
  });

  it('MANUAL_MESSAGE e CONVERSATION_MESSAGE não são regravados (quem os criou já gravou)', async () => {
    const inserted: NonNullable<Deps['inserted']> = [];
    const { worker, send } = makeWorker({ inserted });

    await worker.process(job({ type: 'MANUAL_MESSAGE', text: 'Oi, aqui é o profissional.' }));
    await worker.process(job({ type: 'CONVERSATION_MESSAGE', text: 'Resposta.', dedupeId: 'x' }));

    expect(send).toHaveBeenCalledTimes(2);
    expect(inserted).toHaveLength(0);
  });

  it('falha ao gravar o histórico não derruba o envio nem o marcador de idempotência', async () => {
    const { worker, send, redis, emitMessage } = makeWorker({ insertFails: true });

    const result = await worker.process(job({ type: 'CONFIRMATION' }));

    expect(result).toEqual({ status: 'SENT' });
    expect(send).toHaveBeenCalledOnce();
    expect(redis.set).toHaveBeenCalled();
    expect(emitMessage).not.toHaveBeenCalled();
  });

  it('TYPING: dispara o indicador de digitação, sem marcador nem texto', async () => {
    const { worker, send, sendTyping, redis } = makeWorker();

    const result = await worker.process(job({ type: 'TYPING' }));

    expect(result).toEqual({ status: 'TYPING' });
    expect(sendTyping).toHaveBeenCalledWith('+5541999999999');
    expect(send).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('idempotência: marcador presente → não reenvia', async () => {
    const { worker, send } = makeWorker({ markerExists: true });

    const result = await worker.process(job({ type: 'CONFIRMATION' }));

    expect(result).toEqual({ status: 'ALREADY_SENT' });
    expect(send).not.toHaveBeenCalled();
  });

  it('sem telefone → não envia', async () => {
    const { worker, send } = makeWorker({ phone: null });

    const result = await worker.process(job({ type: 'CONFIRMATION' }));

    expect(result).toEqual({ status: 'NO_PHONE' });
    expect(send).not.toHaveBeenCalled();
  });

  it('job sem titular (fora da verificação e do alerta) é descartado', async () => {
    const { worker, send } = makeWorker();

    expect(
      await worker.process(job({ userId: null, type: 'CONVERSATION_MESSAGE', text: 'x' })),
    ).toEqual({
      status: 'INVALID',
    });
    expect(send).not.toHaveBeenCalled();
  });
});
