import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import { RedisKeyBuilder } from '../../core/redis';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { MirrorCapture } from './inbound/inbound-message';
import {
  apiSentKey,
  PHONE_CONFIRM_DELAY_MS,
  WhatsappMirrorService,
} from './whatsapp-mirror.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const PHONE = '+5541999998888';

const base: MirrorCapture = {
  messageId: 'WA-1',
  phone: PHONE,
  fromMe: false,
  kind: 'TEXT',
  text: 'oi',
};

function build(opts: { owner?: boolean; duplicate?: boolean; dbFails?: boolean } = {}) {
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const onConflictDoNothing = vi.fn(() => ({
    returning: vi.fn(async () => (opts.duplicate ? [] : [{ id: ROW_ID }])),
  }));
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (opts.owner === false ? [] : [{ id: USER_ID }]) }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { onConflictDoNothing };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updated.push(values);
        return { where: async () => undefined };
      },
    }),
  };
  const db = {
    runAsSystem: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    runAsUser: vi.fn(async (_u: string, _r: string, cb: (t: unknown) => unknown) => {
      if (opts.dbFails) throw new Error('banco fora');
      return cb(tx);
    }),
  } as unknown as TenantDatabase;
  const cipher = {
    encryptText: vi.fn(async (v: string) => `enc(${v})`),
  } as unknown as HealthCipherService;
  const enqueue = vi.fn(async () => 'job');
  const emitMessage = vi.fn();
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const service = new WhatsappMirrorService(
    db,
    cipher,
    { enqueue } as unknown as QueueManager,
    { emitMessage } as unknown as ConversationEventsService,
    logger,
  );
  return { service, inserted, updated, enqueue, emitMessage, logger };
}

describe('WhatsappMirrorService.capture', () => {
  it('texto do aluno: grava cifrado como espelho, sem fila, e avisa o painel na hora', async () => {
    const { service, inserted, enqueue, emitMessage } = build();
    await service.capture(base);
    expect(inserted).toEqual([
      expect.objectContaining({
        userId: USER_ID,
        direction: 'INBOUND',
        origin: 'STUDENT',
        messageType: 'TEXT',
        content: 'enc(oi)',
        whatsappMsgId: 'WA-1',
        mirror: true,
        hiddenInPanel: false,
        mediaStatus: null,
      }),
    ]);
    expect(enqueue).not.toHaveBeenCalled();
    expect(emitMessage).toHaveBeenCalledWith(USER_ID, 'INBOUND', ROW_ID);
  });

  it('áudio do aluno: linha PENDING + job de mídia; o aviso ao painel espera o arquivo', async () => {
    const { service, inserted, enqueue, emitMessage } = build();
    await service.capture({ ...base, kind: 'AUDIO', text: '', seconds: 9, mediaKey: '{"id":"x"}' });
    expect(inserted[0]).toMatchObject({
      messageType: 'AUDIO',
      mediaStatus: 'PENDING',
      mediaSeconds: 9,
    });
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-mirror',
      'mirror',
      {
        conversationId: ROW_ID,
        userId: USER_ID,
        messageId: 'WA-1',
        fromMe: false,
        mediaKey: '{"id":"x"}',
      },
      { jobId: `mirror_${ROW_ID}` },
    );
    expect(emitMessage).not.toHaveBeenCalled();
  });

  it('digitada no celular: nasce oculta e só é confirmada pelo job atrasado', async () => {
    const { service, inserted, enqueue, emitMessage } = build();
    await service.capture({ ...base, fromMe: true, text: 'bora treinar' });
    expect(inserted[0]).toMatchObject({
      direction: 'OUTBOUND',
      origin: 'PROFESSIONAL',
      sourceType: 'PHONE_MESSAGE',
      hiddenInPanel: true,
    });
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-mirror',
      'mirror',
      expect.objectContaining({ fromMe: true }),
      { jobId: `mirror_${ROW_ID}`, delay: PHONE_CONFIRM_DELAY_MS },
    );
    expect(emitMessage).not.toHaveBeenCalled();
  });

  it('remetente desconhecido: nada é gravado', async () => {
    const { service, inserted } = build({ owner: false });
    await service.capture(base);
    expect(inserted).toEqual([]);
  });

  it('reentrega do mesmo id (conflito): não enfileira nem avisa', async () => {
    const { service, enqueue, emitMessage } = build({ duplicate: true });
    await service.capture({ ...base, kind: 'IMAGE', mediaKey: '{}' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(emitMessage).not.toHaveBeenCalled();
  });

  it('falha do banco nunca lança (o atendimento segue) e fica no log', async () => {
    const { service, logger } = build({ dbFails: true });
    await expect(service.capture(base)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('WhatsappMirrorService.attachTranscript', () => {
  it('guarda a transcrição cifrada na linha do áudio', async () => {
    const { service, updated } = build();
    await service.attachTranscript(USER_ID, 'WA-1', 'doeu o joelho');
    expect(updated).toEqual([{ content: 'enc(doeu o joelho)' }]);
  });

  it('falha não lança', async () => {
    const { service, logger } = build({ dbFails: true });
    await expect(service.attachTranscript(USER_ID, 'WA-1', 'x')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('apiSentKey', () => {
  it('é estável por id e cabe no limite de segmento do RedisKeyBuilder', () => {
    const keys = new RedisKeyBuilder('movivo');
    expect(apiSentKey(keys, 'ABC')).toBe(apiSentKey(keys, 'ABC'));
    expect(apiSentKey(keys, 'ABC')).not.toBe(apiSentKey(keys, 'ABD'));
  });
});
