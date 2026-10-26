import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CoachAttendanceService } from '../../core/database/coach-attendance.service';
import type { ConversationMediaStorage } from '../../core/database/conversation-media-storage.service';
import type { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { RedisKeyBuilder } from '../../core/redis';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { EvolutionTransport } from '../whatsapp/evolution-transport';
import type { AuditService } from './audit.service';
import { ConversationsService, isWhatsappPhotoUrl } from './conversations.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'PROFESSIONAL',
  jti: 'j1',
} as const as AuthenticatedUser;
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444';

/** Cadeia do Drizzle que resolve para `result` em qualquer ponto terminal. */
function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) c[m] = () => c;
  c.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

function build(
  opts: {
    selects?: unknown[][];
    photoFromEvolution?: string | null;
    cached?: string | null;
    paused?: boolean;
    consent?: boolean;
    insertedRow?: { id: string; createdAt: Date };
    mediaBytes?: Buffer | null;
  } = {},
) {
  const selects = [...(opts.selects ?? [])];
  const inserted: unknown[] = [];
  const insertChain = {
    values: vi.fn((row: unknown) => {
      inserted.push(row);
      return insertChain;
    }),
    returning: vi.fn(async () => [
      opts.insertedRow ?? { id: MESSAGE_ID, createdAt: new Date('2026-10-10T12:00:00Z') },
    ]),
  };
  const updates: unknown[] = [];
  const updateChain = {
    set: vi.fn((values: unknown) => {
      updates.push(values);
      return updateChain;
    }),
    where: vi.fn(async () => undefined),
  };
  const tx = {
    select: vi.fn(() => chain(selects.shift() ?? [])),
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
  };
  const db = {
    runAsUser: vi.fn((_u: string, _r: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    runAsSystem: vi.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const cipher = {
    encryptText: vi.fn(async (v: string) => `enc(${v})`),
    decryptText: vi.fn(async (v: string) =>
      v === 'boom' ? Promise.reject(new Error('x')) : `dec(${v})`,
    ),
  };
  const redis = {
    get: vi.fn().mockResolvedValue(opts.cached ?? null),
    set: vi.fn().mockResolvedValue('OK'),
  };
  const redisKeys = { forUser: (id: string, ...s: string[]) => `p:u:${id}:${s.join(':')}` };
  const evolution = {
    fetchProfilePictureUrl: vi.fn().mockResolvedValue(opts.photoFromEvolution ?? null),
  };
  const attendance = {
    isPaused: vi.fn(async () => opts.paused ?? false),
    setPaused: vi.fn(async () => true),
  };
  const consent = { hasActiveForUser: vi.fn(async () => opts.consent ?? true) };
  const queues = { enqueue: vi.fn(async () => 'job-1') };
  const events = { emitMessage: vi.fn(), emitAttendance: vi.fn(), emitRead: vi.fn() };
  const mediaStorage = {
    read: vi.fn(async () =>
      opts.mediaBytes === undefined ? Buffer.from('bytes') : opts.mediaBytes,
    ),
  };
  const service = new ConversationsService(
    db,
    audit as unknown as AuditService,
    cipher as unknown as HealthCipherService,
    redis as never,
    redisKeys as unknown as RedisKeyBuilder,
    evolution as unknown as EvolutionTransport,
    attendance as unknown as CoachAttendanceService,
    consent as unknown as HealthConsentService,
    queues as unknown as QueueManager,
    events as unknown as ConversationEventsService,
    mediaStorage as unknown as ConversationMediaStorage,
  );
  return {
    service,
    audit,
    cipher,
    redis,
    evolution,
    attendance,
    consent,
    queues,
    inserted,
    events,
    updates,
    mediaStorage,
  };
}

describe('ConversationsService.list', () => {
  it('usa o nome do WhatsApp quando não há nome cadastrado e audita o acesso em lote', async () => {
    const { service, audit } = build({
      selects: [
        [
          {
            studentId: STUDENT_ID,
            name: null,
            whatsappName: 'Duda',
            phoneNumber: '+5511999999999',
            coachPausedAt: null,
            unreadCount: 3,
            lastMessageAt: '2026-10-09T12:00:00.000Z',
          },
        ],
      ],
    });
    const res = await service.list(ACTOR);
    expect(res.data.conversations).toEqual([
      {
        studentId: STUDENT_ID,
        name: 'Duda',
        phoneNumber: '+5511999999999',
        lastMessageAt: '2026-10-09T12:00:00.000Z',
        aiPaused: false,
        unreadCount: 3,
      },
    ]);
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'CONVERSATIONS_LIST_VIEWED',
        changes: expect.objectContaining({ recordCount: 1 }),
      }),
    );
  });
});

