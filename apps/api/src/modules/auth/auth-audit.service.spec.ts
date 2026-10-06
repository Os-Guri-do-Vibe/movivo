import { describe, expect, it, vi } from 'vitest';

import { AuthAuditService, accessMetaFrom } from './auth-audit.service';

const STAFF = '11111111-1111-4111-8111-111111111111';
const META = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 test' };

function make(opts: { windowOpen?: boolean; appendFails?: boolean } = {}) {
  const tx = {};
  const db = { runAsSystem: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) };
  const audit = {
    append: vi.fn(async () => {
      if (opts.appendFails) throw new Error('audit indisponível');
    }),
  };
  const store = new Map<string, number>();
  const redis = {
    incr: vi.fn(async (k: string) => {
      store.set(k, (store.get(k) ?? 0) + 1);
      return store.get(k) as number;
    }),
    expire: vi.fn(async () => 1),
    del: vi.fn(async (k: string) => store.delete(k)),
    // SET NX: "OK" só na primeira vez da janela.
    set: vi.fn(async (k: string, ..._rest: unknown[]) => {
      if (opts.windowOpen === false && store.has(`w:${k}`)) return null;
      store.set(`w:${k}`, 1);
      return 'OK';
    }),
  };
  const keys = { global: (...parts: string[]) => `g:${parts.join(':')}` };
  const logger = { setContext: vi.fn(), error: vi.fn() };
  const service = new AuthAuditService(
    logger as never,
    db as never,
    audit as never,
    redis as never,
    keys as never,
  );
  return { service, audit, redis, logger };
}

describe('AuthAuditService.record', () => {
  it('grava na trilha com o sentinela userId = actorId = entityId', async () => {
    const { service, audit } = make();
    await service.record('AUTH_LOGIN', STAFF, META, { role: 'ADMIN' });
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), {
      actorId: STAFF,
      userId: STAFF,
      action: 'AUTH_LOGIN',
      entityType: 'staff',
      entityId: STAFF,
      changes: { role: 'ADMIN', ip: '203.0.113.7', userAgent: 'Mozilla/5.0 test' },
    });
  });

  it('trunca user-agent gigante', async () => {
    const { service, audit } = make();
    await service.record('AUTH_LOGOUT', STAFF, { ip: '1.1.1.1', userAgent: 'x'.repeat(5000) });
    const call = audit.append.mock.calls[0] as unknown as [
      unknown,
      { changes: { userAgent: string } },
    ];
    expect(call[1].changes.userAgent).toHaveLength(160);
  });

  it('NUNCA lança: falha de auditoria não derruba o login', async () => {
    const { service, logger } = make({ appendFails: true });
    await expect(service.record('AUTH_LOGIN', STAFF, META)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth_audit_failed', action: 'AUTH_LOGIN' }),
      expect.any(String),
    );
  });
});

describe('AuthAuditService.recordFailedLogin — dedupe contra flood', () => {
  it('a primeira falha da janela grava, com contador 1', async () => {
    const { service, audit } = make();
    await service.recordFailedLogin(STAFF, META);
    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'AUTH_LOGIN_FAILED',
        changes: expect.objectContaining({ reason: 'invalid_credentials', attemptsSinceLast: 1 }),
      }),
    );
  });

  it('martelar a mesma conta grava UMA linha por janela e acumula a contagem', async () => {
    const { service, audit } = make({ windowOpen: false });
    for (let i = 0; i < 50; i += 1) await service.recordFailedLogin(STAFF, META);
    expect(audit.append).toHaveBeenCalledTimes(1);
  });

  it('Redis fora: não grava (evita flood sem dedupe) e não lança', async () => {
    const { service, audit, redis, logger } = make();
    redis.incr.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.recordFailedLogin(STAFF, META)).resolves.toBeUndefined();
    expect(audit.append).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('accessMetaFrom', () => {
  it('extrai ip e user-agent do request', () => {
    const req = {
      ip: '198.51.100.9',
      get: (h: string) => (h === 'user-agent' ? 'curl/8' : undefined),
    };
    expect(accessMetaFrom(req as never)).toEqual({ ip: '198.51.100.9', userAgent: 'curl/8' });
  });

  it('tolera request sem ip/user-agent', () => {
    expect(accessMetaFrom({ get: () => undefined } as never)).toEqual({
      ip: null,
      userAgent: null,
    });
  });
});
