import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ControlCenterCapability as Capability } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { CAPABILITIES_KEY } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { FaqAdminController } from './faq-admin.controller';

const engineer: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'ENGINEERING',
  jti: 'jti',
};
const reader: AuthenticatedUser = { ...engineer, role: 'PROFESSIONAL' };

function contextFor(actor: AuthenticatedUser, handler: (...args: never[]) => unknown) {
  return {
    getHandler: () => handler,
    getClass: () => FaqAdminController,
    switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
  } as unknown as ExecutionContext;
}

describe('FaqAdminController', () => {
  it.each([
    ['list', [Capability.AI_CONFIG_READ]],
    ['publish', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
    ['rollback', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
    ['retire', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
  ] as const)('declara capability em %s', (method, expected) => {
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        FaqAdminController.prototype[method] as (...args: never[]) => unknown,
      ),
    ).toEqual(expected);
  });

  it('leitor consulta, mas recebe 403 nas mutações', () => {
    const guard = new CapabilitiesGuard(new Reflector());
    expect(guard.canActivate(contextFor(reader, FaqAdminController.prototype.list))).toBe(true);
    for (const handler of [
      FaqAdminController.prototype.publish,
      FaqAdminController.prototype.rollback,
      FaqAdminController.prototype.retire,
    ]) {
      expect(() => guard.canActivate(contextFor(reader, handler))).toThrow(ForbiddenException);
    }
  });
});
