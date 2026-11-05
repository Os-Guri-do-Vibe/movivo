import { describe, expect, it } from 'vitest';

import {
  dedupeByKind,
  painSignals,
  ruleFor,
  type SentinelParams,
  signalOf,
} from './sentinel-rules';

const params: SentinelParams = {
  pain: { stopExerciseAt: 4, escalateAt: 7, persistentDays: 5 },
  bySignal: {
    PERSISTENT_PAIN: { severity: 'URGENT', scope: 'TRAINING' },
    CHEST_PAIN: { severity: 'ATTENTION', scope: 'TRAINING' },
  },
};

describe('sentinela de segurança', () => {
  it('dor a partir do limiar de encaminhamento vira dor forte', () => {
    const signals = painSignals(
      [{ region: 'joelho', intensity: 8, during: 'DURING' }],
      [],
      '2026-11-04',
      params,
    );
    expect(signals).toEqual([expect.objectContaining({ kind: 'SEVERE_PAIN', severity: 'URGENT' })]);
  });

  it('dor moderada na mesma região ao longo do período vira dor persistente', () => {
    const report = [{ region: 'joelho', intensity: 5, during: 'AFTER' as const }];
    expect(painSignals(report, [], '2026-11-04', params)).toEqual([]);
    const history = [{ region: 'joelho', day: '2026-10-30' }];
    expect(painSignals(report, history, '2026-11-04', params)).toEqual([
      expect.objectContaining({ kind: 'PERSISTENT_PAIN', severity: 'URGENT', scope: 'TRAINING' }),
    ]);
  });

  it('dor leve abaixo do limiar de parada não gera sinal', () => {
    const history = [{ region: 'ombro', day: '2026-10-20' }];
    expect(
      painSignals(
        [{ region: 'ombro', intensity: 3, during: 'AFTER' }],
        history,
        '2026-11-04',
        params,
      ),
    ).toEqual([]);
  });

  it('a tabela publicada nunca rebaixa um sinal de emergência', () => {
    expect(ruleFor('CHEST_PAIN', params).severity).toBe('EMERGENCY');
    expect(ruleFor('PERSISTENT_PAIN', params).severity).toBe('URGENT');
    expect(ruleFor('PERSISTENT_PAIN', null).severity).toBe('ATTENTION');
  });

  it('um sinal por tipo, ficando o mais grave', () => {
    const merged = dedupeByKind([
      { ...signalOf('OTHER', 'a', null), severity: 'ATTENTION' },
      { ...signalOf('OTHER', 'b', null), severity: 'URGENT' },
    ]);
    expect(merged).toEqual([expect.objectContaining({ severity: 'URGENT', evidence: 'b' })]);
  });
});
