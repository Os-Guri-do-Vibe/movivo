import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { ShortLinkService } from '../short-link/short-link.service';
import type { AnamnesisService } from './anamnesis.service';
import { ComplementaryInviteService } from './complementary-invite.service';

describe('ComplementaryInviteService', () => {
  it('cria o link curto cujo destino leva o token no fragmento, nunca na query', async () => {
    const expiresAt = new Date('2026-11-20T12:00:00.000Z');
    const token = 'b'.repeat(64);
    const create = vi.fn().mockResolvedValue('CODIGO123');
    const service = new ComplementaryInviteService(
      {
        startComplementary: vi.fn().mockResolvedValue({ token, expiresAt, currentStep: 2 }),
      } as unknown as AnamnesisService,
      { create } as unknown as ShortLinkService,
      { whatsapp: { publicSiteUrl: 'https://movivo.example' } } as unknown as AppConfigService,
    );

    const invite = await service.createLink('11111111-1111-4111-8111-111111111111');

    expect(invite).toEqual({ url: 'https://movivo.example/anamnese/c/CODIGO123', expiresAt });
    const [target, expires] = create.mock.calls[0] as [string, Date];
    expect(target).toBe(`https://movivo.example/anamnese/complementar#token=${token}`);
    expect(target).not.toContain('?');
    expect(expires).toBe(expiresAt);
    expect(invite.url).not.toContain(token);
  });
});
