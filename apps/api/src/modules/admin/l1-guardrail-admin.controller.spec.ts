import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ControlCenterCapability as Capability } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { CAPABILITIES_KEY } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { L1GuardrailAdminController } from './l1-guardrail-admin.controller';

const engineer: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'ENGINEERING',
  jti: 'jti',
};
const reader: AuthenticatedUser = { ...engineer, role: 'PROFESSIONAL' };

function contextFor(actor: AuthenticatedUser, handler: (...args: never[]) => unknown) {
  return {
    getHandler: () => handler,
    getClass: () => L1GuardrailAdminController,
    switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
  } as unknown as ExecutionContext;
}

describe('L1GuardrailAdminController', () => {
  it.each([
    ['list', [Capability.AI_CONFIG_READ]],
    ['publish', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
    ['rollback', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
    ['retire', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
  ] as const)('declara capability em %s', (method, expected) => {
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        L1GuardrailAdminController.prototype[method] as (...args: never[]) => unknown,
      ),
    ).toEqual(expected);
  });

  it('leitor consulta, mas não publica', () => {
    const guard = new CapabilitiesGuard(new Reflector());
    expect(guard.canActivate(contextFor(reader, L1GuardrailAdminController.prototype.list))).toBe(
      true,
    );
    expect(() =>
      guard.canActivate(contextFor(reader, L1GuardrailAdminController.prototype.publish)),
    ).toThrow(ForbiddenException);
  });
});
