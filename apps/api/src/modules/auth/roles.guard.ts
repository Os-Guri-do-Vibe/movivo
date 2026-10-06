/**
 * `RolesGuard` — autorização por papel (US-1.4 / TASK-1.4.3 — Sato §9.2).
 *
 * Roda **depois** do `JwtAuthGuard` (a ordem no `@UseGuards` importa): assume que
 * `req.user` já foi resolvido. Lê os papéis exigidos por `@Roles()` e barra quem não
 * os tem. Ausência de `@Roles()` ou lista vazia nega acesso por padrão.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { TenantRole } from '../../core/database';
import type { AuthenticatedUser } from './jwt.strategy';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user || !required?.length || !required.includes(user.role)) {
      throw new ForbiddenException('Você não tem permissão para acessar este recurso.');
    }
    return true;
  }
}
