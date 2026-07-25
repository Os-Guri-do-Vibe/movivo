/**
 * `@Roles()` + `@CurrentUser()` — metadados de RBAC (US-1.4 / TASK-1.4.3 — Sato §9.2).
 */
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

import type { TenantRole } from '../../core/database';
import type { AuthenticatedUser } from './jwt.strategy';

export const ROLES_KEY = 'roles';

/** Restringe o handler aos papéis listados. Sem o decorator, qualquer autenticado passa. */
export const Roles = (...roles: TenantRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Injeta o `AuthenticatedUser` resolvido pelo `JwtStrategy` (req.user). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user;
  },
);
