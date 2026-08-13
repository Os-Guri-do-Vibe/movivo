/**
 * Derivação do marco de ciclo de vida (US-8.3). É a única lógica não trivial da US fora do
 * banco: errar aqui não quebra nada tecnicamente e desalinha a coorte do CFO em silêncio.
 */
import { describe, expect, it } from 'vitest';

import { lifecycleMarkerFor } from './subscription-lifecycle';

describe('lifecycleMarkerFor (US-8.3)', () => {
  it('nascer em TRIALING é a entrada no funil', () => {
    expect(lifecycleMarkerFor(null, 'TRIALING')).toBe('TRIAL_STARTED');
  });

  it('TRIALING → ACTIVE é conversão (proxy provisório de "primeiro pagamento")', () => {
    expect(lifecycleMarkerFor('TRIALING', 'ACTIVE')).toBe('CONVERTED');
  });

  it('PAUSED → ACTIVE é retomada, nunca conversão (não pode contar duas vezes na coorte)', () => {
    expect(lifecycleMarkerFor('PAUSED', 'ACTIVE')).toBe('RESUMED');
  });

  it('ACTIVE → ACTIVE e PAST_DUE → ACTIVE são renovação', () => {
    expect(lifecycleMarkerFor('ACTIVE', 'ACTIVE')).toBe('RENEWED');
    expect(lifecycleMarkerFor('PAST_DUE', 'ACTIVE')).toBe('RENEWED');
  });

  it('pausa e cancelamento são marcos diretos, de qualquer origem', () => {
    expect(lifecycleMarkerFor('ACTIVE', 'PAUSED')).toBe('PAUSED');
    expect(lifecycleMarkerFor('TRIALING', 'CANCELED')).toBe('CANCELED');
    expect(lifecycleMarkerFor('PAST_DUE', 'CANCELED')).toBe('CANCELED');
  });

  it('PAST_DUE e EXPIRED não são marcos do funil — nenhuma transição é inventada', () => {
    expect(lifecycleMarkerFor('ACTIVE', 'PAST_DUE')).toBeNull();
    expect(lifecycleMarkerFor('TRIALING', 'EXPIRED')).toBeNull();
  });

  it('escrita sem mudança real de estado não emite marco (patch idempotente)', () => {
    expect(lifecycleMarkerFor('PAUSED', 'PAUSED')).toBeNull();
    expect(lifecycleMarkerFor('CANCELED', 'CANCELED')).toBeNull();
    // TRIALING só é entrada quando não havia estado anterior.
    expect(lifecycleMarkerFor('CANCELED', 'TRIALING')).toBeNull();
  });
});