describe('ConversationsService.messages', () => {
  const student = {
    id: STUDENT_ID,
    name: 'Ana',
    whatsappName: null,
    phoneNumber: '+5511988887777',
  };
  const row = (id: string, direction: 'INBOUND' | 'OUTBOUND', at: string, content = 'c') => ({
    id,
    direction,
    messageType: 'TEXT',
    content,
    createdAt: new Date(at),
  });

  it('404 quando o aluno não existe ou a RLS o esconde — e não audita', async () => {
    const { service, audit } = build({ selects: [[]] });
    await expect(service.messages(ACTOR, STUDENT_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('devolve em ordem cronológica, decifrado, e audita como leitura de saúde', async () => {
    const { service, audit, cipher } = build({
      // o banco devolve da mais nova para a mais antiga
      selects: [
        [student],
        [
          row('b', 'OUTBOUND', '2026-10-09T10:01:00Z', 'v:2'),
          row('a', 'INBOUND', '2026-10-09T10:00:00Z', 'v:1'),
        ],
      ],
    });
    const res = await service.messages(ACTOR, STUDENT_ID);
    expect(res.data.messages.map((m) => [m.id, m.direction, m.content])).toEqual([
      ['a', 'INBOUND', 'dec(v:1)'],
      ['b', 'OUTBOUND', 'dec(v:2)'],
    ]);
    expect(res.data.olderCursor).toBeNull();
    expect(cipher.decryptText).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'HEALTH_DATA_VIEWED',
        userId: STUDENT_ID,
        entityType: 'student_conversation',
      }),
    );
  });

  it('pagina: pede limit+1, descarta a sobra e devolve o cursor da mais antiga', async () => {
    const { service } = build({
      selects: [
        [student],
        [
          row('c', 'INBOUND', '2026-10-09T10:02:00Z'),
          row('b', 'OUTBOUND', '2026-10-09T10:01:00Z'),
          row('a', 'INBOUND', '2026-10-09T10:00:00Z'),
        ],
      ],
    });
    const res = await service.messages(ACTOR, STUDENT_ID, undefined, 2);
    expect(res.data.messages.map((m) => m.id)).toEqual(['b', 'c']);
    expect(res.data.olderCursor).toBe('2026-10-09T10:01:00.000Z');
  });

  it('com `after`: devolve só o que chegou desde então, em ordem cronológica, sem cursor', async () => {
    const { service, audit } = build({
      selects: [
        [student],
        [
          row('b', 'OUTBOUND', '2026-10-09T10:01:00Z', 'v:2'),
          row('c', 'INBOUND', '2026-10-09T10:02:00Z', 'v:3'),
        ],
      ],
    });
    const res = await service.messages(
      ACTOR,
      STUDENT_ID,
      undefined,
      undefined,
      new Date('2026-10-09T10:01:00Z'),
    );
    expect(res.data.messages.map((m) => m.id)).toEqual(['b', 'c']);
    expect(res.data.olderCursor).toBeNull();
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'HEALTH_DATA_VIEWED',
        changes: expect.objectContaining({ page: 'newer' }),
      }),
    );
  });

  it('expõe a origem e os metadados da mídia — nunca o arquivo', async () => {
    const { service } = build({
      selects: [
        [student],
        [
          {
            ...row('a', 'INBOUND', '2026-10-09T10:00:00Z', 'v:t'),
            messageType: 'AUDIO',
            origin: 'STUDENT',
            mediaStatus: 'READY',
            mediaMime: 'audio/ogg',
            mediaSeconds: 7,
          },
          {
            ...row('b', 'OUTBOUND', '2026-10-09T10:01:00Z'),
            origin: 'PROFESSIONAL',
            mediaStatus: null,
            mediaMime: null,
            mediaSeconds: null,
          },
        ],
      ],
    });
    const res = await service.messages(ACTOR, STUDENT_ID);
    expect(res.data.messages.map((m) => [m.origin, m.media])).toEqual([
      ['PROFESSIONAL', null],
      ['STUDENT', { kind: 'AUDIO', status: 'READY', mimeType: 'audio/ogg', seconds: 7 }],
    ]);
  });

  it('uma mensagem ilegível não derruba a conversa', async () => {
    const { service } = build({
      selects: [[student], [row('a', 'INBOUND', '2026-10-09T10:00:00Z', 'boom')]],
    });
    const res = await service.messages(ACTOR, STUDENT_ID);
    expect(res.data.messages[0]?.content).toBe('[mensagem indisponível]');
  });
});

