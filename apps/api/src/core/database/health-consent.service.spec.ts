import { describe, expect, it, vi } from 'vitest';

import { HealthConsentService } from './health-consent.service';
import { TenantDatabase } from './tenant-database.service';

function serviceWith(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const execute = vi.fn(async () => rows);
  const chain = {
    from: () => chain,
    where: () => chain,
    limit,
  };
  const tx = {
    select: () => chain,
    execute,
  } as never;
  const db = {
    runAsUser: vi.fn((_userId, _role, callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as TenantDatabase;
  return { service: new HealthConsentService(db), db, execute };
}

describe('HealthConsentService', () => {
  it('so considera consentimento vigente encontrado sob o titular', async () => {
    const active = serviceWith([{ id: 'c1' }]);
    await expect(
      active.service.hasActiveForUser('11111111-1111-4111-8111-111111111111'),
    ).resolves.toBe(true);
    expect(active.db.runAsUser).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'USER',
      expect.any(Function),
    );

    await expect(serviceWith([]).service.hasActiveForUser('u')).resolves.toBe(false);
  });

  it('carimba revogacao sem apagar historico e informa se houve mudanca', async () => {
    const revoked = serviceWith([{ revoked: true }]);
    await expect(revoked.service.revokeForUser('u')).resolves.toBe(true);
    expect(revoked.execute).toHaveBeenCalledOnce();
    await expect(serviceWith([]).service.revokeForUser('u')).resolves.toBe(false);
  });
});
