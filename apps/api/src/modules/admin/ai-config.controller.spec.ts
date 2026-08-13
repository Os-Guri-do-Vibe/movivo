import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ControlCenterCapability as Capability } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { CAPABILITIES_KEY } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AiConfigController } from './ai-config.controller';
import type { AiConfigService } from './ai-config.service';

const engineer: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'ENGINEERING',
  jti: 'jti',
};
/** RT CREF: tem `AI_CONFIG_READ` e **não** tem `AI_CONFIG_WRITE`. */
const reader: AuthenticatedUser = { ...engineer, role: 'PROFESSIONAL' };

function contextFor(actor: AuthenticatedUser, handler: (...args: never[]) => unknown) {
  return {
    getHandler: () => handler,
    getClass: () => AiConfigController,
    switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
  } as unknown as ExecutionContext;
}

describe('AiConfigController', () => {
  it.each([
    ['persona', [Capability.AI_CONFIG_READ]],
    ['history', [Capability.AI_CONFIG_READ]],
    ['inviolableRules', [Capability.AI_CONFIG_READ]],
    ['publish', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
    ['rollback', [Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE]],
  ] as const)('declara capability em %s', (method, expected) => {
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        AiConfigController.prototype[method] as (...args: never[]) => unknown,
      ),
    ).toEqual(expected);
  });

  it('leitor (AI_CONFIG_READ sem WRITE) recebe 403 no endpoint de publicação e no rollback', () => {
    const guard = new CapabilitiesGuard(new Reflector());
    for (const handler of [
      AiConfigController.prototype.publish,
      AiConfigController.prototype.rollback,
    ]) {
      expect(() => guard.canActivate(contextFor(reader, handler))).toThrow(ForbiddenException);
    }
    expect(guard.canActivate(contextFor(reader, AiConfigController.prototype.persona))).toBe(true);
    expect(guard.canActivate(contextFor(engineer, AiConfigController.prototype.publish))).toBe(
      true,
    );
  });

  it('encaminha o ator autenticado para a auditoria da publicação', async () => {
    const publish = vi.fn().mockResolvedValue({ data: {}, meta: {} });
    const controller = new AiConfigController({ publish } as unknown as AiConfigService);
    await controller.publish(engineer, { payload: {}, changeNote: 'ajuste de tom' });
    expect(publish).toHaveBeenCalledWith(engineer, {
      payload: {},
      changeNote: 'ajuste de tom',
    });
  });
});