describe('ConversationsService.photoUrl', () => {
  const phoneRow = [{ phoneNumber: '+5511988887777' }];

  it('404 para aluno fora do escopo', async () => {
    const { service, evolution } = build({ selects: [[]] });
    await expect(service.photoUrl(ACTOR, STUDENT_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(evolution.fetchProfilePictureUrl).not.toHaveBeenCalled();
  });

  it('busca na Evolution, valida o host e cacheia', async () => {
    const url = 'https://pps.whatsapp.net/v/t61/abc.jpg';
    const { service, redis, evolution } = build({ selects: [phoneRow], photoFromEvolution: url });
    expect(await service.photoUrl(ACTOR, STUDENT_ID)).toEqual({ url });
    expect(evolution.fetchProfilePictureUrl).toHaveBeenCalledWith('+5511988887777');
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining(STUDENT_ID), url, 'EX', 21600);
  });

  it('rejeita URL fora do WhatsApp (SSRF) e cacheia a ausência por menos tempo', async () => {
    const { service, redis } = build({
      selects: [phoneRow],
      photoFromEvolution: 'https://evil.example.com/x.jpg',
    });
    expect(await service.photoUrl(ACTOR, STUDENT_ID)).toEqual({ url: null });
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), '', 'EX', 3600);
  });

  it('usa o cache sem chamar a Evolution', async () => {
    const cached = 'https://pps.whatsapp.net/v/t61/abc.jpg';
    const { service, evolution } = build({ selects: [phoneRow], cached });
    expect(await service.photoUrl(ACTOR, STUDENT_ID)).toEqual({ url: cached });
    expect(evolution.fetchProfilePictureUrl).not.toHaveBeenCalled();
  });

  it('cache vazio significa "sem foto"', async () => {
    const { service, evolution } = build({ selects: [phoneRow], cached: '' });
    expect(await service.photoUrl(ACTOR, STUDENT_ID)).toEqual({ url: null });
    expect(evolution.fetchProfilePictureUrl).not.toHaveBeenCalled();
  });
});

describe('isWhatsappPhotoUrl', () => {
  it.each([
    ['https://pps.whatsapp.net/v/t61/a.jpg', true],
    ['https://media-gru1-1.cdn.whatsapp.net/a.jpg', true],
    ['https://scontent.xx.fbcdn.net/a.jpg', true],
    ['http://pps.whatsapp.net/a.jpg', false],
    ['https://whatsapp.net.evil.com/a.jpg', false],
    ['https://evilwhatsapp.net/a.jpg', false],
    ['not a url', false],
  ])('%s → %s', (value, expected) => {
    expect(isWhatsappPhotoUrl(value)).toBe(expected);
  });
});

