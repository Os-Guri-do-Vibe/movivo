/**
 * Testes dos schemas/enums compartilhados (US-0.8, Mariana).
 *
 * `@movivo/shared` é a fonte única do contrato entre back e front. Estes testes travam
 * o comportamento que ambos os lados assumem — se um schema mudar sem querer, o CI pega
 * aqui antes de qualquer app quebrar. É lógica pura e isomórfica: roda sem infra.
 */
import { describe, expect, it } from 'vitest';

import { ProtocolStatus, SubscriptionStatus } from '../enums';
import { paginationQuerySchema, subscriptionStatusSchema, uuidSchema } from './common.schema';

describe('paginationQuerySchema', () => {
  it('aplica o limit default de 20 quando ausente', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('coage limit numérico e rejeita acima do teto de 100', () => {
    expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(() => paginationQuerySchema.parse({ limit: 101 })).toThrow();
  });
});

describe('subscriptionStatusSchema', () => {
  it('deriva do enum de domínio, sem duplicar literais', () => {
    for (const status of Object.values(SubscriptionStatus)) {
      expect(subscriptionStatusSchema.parse(status)).toBe(status);
    }
    expect(() => subscriptionStatusSchema.parse('INEXISTENTE')).toThrow();
  });
});

describe('uuidSchema', () => {
  it('aceita UUID válido e rejeita string arbitrária', () => {
    expect(uuidSchema.parse('11111111-1111-4111-8111-111111111111')).toBeTruthy();
    expect(() => uuidSchema.parse('nao-e-uuid')).toThrow();
  });
});

describe('ProtocolStatus', () => {
  it('inclui PENDING_SIGNATURE — o gate de assinatura CREF é estrutural', () => {
    expect(ProtocolStatus.PENDING_SIGNATURE).toBe('PENDING_SIGNATURE');
  });
});
