import { describe, expect, it } from 'vitest';

import {
  generateRecoveryCode,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  MfaService,
  normalizeRecoveryCode,
} from './mfa.service';

describe('códigos de recuperação', () => {
  it('formato XXXXX-XXXXX sem caracteres ambíguos', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateRecoveryCode()).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{5}-[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{5}$/,
      );
    }
  });

  it('não repete em uma amostra grande (≈50 bits de entropia)', () => {
    const seen = new Set(Array.from({ length: 5000 }, generateRecoveryCode));
    expect(seen.size).toBe(5000);
  });

  it('normaliza hífen, espaço e caixa antes de comparar/hashear', () => {
    expect(normalizeRecoveryCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(hashRecoveryCode('abcde-fghjk')).toBe(hashRecoveryCode('ABCDEFGHJK'));
    expect(hashRecoveryCode('ABCDE-FGHJK')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distingue código de recuperação de TOTP de 6 dígitos', () => {
    expect(looksLikeRecoveryCode('ABCDE-FGHJK')).toBe(true);
    expect(looksLikeRecoveryCode('abcdefghjk')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
    expect(looksLikeRecoveryCode('123 456')).toBe(false);
    expect(looksLikeRecoveryCode("' OR 1=1 --")).toBe(false);
  });
});

describe('MfaService.modeFor', () => {
  const make = (required: boolean) =>
    new MfaService(
      {} as never,
      {} as never,
      { mfa: { required, issuer: 'MOVIVO' } } as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('conta com MFA ativo SEMPRE verifica, mesmo com a exigência desligada', () => {
    expect(make(false).modeFor({ mfaEnabledAt: new Date() })).toBe('VERIFY');
    expect(make(true).modeFor({ mfaEnabledAt: new Date() })).toBe('VERIFY');
  });

  it('sem MFA: exigência ligada força a inscrição; desligada deixa passar', () => {
    expect(make(true).modeFor({ mfaEnabledAt: null })).toBe('SETUP');
    expect(make(false).modeFor({ mfaEnabledAt: null })).toBeNull();
  });
});