describe('ConversationsService.setAiAttendance', () => {
  const found = [{ id: STUDENT_ID }];

  it('pausa o atendimento e audita quem pausou', async () => {
    const { service, attendance, audit } = build({ selects: [found] });
    const res = await service.setAiAttendance(ACTOR, STUDENT_ID, { paused: true });
    expect(attendance.setPaused).toHaveBeenCalledWith(STUDENT_ID, true);
    expect(res.data).toEqual({ studentId: STUDENT_ID, aiPaused: true });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'COACH_ATTENDANCE_PAUSED',
        actorId: ACTOR.userId,
        userId: STUDENT_ID,
      }),
    );
  });

  it('avisa as outras telas (tempo real) só quando o estado de fato mudou', async () => {
    const changed = build({ selects: [found] });
    await changed.service.setAiAttendance(ACTOR, STUDENT_ID, { paused: true });
    expect(changed.events.emitAttendance).toHaveBeenCalledWith(STUDENT_ID, true);

    const unchanged = build({ selects: [found] });
    unchanged.attendance.setPaused.mockResolvedValue(false);
    await unchanged.service.setAiAttendance(ACTOR, STUDENT_ID, { paused: true });
    expect(unchanged.events.emitAttendance).not.toHaveBeenCalled();
  });

  it('reativa o atendimento', async () => {
    const { service, attendance, audit } = build({ selects: [found] });
    const res = await service.setAiAttendance(ACTOR, STUDENT_ID, { paused: false });
    expect(attendance.setPaused).toHaveBeenCalledWith(STUDENT_ID, false);
    expect(res.data.aiPaused).toBe(false);
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'COACH_ATTENDANCE_RESUMED' }),
    );
  });

  it('404 para aluno fora do escopo, sem alterar nada', async () => {
    const { service, attendance } = build({ selects: [[]] });
    await expect(
      service.setAiAttendance(ACTOR, STUDENT_ID, { paused: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(attendance.setPaused).not.toHaveBeenCalled();
  });

  it('400 para corpo inválido', async () => {
    const { service, attendance } = build({ selects: [found] });
    await expect(
      service.setAiAttendance(ACTOR, STUDENT_ID, { paused: 'sim' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(attendance.setPaused).not.toHaveBeenCalled();
  });
});

describe('ConversationsService.sendMessage', () => {
  const found = [{ id: STUDENT_ID }];

  it('envia com o atendimento pausado: grava cifrado, enfileira e audita só o tamanho', async () => {
    const { service, queues, inserted, audit, events } = build({
      selects: [found],
      paused: true,
    });
    const res = await service.sendMessage(ACTOR, STUDENT_ID, {
      text: '  Oi, Ana! Como foi o treino?  ',
    });

    expect(inserted).toEqual([
      {
        userId: STUDENT_ID,
        direction: 'OUTBOUND',
        origin: 'PROFESSIONAL',
        sourceType: 'MANUAL_MESSAGE',
        content: 'enc(Oi, Ana! Como foi o treino?)',
      },
    ]);
    expect(queues.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'manual-message',
      {
        userId: STUDENT_ID,
        type: 'MANUAL_MESSAGE',
        text: 'Oi, Ana! Como foi o treino?',
        dedupeId: MESSAGE_ID,
      },
      { jobId: `manual-message_${MESSAGE_ID}` },
    );
    expect(res.data.message).toMatchObject({
      id: MESSAGE_ID,
      direction: 'OUTBOUND',
      content: 'Oi, Ana! Como foi o treino?',
    });
    expect(events.emitMessage).toHaveBeenCalledWith(STUDENT_ID, 'OUTBOUND', MESSAGE_ID);
    const auditCall = audit.append.mock.calls.at(-1)?.[1] as { action: string; changes: object };
    expect(auditCall.action).toBe('CONVERSATION_MESSAGE_SENT');
    expect(JSON.stringify(auditCall.changes)).not.toContain('Oi, Ana');
    expect(auditCall.changes).toMatchObject({ length: 27 });
  });

  it('409 com o atendimento automático ativo — nada é gravado nem enviado', async () => {
    const { service, queues, inserted } = build({ selects: [found], paused: false });
    await expect(service.sendMessage(ACTOR, STUDENT_ID, { text: 'oi' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(inserted).toHaveLength(0);
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('409 sem consentimento de saúde vigente', async () => {
    const { service, queues } = build({ selects: [found], paused: true, consent: false });
    await expect(service.sendMessage(ACTOR, STUDENT_ID, { text: 'oi' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('404 para aluno fora do escopo', async () => {
    const { service, queues } = build({ selects: [[]], paused: true });
    await expect(service.sendMessage(ACTOR, STUDENT_ID, { text: 'oi' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it.each([{ text: '' }, { text: '   ' }, { text: 'x'.repeat(2001) }, {}, { text: 5 }])(
    '400 para texto inválido (%j)',
    async (body) => {
      const { service, queues } = build({ selects: [found], paused: true });
      await expect(service.sendMessage(ACTOR, STUDENT_ID, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(queues.enqueue).not.toHaveBeenCalled();
    },
  );
});

describe('ConversationsService.markRead', () => {
  const found = [{ id: STUDENT_ID }];

  it('avança o ponteiro até a última mensagem vista e devolve a contagem restante', async () => {
    const { service, updates, events } = build({ selects: [found, [{ unread: 2 }]] });
    const res = await service.markRead(ACTOR, STUDENT_ID, { upTo: '2026-10-09T10:00:00.000Z' });

    expect(updates).toHaveLength(1);
    expect(res.data).toEqual({ studentId: STUDENT_ID, unreadCount: 2 });
    expect(events.emitRead).toHaveBeenCalledWith(STUDENT_ID, 2);
  });

  it('sem `upTo` marca até agora; zero restante zera o selo', async () => {
    const { service, updates, events } = build({ selects: [found, [{ unread: 0 }]] });
    const res = await service.markRead(ACTOR, STUDENT_ID, {});
    expect(updates).toHaveLength(1);
    expect(res.data.unreadCount).toBe(0);
    expect(events.emitRead).toHaveBeenCalledWith(STUDENT_ID, 0);
  });

  it('um `upTo` no futuro é limitado a agora (o ponteiro nunca passa do presente)', async () => {
    const { service, updates } = build({ selects: [found, [{ unread: 0 }]] });
    const before = Date.now();
    await service.markRead(ACTOR, STUDENT_ID, { upTo: '2999-01-01T00:00:00.000Z' });
    const after = Date.now();

    // O parâmetro do `GREATEST(...)` é o único chunk de texto cru do SQL gerado.
    const { conversationReadAt } = updates[0] as { conversationReadAt: { queryChunks: unknown[] } };
    const iso = conversationReadAt.queryChunks.find(
      (chunk): chunk is string => typeof chunk === 'string' && /^\d{4}-/.test(chunk),
    );
    expect(iso).toBeDefined();
    const sent = new Date(iso as string).getTime();
    expect(sent).toBeGreaterThanOrEqual(before);
    expect(sent).toBeLessThanOrEqual(after);
  });

  it('404 para aluno fora do escopo, sem mexer no ponteiro', async () => {
    const { service, updates, events } = build({ selects: [[]] });
    await expect(service.markRead(ACTOR, STUDENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
    expect(updates).toHaveLength(0);
    expect(events.emitRead).not.toHaveBeenCalled();
  });

  it.each([{ upTo: 'ontem' }, { upTo: 5 }, { extra: true }])(
    '400 para corpo inválido (%j)',
    async (body) => {
      const { service, updates } = build({ selects: [found] });
      await expect(service.markRead(ACTOR, STUDENT_ID, body)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(updates).toHaveLength(0);
    },
  );
});

describe('ConversationsService.media', () => {
  const ready = { mediaPath: 'x.bin', mediaMime: 'image/jpeg', mediaStatus: 'READY' };

  it('devolve os bytes decifrados com o tipo validado no servidor e audita a abertura', async () => {
    const { service, audit, mediaStorage } = build({ selects: [[ready]] });
    const res = await service.media(ACTOR, STUDENT_ID, MESSAGE_ID);
    expect(res.mimeType).toBe('image/jpeg');
    expect(res.bytes.toString()).toBe('bytes');
    expect(mediaStorage.read).toHaveBeenCalledWith('x.bin');
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'HEALTH_DATA_VIEWED',
        userId: STUDENT_ID,
        entityType: 'student_conversation_media',
        entityId: MESSAGE_ID,
      }),
    );
  });

  it('404 fora do escopo (RLS) — e não audita', async () => {
    const { service, audit } = build({ selects: [[]] });
    await expect(service.media(ACTOR, STUDENT_ID, MESSAGE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('404 enquanto a mídia ainda está sendo baixada ou falhou', async () => {
    for (const mediaStatus of ['PENDING', 'FAILED']) {
      const { service } = build({ selects: [[{ ...ready, mediaStatus }]] });
      await expect(service.media(ACTOR, STUDENT_ID, MESSAGE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
  });

  it('404 quando o arquivo sumiu do disco ou não decifra', async () => {
    const { service } = build({ selects: [[ready]], mediaBytes: null });
    await expect(service.media(ACTOR, STUDENT_ID, MESSAGE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
