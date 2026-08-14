/**
 * Testes do disparo de `protocol_viewed` (US-0.5).
 *
 * `@/lib/env` é exposto como getter para que o mesmo arquivo cubra os dois caminhos:
 * analytics ligada (captura) e desligada (nenhuma rede, nenhum bloqueio da página).
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.fn();
let analyticsEnabled = true;

vi.mock('@/lib/env', () => ({
  get isAnalyticsEnabled() {
    return analyticsEnabled;
  },
}));
vi.mock('posthog-js', () => ({ default: { capture } }));

import { ProtocolViewed } from './protocol-viewed';

beforeEach(() => {
  capture.mockClear();
  analyticsEnabled = true;
});

describe('ProtocolViewed', () => {
  it('captura protocol_viewed uma vez e não renderiza nada', async () => {
    const { container } = render(<ProtocolViewed />);
    await waitFor(() => expect(capture).toHaveBeenCalledWith('protocol_viewed'));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('não captura quando a analytics está desligada', async () => {
    analyticsEnabled = false;
    render(<ProtocolViewed />);
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
  });
});
