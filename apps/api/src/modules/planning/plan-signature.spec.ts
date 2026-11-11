import { describe, expect, it } from 'vitest';

import { signatureHashOf } from './plan-signature';

describe('hash de assinatura do protocolo', () => {
  it('é estável: a ordem das chaves não muda o hash', () => {
    const a = { title: 'A', sessions: [{ key: 'S1', minutes: 40 }], n: 1 };
    const b = { n: 1, sessions: [{ minutes: 40, key: 'S1' }], title: 'A' };
    expect(signatureHashOf(a)).toBe(signatureHashOf(b));
    expect(signatureHashOf(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda quando o conteúdo muda (a ordem dos itens de lista importa)', () => {
    const base = { sessions: [{ key: 'S1' }, { key: 'S2' }] };
    expect(signatureHashOf(base)).not.toBe(
      signatureHashOf({ sessions: [{ key: 'S2' }, { key: 'S1' }] }),
    );
    expect(signatureHashOf(base)).not.toBe(signatureHashOf({ sessions: [{ key: 'S1' }] }));
  });
});
