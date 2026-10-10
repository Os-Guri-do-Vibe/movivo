import { expect, it, vi } from 'vitest';
import { CheckoutTokenService } from './checkout-token.service';

const USER = '11111111-1111-4111-8111-111111111111';

it('checkout delega emissão, validade e revogação ao estado autoritativo, com escopo próprio', async () => {
  const expiresAt = new Date('2026-10-08T12:00:00Z');
  const links = {
    issue: vi.fn(async (_purpose: string, _userId: string, _resourceId: string) => ({
      token: 'opaque',
      expiresAt,
    })),
    verify: vi.fn(async () => ({ userId: USER, expiresAt })),
    revoke: vi.fn(async () => undefined),
  };
  const service = new CheckoutTokenService(links as never);
  const now = new Date('2026-10-05T12:00:00Z');
  await expect(service.issue(USER, now)).resolves.toEqual({ token: 'opaque', expiresAt });
  expect(links.issue).toHaveBeenCalledWith(
    'CHECKOUT',
    USER,
    expect.stringMatching(/^[0-9a-f-]{36}$/),
    72 * 3600000,
    now,
  );
  await service.issue(USER, now);
  expect(links.issue.mock.calls[1]?.[2]).not.toBe(links.issue.mock.calls[0]?.[2]);
  await expect(service.verify('opaque', now)).resolves.toEqual({
    userId: USER,
    expiresAt: expiresAt.getTime(),
  });
  expect(links.verify).toHaveBeenCalledWith('opaque', 'CHECKOUT', now);
  await service.revoke('opaque');
  expect(links.revoke).toHaveBeenCalledWith('opaque');
});

it('não aceita checkout criptográfico legado quando não existe autorização no banco', async () => {
  const service = new CheckoutTokenService({ verify: vi.fn(async () => null) } as never);
  await expect(service.verify('legacy-encrypted-token')).resolves.toBeNull();
});
