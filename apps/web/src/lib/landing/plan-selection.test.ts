/** Store do plano escolhido na visita: reativo e sem estado no HTML do servidor. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { getSelectedPlan, selectPlan, useSelectedPlan } from './plan-selection';
import { RESPONSIBLE_PROFESSIONAL, crefLabel } from './site';

afterEach(() => selectPlan(null));

describe('seleção de plano', () => {
  it('começa sem escolha e notifica quem lê', () => {
    const { result } = renderHook(() => useSelectedPlan());
    expect(result.current).toBeNull();
    act(() => selectPlan('QUARTERLY'));
    expect(result.current).toBe('QUARTERLY');
    expect(getSelectedPlan()).toBe('QUARTERLY');
  });

  it('selecionar o mesmo plano de novo é no-op', () => {
    selectPlan('ANNUAL');
    selectPlan('ANNUAL');
    expect(getSelectedPlan()).toBe('ANNUAL');
  });
});

describe('credencial do responsável técnico', () => {
  it('sem número configurado, nunca inventa: "Regulamentado pelo CREF"', () => {
    expect(crefLabel({ ...RESPONSIBLE_PROFESSIONAL, crefNumber: null })).toBe(
      'Regulamentado pelo CREF',
    );
  });

  it('com número configurado, exibe o registro', () => {
    expect(crefLabel({ ...RESPONSIBLE_PROFESSIONAL, crefNumber: '000000-G/SP' })).toBe(
      'CREF 000000-G/SP',
    );
  });
});
