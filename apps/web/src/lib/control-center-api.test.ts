import { describe, expect, it } from 'vitest';

import {
  parseControlCenterFinance,
  parseControlCenterMarketing,
  parseControlCenterSupport,
} from './control-center-api';

const metric = {
  value: 1,
  unit: 'COUNT',
  status: 'AVAILABLE',
  definition: 'Definição testável.',
};
const meta = {
  generatedAt: '2026-08-11T15:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  dataQuality: [],
};

describe('projeções do Control Center', () => {
  it('financeiro descarta campos de saúde injetados fora do contrato', () => {
    const parsed = parseControlCenterFinance({
      data: {
        activeSubscriptions: metric,
        contractedMrr: { ...metric, unit: 'BRL' },
        aiCost: { ...metric, unit: 'BRL' },
        whatsappCost: { ...metric, unit: 'BRL' },
        infrastructureCost: { ...metric, unit: 'BRL' },
        receivedRevenue: { ...metric, unit: 'BRL' },
        healthConditions: ['não pode aparecer'],
      },
      meta,
    });
    expect(parsed.data).not.toHaveProperty('healthConditions');
  });

  it('marketing recusa segmento menor que dez pessoas', () => {
    expect(() =>
      parseControlCenterMarketing({
        data: {
          funnel: {
            formStarted: metric,
            formSubmitted: metric,
            protocolActive: metric,
            subscriptionActive: metric,
          },
          acquisition: metric,
          segments: [{ dimension: 'PRIMARY_GOAL', value: 'Objetivo', count: 9 }],
          suppressedSegments: 2,
          minimumSegmentSize: 10,
        },
        meta,
      }),
    ).toThrow();
  });

  it('suporte descarta conteúdo de saúde e treino fora da projeção', () => {
    const parsed = parseControlCenterSupport({
      data: {
        customers: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Pessoa',
            email: 'pessoa@teste.com',
            phoneNumber: '+5511999999999',
            status: 'ACTIVE',
            subscriptionStatus: 'ACTIVE',
            parqState: 'BLOQUEADO',
          },
        ],
      },
      meta,
    });
    expect(parsed.data.customers[0]).not.toHaveProperty('parqState');
  });
});
