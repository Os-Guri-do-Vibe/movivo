/**
 * Unit — `RolesGuard` (US-1.4 / TASK-1.4.3): barra papel insuficiente.
 */
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import type { TenantRole } from '../../core/database';
import { RolesGuard } from './roles.guard';

function ctx(user: { role: TenantRole } | undefined) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

function guardWith(required: TenantRole[] | undefined) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it.each([undefined, []])('nega acesso sem política explícita: %s', (required) => {
    for (const role of ['USER', 'PROFESSIONAL', 'ADMIN'] as const) {
      expect(() => guardWith(required).canActivate(ctx({ role }))).toThrow(ForbiddenException);
    }
    expect(() => guardWith(required).canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('libera PROFESSIONAL num endpoint @Roles(PROFESSIONAL, ADMIN)', () => {
    expect(guardWith(['PROFESSIONAL', 'ADMIN']).canActivate(ctx({ role: 'PROFESSIONAL' }))).toBe(
      true,
    );
  });

  it('barra USER num endpoint @Roles(PROFESSIONAL, ADMIN)', () => {
    expect(() => guardWith(['PROFESSIONAL', 'ADMIN']).canActivate(ctx({ role: 'USER' }))).toThrow(
      ForbiddenException,
    );
  });

  it('barra quando não há usuário no request', () => {
    expect(() => guardWith(['ADMIN']).canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
