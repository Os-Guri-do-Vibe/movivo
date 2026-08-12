import { describe, expect, it } from 'vitest';

import {
  controlCenterMarketingResponseSchema,
  controlCenterSessionSchema,
  controlCenterSupportResponseSchema,
} from './control-center.schema';

const meta = {
  generatedAt: '2026-08-11T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

describe('contratos do Control Center', () => {
  it('aceita os novos papéis e capabilities materializados', () => {
    expect(
      controlCenterSessionSchema.parse({
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'MARKETING',
        capabilities: ['control_center.marketing.read'],
      }),
    ).toMatchObject({ role: 'MARKETING' });
  });

  it('recusa bucket de marketing abaixo do limiar de dez', () => {
    const metric = { value: 1, unit: 'COUNT', status: 'AVAILABLE', definition: 'x' };
    expect(
      controlCenterMarketingResponseSchema.safeParse({
        data: {
          funnel: {
            formStarted: metric,
            formSubmitted: metric,
            protocolActive: metric,
            subscriptionActive: metric,
          },
          acquisition: { ...metric, value: null, status: 'UNAVAILABLE' },
          segments: [{ dimension: 'PRIMARY_GOAL', value: 'LOSE_FAT', count: 9 }],
          suppressedSegments: 1,
          minimumSegmentSize: 10,
        },
        meta,
      }).success,
    ).toBe(false);
  });

  it('remove campos de saúde estranhos da projeção de suporte', () => {
    const parsed = controlCenterSupportResponseSchema.parse({
      data: {
        customers: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Pessoa',
            email: null,
            phoneNumber: '+5511999999999',
            status: 'ACTIVE',
            subscriptionStatus: null,
            parqState: 'BLOCKED',
          },
        ],
      },
      meta,
    });
    expect(parsed.data.customers[0]).not.toHaveProperty('parqState');
  });
});
