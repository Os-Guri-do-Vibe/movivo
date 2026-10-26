import type { Job } from 'bullmq';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { ConversationMediaStorage } from '../../core/database/conversation-media-storage.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import { RedisKeyBuilder } from '../../core/redis';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { EvolutionTransport } from './evolution-transport';
import { apiSentKey, type WhatsappMirrorJob } from './whatsapp-mirror.service';
import { WhatsappMirrorWorker } from './whatsapp-mirror.worker';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const keys = new RedisKeyBuilder('movivo');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('resto')]);
const ogg = Buffer.from('OggS-audio');

function build(
  opts: {
    apiSent?: boolean;
    media?: { base64: string; mimetype: string } | Error;
    instance?: string | null;
  } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  const deletes: unknown[] = [];
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: async () => undefined };
      },
    }),
    delete: () => ({
      where: async (cond: unknown) => {
        deletes.push(cond);
      },
    }),
  };
  const db = {
    runAsSystem: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as TenantDatabase;
  const storage = { save: vi.fn(async () => 'file.bin') };
  const emitMessage = vi.fn();
  const downloadMedia = vi.fn(async () => {
    if (opts.media instanceof Error) throw opts.media;
    return opts.media ?? { base64: png.toString('base64'), mimetype: 'image/png' };
  });
  const evolution = {
    lastKnownInstanceName: () => ('instance' in opts ? opts.instance : 'inst'),
    downloadMedia,
  } as unknown as EvolutionTransport;
  const redis = { exists: vi.fn(async () => (opts.apiSent ? 1 : 0)) };
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const worker = new WhatsappMirrorWorker(
    { create: vi.fn() } as unknown as WorkerFactory,
    db,
    storage as unknown as ConversationMediaStorage,
    { emitMessage } as unknown as ConversationEventsService,
    evolution,
    redis as never,
    keys,
    logger,
  );
  return { worker, updates, deletes, storage, emitMessage, downloadMedia, redis };
}

const job = (data: Partial<WhatsappMirrorJob>, attemptsMade = 0) =>
  ({
    data: {
      conversationId: ROW_ID,
      userId: USER_ID,
      messageId: 'WA-1',
      fromMe: false,
      ...data,
    },
    attemptsMade,
    opts: { attempts: 3 },
  }) as unknown as Job<WhatsappMirrorJob>;

describe('WhatsappMirrorWorker.process', () => {
  it('imagem: baixa, valida pela assinatura, guarda cifrada e libera para o painel', async () => {
    const { worker, updates, storage, emitMessage } = build();
    await expect(worker.process(job({ mediaKey: '{"id":"x"}' }))).resolves.toEqual({
      status: 'OK',
    });
    expect(storage.save).toHaveBeenCalledWith(png);
    expect(updates).toEqual([
      {
        mediaPath: 'file.bin',
        mediaMime: 'image/png',
        mediaBytes: png.length,
        mediaStatus: 'READY',
      },
    ]);
    expect(emitMessage).toHaveBeenCalledWith(USER_ID, 'INBOUND', ROW_ID);
  });

  it('áudio ogg com codec no mimetype guarda só o tipo base', async () => {
    const { worker, updates } = build({
      media: { base64: ogg.toString('base64'), mimetype: 'audio/ogg; codecs=opus' },
    });
    await worker.process(job({ mediaKey: '{}' }));
    expect(updates[0]).toMatchObject({ mediaMime: 'audio/ogg', mediaStatus: 'READY' });
  });

  it('rejeita tipo fora da lista, base64 inválido e conteúdo que não bate com o tipo', async () => {
    for (const media of [
      { base64: png.toString('base64'), mimetype: 'text/html' },
      { base64: '***não-base64***', mimetype: 'image/png' },
      { base64: Buffer.from('<script>').toString('base64'), mimetype: 'image/png' },
    ]) {
      const { worker, storage } = build({ media });
      await expect(worker.process(job({ mediaKey: '{}' }))).rejects.toThrow();
      expect(storage.save).not.toHaveBeenCalled();
    }
  });

  it('falha de download retenta; na última tentativa vira FAILED e o painel é avisado', async () => {
    const first = build({ media: new Error('timeout') });
    await expect(first.worker.process(job({ mediaKey: '{}' }, 0))).rejects.toThrow('timeout');
    expect(first.emitMessage).not.toHaveBeenCalled();

    const last = build({ media: new Error('timeout') });
    await expect(last.worker.process(job({ mediaKey: '{}' }, 2))).resolves.toEqual({
      status: 'MEDIA_FAILED',
    });
    expect(last.updates).toEqual([{ mediaStatus: 'FAILED' }]);
    expect(last.emitMessage).toHaveBeenCalledWith(USER_ID, 'INBOUND', ROW_ID);
  });

  it('sem instância da EvolutionAPI conhecida é falha como qualquer outra', async () => {
    const { worker } = build({ instance: null });
    await expect(worker.process(job({ mediaKey: '{}' }))).rejects.toThrow(/instância/);
  });

  it('digitada no celular e não enviada pela API: aparece no painel com o horário da confirmação', async () => {
    const { worker, updates, emitMessage, redis } = build();
    await expect(worker.process(job({ fromMe: true }))).resolves.toEqual({ status: 'OK' });
    expect(redis.exists).toHaveBeenCalledWith(apiSentKey(keys, 'WA-1'));
    expect(updates).toEqual([{ hiddenInPanel: false, createdAt: expect.any(Date) }]);
    expect(emitMessage).toHaveBeenCalledWith(USER_ID, 'OUTBOUND', ROW_ID);
  });

  it('eco de um envio desta API: a linha-espelho é apagada, nada aparece em duplicidade', async () => {
    const { worker, deletes, updates, emitMessage } = build({ apiSent: true });
    await expect(worker.process(job({ fromMe: true }))).resolves.toEqual({ status: 'API_ECHO' });
    expect(deletes).toHaveLength(1);
    expect(updates).toEqual([]);
    expect(emitMessage).not.toHaveBeenCalled();
  });
});
