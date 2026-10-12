import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ControlCenterCapability as Capability } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { CAPABILITIES_KEY } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { SystemScriptsController } from './system-scripts.controller';

const admin: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'ADMIN',
  jti: 'jti',
};

function contextFor(actor: AuthenticatedUser, handler: (...args: never[]) => unknown) {
  return {
    getHandler: () => handler,
    getClass: () => SystemScriptsController,
    switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
  } as unknown as ExecutionContext;
}

describe('SystemScriptsController', () => {
  it.each(['list', 'run'] as const)('%s exige SYSTEM_OPERATE', (method) => {
    expect(
      Reflect.getMetadata(CAPABILITIES_KEY, SystemScriptsController.prototype[method]),
    ).toEqual([Capability.SYSTEM_OPERATE]);
  });

  it.each(['SUPPORT', 'MARKETING', 'FINANCE', 'PROFESSIONAL', 'DPO'] as const)(
    'nega %s, que não opera o sistema',
    (role) => {
      const guard = new CapabilitiesGuard(new Reflector());
      const context = contextFor({ ...admin, role }, SystemScriptsController.prototype.run);
      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    },
  );

  it.each(['ADMIN', 'ENGINEERING'] as const)('aceita %s', (role) => {
    const guard = new CapabilitiesGuard(new Reflector());
    const context = contextFor({ ...admin, role }, SystemScriptsController.prototype.run);
    expect(guard.canActivate(context)).toBe(true);
  });
});
