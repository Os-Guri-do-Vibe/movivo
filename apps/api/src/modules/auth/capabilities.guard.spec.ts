import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ADMIN_INHERITANCE_DENYLIST,
  ControlCenterCapability as Capability,
  type ControlCenterCapability,
  type ControlCenterRole,
} from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from './jwt.strategy';
import { capabilitiesForRole } from './capabilities';
import { CapabilitiesGuard } from './capabilities.guard';

function context(role?: ControlCenterRole) {
  const user: AuthenticatedUser | undefined = role
    ? { userId: '11111111-1111-4111-8111-111111111111', role, jti: 'jti' }
    : undefined;
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

function guard(required?: ControlCenterCapability[]) {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  return new CapabilitiesGuard(reflector);
}

describe('capabilities deny-by-default', () => {
  it('nega endpoint sem política declarada e request sem ator', () => {
    expect(() => guard(undefined).canActivate(context('ADMIN'))).toThrow(ForbiddenException);
    expect(() => guard([Capability.OVERVIEW_READ]).canActivate(context())).toThrow(
      ForbiddenException,
    );
  });

  const matrix: Array<{
    role: ControlCenterRole;
    allowed: readonly ControlCenterCapability[];
  }> = [
    { role: 'USER', allowed: [] },
    {
      role: 'PROFESSIONAL',
      allowed: [
        Capability.STUDENTS_READ,
        Capability.STUDENTS_HEALTH_READ,
        Capability.AI_CONFIG_READ,
        Capability.AI_KNOWLEDGE_APPROVE,
        Capability.AI_METHODOLOGY_APPROVE,
        Capability.AI_GUARDRAIL_APPROVE,
      ],
    },
    {
      role: 'MARKETING',
      allowed: [Capability.MARKETING_READ, Capability.MARKETING_WRITE],
    },
    {
      role: 'FINANCE',
      allowed: [Capability.FINANCE_READ, Capability.FINANCE_WRITE],
    },
    {
      role: 'SUPPORT',
      allowed: [Capability.SUPPORT_READ, Capability.STUDENTS_READ],
    },
    {
      role: 'ENGINEERING',
      allowed: [
        Capability.SYSTEM_READ,
        Capability.SYSTEM_OPERATE,
        Capability.AI_CONFIG_READ,
        Capability.AI_CONFIG_WRITE,
      ],
    },
    {
      role: 'DPO',
      allowed: [Capability.COMPLIANCE_READ, Capability.AUDIT_READ],
    },
  ];

  for (const { role, allowed } of matrix) {
    it(`${role} recebe somente suas capacidades setoriais`, () => {
      expect(capabilitiesForRole(role)).toEqual(allowed);
      for (const capability of Object.values(Capability)) {
        const check = () => guard([capability]).canActivate(context(role));
        if (allowed.includes(capability)) expect(check()).toBe(true);
        else expect(check).toThrow(ForbiddenException);
      }
    });
  }

  it('ADMIN recebe todas as capacidades explícitas, exceto a denylist de aprovação clínica', () => {
    const expected = Object.values(Capability).filter(
      (capability) => !ADMIN_INHERITANCE_DENYLIST.includes(capability),
    );
    expect(capabilitiesForRole('ADMIN')).toEqual(expected);
    for (const capability of Object.values(Capability)) {
      const check = () => guard([capability]).canActivate(context('ADMIN'));
      if (ADMIN_INHERITANCE_DENYLIST.includes(capability)) {
        expect(check).toThrow(ForbiddenException);
      } else {
        expect(check()).toBe(true);
      }
    }
  });

  it('ADMIN não herda as capacidades da denylist (aprovação clínica é exclusiva do RT CREF)', () => {
    const admin = capabilitiesForRole('ADMIN');
    for (const capability of ADMIN_INHERITANCE_DENYLIST) {
      expect(admin).not.toContain(capability);
    }
  });
});
