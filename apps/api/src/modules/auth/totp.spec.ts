import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotpSecret,
  hotp,
  totpAt,
  totpStep,
  verifyTotp,
} from './totp';

/** Vetores oficiais da RFC 4226 (Apêndice D) — segredo ASCII "12345678901234567890". */
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC4226 = [
  '755224',
  '287082',
  '359152',
  '969429',
  '338314',
  '254676',
  '287922',
  '162583',
  '399871',
  '520489',
];

describe('hotp — vetores da RFC 4226', () => {
  it.each(RFC4226.map((code, counter) => [counter, code] as const))(
    'contador %i → %s',
    (counter, expected) => {
      expect(hotp(RFC_SECRET, counter)).toBe(expected);
    },
  );
});

describe('totp — vetores da RFC 6238 (SHA1, 8 dígitos truncados para 6)', () => {
  // T = 59 → 94287082; T = 1111111109 → 07081804; T = 1234567890 → 89005924.
  const secret = base32Encode(RFC_SECRET);
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_234_567_890, '005924'],
  ])('t=%i s → %s', (seconds, expected) => {
    expect(totpAt(secret, seconds * 1000)).toBe(expected);
  });
});

describe('base32', () => {
  it('round-trip', () => {
    const bytes = Buffer.from('movivo-mfa-segredo!');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('aceita minúsculas, espaços e hífens (como o app mostra a chave)', () => {
    const secret = generateTotpSecret();
    const spaced = secret.toLowerCase().replace(/(.{4})/g, '$1 ');
    expect(base32Decode(spaced).equals(base32Decode(secret))).toBe(true);
  });

  it('recusa caractere fora do alfabeto', () => {
    expect(() => base32Decode('ABC1DEF')).toThrow(/inválido/);
  });

  it('gera segredos de 160 bits (32 chars) e diferentes a cada chamada', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  const step = totpStep(now);

  it('aceita o código do passo atual e devolve o passo', () => {
    expect(verifyTotp(secret, totpAt(secret, now), now)).toBe(step);
  });

  it('tolera ±1 passo de relógio, mas não ±2', () => {
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, now - 60_000), now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now + 60_000), now)).toBeNull();
  });

  it('REPLAY: o mesmo código não vale duas vezes (passo ≤ último usado)', () => {
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, code, now, step)).toBeNull();
    expect(verifyTotp(secret, code, now, step + 5)).toBeNull();
    expect(verifyTotp(secret, code, now, step - 1)).toBe(step);
  });

  it('recusa formato inválido sem lançar', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5', "' OR 1=1 --"]) {
      expect(verifyTotp(secret, bad, now)).toBeNull();
    }
  });

  it('aceita espaços no meio (como o app exibe "123 456")', () => {
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(step);
  });

  it('segredo errado nunca valida', () => {
    expect(verifyTotp(generateTotpSecret(), totpAt(secret, now), now)).toBeNull();
  });
});

describe('buildOtpauthUri', () => {
  it('monta a URI no formato lido pelos autenticadores', () => {
    const uri = new URL(buildOtpauthUri('MOVIVO', 'ana@movivo.app', 'JBSWY3DPEHPK3PXP'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/MOVIVO:ana@movivo.app');
    expect(uri.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri.searchParams.get('issuer')).toBe('MOVIVO');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });

  it('escapa caracteres especiais no rótulo (sem injetar parâmetros)', () => {
    const uri = buildOtpauthUri('MOVIVO', 'a&b=c@x.com', 'JBSWY3DPEHPK3PXP');
    expect(new URL(uri).searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri).not.toContain('a&b=c');
  });
});
