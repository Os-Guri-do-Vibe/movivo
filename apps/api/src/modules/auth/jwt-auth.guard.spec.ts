/**
 * Unit — `JwtAuthGuard`: aciona a estratégia 'jwt' do passport (sem lógica própria).
 */
import { describe, expect, it } from 'vitest';

import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('é instanciável e é um guard da estratégia jwt', () => {
    const guard = new JwtAuthGuard();
    expect(guard).toBeInstanceOf(JwtAuthGuard);
    expect(typeof guard.canActivate).toBe('function');
  });
});
