import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ControlCenterCapability } from '@movivo/shared';

import type { AuthenticatedUser } from './jwt.strategy';
import { roleHasCapabilities } from './capabilities';
import { CAPABILITIES_KEY } from './capabilities.decorator';

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ControlCenterCapability[] | undefined>(
      CAPABILITIES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const actor = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!actor || !required || !roleHasCapabilities(actor.role, required)) {
      throw new ForbiddenException('Você não tem capacidade para acessar este recurso.');
    }
    return true;
  }
}
