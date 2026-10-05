import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { AccessLinkService } from './access-link.service';

const USER = '11111111-1111-4111-8111-111111111111';

describe('AccessLinkService — trust boundary', () => {
  it('grava somente hash e escopo, com renovação atômica do recurso', async () => {
    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const runAsUser = vi.fn(async (_id, _role, cb) => cb({ insert: () => ({ values }) }));
    const service = new AccessLinkService({ runAsUser } as never);
    const { token } = await service.issue('CHECKOUT', USER, USER, 3600000);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        purpose: 'CHECKOUT',
        resourceId: USER,
        tokenHash: createHash('sha256').update(token).digest('hex'),
      }),
    );
    expect(JSON.stringify(values.mock.calls)).not.toContain(token);
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({ revokedAt: null }),
      }),
    );
  });

  it('rejeita IDs, tokens legados, input inválido e TTL ilimitado antes de consultar banco', async () => {
    const runAsSystem = vi.fn();
    const runAsUser = vi.fn();
    const service = new AccessLinkService({ runAsSystem, runAsUser } as never);
    for (const token of [USER, '', 'A'.repeat(300), 'secret?query']) {
      await expect(service.verify(token, 'PROTOCOL')).resolves.toBeNull();
    }
    await expect(service.issue('PROTOCOL', 'invalid', USER, 1000)).rejects.toThrow();
    await expect(service.issue('PROTOCOL', USER, USER, 0)).rejects.toThrow();
    expect(runAsSystem).not.toHaveBeenCalled();
    expect(runAsUser).not.toHaveBeenCalled();
  });

  it('falha fechada se o estado autoritativo estiver indisponível', async () => {
    const service = new AccessLinkService({
      runAsSystem: vi.fn(async () => {
        throw new Error('unavailable');
      }),
    } as never);
    await expect(service.verify('A'.repeat(43), 'CHECKOUT')).rejects.toThrow('unavailable');
  });
});
