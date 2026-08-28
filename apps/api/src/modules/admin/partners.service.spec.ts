import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CAPABILITIES_BY_ROLE,
  ControlCenterCapability as Capability,
  partnerDistributionResponseSchema,
} from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { CAPABILITIES_KEY } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import type { AuditService } from './audit.service';
import type { ControlCenterService } from './control-center.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const;

const SEED = [
  { name: 'Rodrigo', shareBasisPoints: 2000 },
  { name: 'Pedro', shareBasisPoints: 2000 },
  { name: 'Joaquim', shareBasisPoints: 2000 },
  { name: 'Cahuã', shareBasisPoints: 2000 },
  { name: 'Treinador do Cahuã', shareBasisPoints: 2000 },
].map((partner, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  ...partner,
  validFrom: '2026-07-22',
  validTo: null,
  notes: null,
}));

function partnersWith(profitBrl: number | null, rows: unknown[] = SEED) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  const inserted: unknown[] = [];
  const tx = {
    select: vi.fn(() => chain),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    insert: vi.fn(() => ({
      values: (values: unknown[]) => {
        inserted.push(...values);
        return {
          returning: () =>
            Promise.resolve(
              values.map((value, index) => ({
                id: `10000000-0000-4000-8000-00000000000${index}`,
                validTo: null,
                notes: null,
                ...(value as object),
              })),
            ),
        };
      },
    })),
  };
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const controlCenter = {
    finance: vi.fn().mockResolvedValue({
      data: {
        profit: {
          value: profitBrl,
          unit: 'BRL',
          status: profitBrl === null ? 'UNAVAILABLE' : 'AVAILABLE',
          definition: 'Lucro do mês corrente em regime de CAIXA.',
        },
      },
    }),
  } as unknown as ControlCenterService;
  const service = new PartnersService(db, audit as unknown as AuditService, controlCenter);
  return { service, audit, inserted };
}

describe('PartnersService.distribution', () => {
  it('distribui o lucro real na participação vigente, com as 3 ressalvas no payload', async () => {
    const { service } = partnersWith(1234.56);
    const response = partnerDistributionResponseSchema.parse(await service.distribution());

    expect(response.data.profitCents).toBe(123_456);
    expect(response.data.profitAvailable).toBe(true);
    expect(response.data.totalBasisPoints).toBe(10_000);
    // 20% de R$ 1.234,56 = R$ 246,91 (truncado do 246,912).
    expect(response.data.partners.map((partner) => partner.amountCents)).toEqual([
      24_691, 24_691, 24_691, 24_691, 24_691,
    ]);
    // A soma das partes nunca ultrapassa o lucro (truncamento, não arredondamento).
    const distributed = response.data.partners.reduce((sum, item) => sum + item.amountCents, 0);
    expect(distributed).toBeLessThanOrEqual(response.data.profitCents);
    expect(response.data.caveats).toHaveLength(3);
    expect(response.data.caveats.join(' ')).toMatch(/vesting/i);
    expect(response.data.caveats.join(' ')).toMatch(/reserva de caixa/i);
    expect(response.data.caveats.join(' ')).toMatch(/dividendo declarado/i);
  });

  it('não inventa lucro quando a apuração está indisponível', async () => {
    const { service } = partnersWith(null);
    const response = await service.distribution();
    expect(response.data.profitAvailable).toBe(false);
    expect(response.data.profitCents).toBe(0);
    expect(response.meta.dataQuality).toHaveLength(1);
  });

  it('distribui prejuízo como prejuízo, sem piso em zero', async () => {
    const { service } = partnersWith(-500);
    const response = await service.distribution();
    expect(response.data.partners[0]?.amountCents).toBe(-10_000);
  });
});

describe('PartnersService.replace', () => {
  it('rejeita composição que não fecha 10.000 bps antes de tocar o banco', async () => {
    const { service, audit } = partnersWith(100);
    await expect(
      service.replace(ACTOR, {
        validFrom: '2026-09-01',
        reason: 'Entrada de novo sócio',
        partners: [
          { name: 'Rodrigo', shareBasisPoints: 5000 },
          { name: 'Pedro', shareBasisPoints: 4000 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(audit.append).not.toHaveBeenCalled();
  });

  it('fecha a vigência anterior, abre a nova e audita na mesma transação', async () => {
    const { service, audit, inserted } = partnersWith(100);
    await service.replace(ACTOR, {
      validFrom: '2026-09-01',
      reason: 'Entrada de novo sócio',
      partners: [
        { name: 'Rodrigo', shareBasisPoints: 5000 },
        { name: 'Pedro', shareBasisPoints: 5000 },
      ],
    });
    expect(inserted).toHaveLength(2);
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'partners.composition.replace' }),
    );
  });
});

describe('RBAC do cap table', () => {
  const capabilities = (method: 'distribution' | 'replace') =>
    Reflect.getMetadata(
      CAPABILITIES_KEY,
      PartnersController.prototype[method] as (...args: never[]) => unknown,
    ) as string[];

  it('exige PARTNERS_READ na leitura e PARTNERS_WRITE na escrita', () => {
    expect(capabilities('distribution')).toEqual([Capability.PARTNERS_READ]);
    expect(capabilities('replace')).toEqual([Capability.PARTNERS_READ, Capability.PARTNERS_WRITE]);
  });

  it('concede o cap table somente ao ADMIN', () => {
    for (const [role, granted] of Object.entries(CAPABILITIES_BY_ROLE)) {
      const has =
        granted.includes(Capability.PARTNERS_READ) || granted.includes(Capability.PARTNERS_WRITE);
      expect(has).toBe(role === 'ADMIN');
    }
    expect(CAPABILITIES_BY_ROLE.ADMIN).toEqual(Object.values(Capability));
  });

  it('FINANCE recebe 403 nas duas rotas', () => {
    const guard = (method: 'distribution' | 'replace') =>
      new CapabilitiesGuard({
        getAllAndOverride: () => capabilities(method),
      } as never).canActivate({
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => ({ user: { role: 'FINANCE' } }) }),
      } as never);
    expect(() => guard('distribution')).toThrow(ForbiddenException);
    expect(() => guard('replace')).toThrow(ForbiddenException);
  });
});
