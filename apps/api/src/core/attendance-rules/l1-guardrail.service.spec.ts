import { describe, expect, it, vi } from 'vitest';

import type { DrizzleClient } from '../database/database.module';
import { L1GuardrailService } from './l1-guardrail.service';

function serviceWith(rows: unknown[]) {
  const orderBy = vi.fn(async () => rows);
  const from = vi.fn(() => ({ orderBy }));
  const select = vi.fn(() => ({ from }));
  return { service: new L1GuardrailService({ select } as unknown as DrizzleClient), select };
}

describe('L1GuardrailService', () => {
  it('sinaliza match literal normalizado sem alterar a mensagem', async () => {
    const { service } = serviceWith([
      {
        ruleKey: 'rule-1',
        label: 'Carga fora do padrão',
        scope: 'INPUT',
        phrases: ['dobrar a carga'],
        version: 2,
        status: 'PUBLISHED',
      },
    ]);

    await expect(service.evaluate('Quero DOBRAR   a carga hoje', 'Tudo bem.')).resolves.toEqual([
      { ruleKey: 'rule-1', label: 'Carga fora do padrão', version: 2 },
    ]);
  });

  it('usa só a versão atual e ignora regra retirada', async () => {
    const { service } = serviceWith([
      {
        ruleKey: 'rule-1',
        label: 'Atual',
        scope: 'BOTH',
        phrases: ['carga'],
        version: 2,
        status: 'RETIRED',
      },
      {
        ruleKey: 'rule-1',
        label: 'Antiga',
        scope: 'BOTH',
        phrases: ['carga'],
        version: 1,
        status: 'PUBLISHED',
      },
    ]);

    await expect(service.evaluate('carga', 'carga')).resolves.toEqual([]);
  });
});
