/**
 * Teste-semente (c) — consumo de `@movivo/shared` (US-0.8 / TASK-0.8.3).
 *
 * Prova que o pacote compartilhado é importável e utilizável pelo backend a partir de
 * seu ponto de entrada público (`dist/index.js`, via symlink de workspace do pnpm) — a
 * mesma superfície que `apps/web` consome. Se o build de `@movivo/shared` quebrar ou o
 * barrel deixar de exportar um símbolo de contrato, este teste falha no CI antes de
 * qualquer sprint de produto depender disso.
 *
 * É um teste UNITÁRIO (sem I/O): roda no gate rápido de todo PR.
 */
import { describe, expect, it } from 'vitest';

import {
  APP_VERSION,
  API_VERSION_PREFIX,
  ProtocolStatus,
  SubscriptionStatus,
  paginationQuerySchema,
  subscriptionStatusSchema,
} from '@movivo/shared';

describe('consumo de @movivo/shared pelo backend', () => {
  it('expõe as constantes de contrato cross-app', () => {
    expect(APP_VERSION).toBe('0.1.0');
    expect(API_VERSION_PREFIX).toBe('api/v1');
  });

  it('expõe os enums de domínio usados por back e front', () => {
    expect(ProtocolStatus.PENDING_SIGNATURE).toBe('PENDING_SIGNATURE');
    expect(SubscriptionStatus.TRIALING).toBe('TRIALING');
  });

  it('expõe schemas Zod que validam de fato — fonte única do contrato', () => {
    // O schema de paginação aplica o default de limit.
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
    // O enum Zod deriva do enum de domínio, sem duplicar literais.
    expect(subscriptionStatusSchema.parse('ACTIVE')).toBe('ACTIVE');
    expect(() => subscriptionStatusSchema.parse('NAO_EXISTE')).toThrow();
  });
});
