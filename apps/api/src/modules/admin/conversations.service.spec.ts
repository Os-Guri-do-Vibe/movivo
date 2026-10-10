import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { RedisKeyBuilder } from '../../core/redis';
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
  } = {},
) {
  const selects = [...(opts.selects ?? [])];
  const tx = { select: vi.fn(() => chain(selects.shift() ?? [])) };
  const db = {
    runAsUser: vi.fn((_u: string, _r: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const cipher = {
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
  const service = new ConversationsService(
    db,
    audit as unknown as AuditService,
    cipher as unknown as HealthCipherService,
    redis as never,
    redisKeys as unknown as RedisKeyBuilder,
    evolution as unknown as EvolutionTransport,
  );
  return { service, audit, cipher, redis, evolution };
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
