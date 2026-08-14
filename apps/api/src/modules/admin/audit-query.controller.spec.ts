import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ControlCenterCapability as Capability } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { CAPABILITIES_KEY } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditQueryController } from './audit-query.controller';

const auditor: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'ADMIN',
  jti: 'jti',
};
const support: AuthenticatedUser = { ...auditor, role: 'SUPPORT' };

function contextFor(actor: AuthenticatedUser) {
  return {
    getHandler: () => AuditQueryController.prototype.search,
    getClass: () => AuditQueryController,
    switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
  } as unknown as ExecutionContext;
}

describe('AuditQueryController', () => {
  it('exige somente AUDIT_READ na consulta', () => {
    expect(Reflect.getMetadata(CAPABILITIES_KEY, AuditQueryController.prototype.search)).toEqual([
      Capability.AUDIT_READ,
    ]);
  });

  it('nega papel sem a capability e aceita auditor', () => {
    const guard = new CapabilitiesGuard(new Reflector());
    expect(() => guard.canActivate(contextFor(support))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextFor(auditor))).toBe(true);
  });
});
