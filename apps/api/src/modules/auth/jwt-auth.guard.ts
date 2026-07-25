/**
 * `JwtAuthGuard` — exige um access token RS256 válido (US-1.4).
 *
 * Fino de propósito: toda a lógica (algoritmo fixo, kid, denylist) está no
 * `JwtStrategy`. Este guard só o aciona via passport e injeta o `AuthenticatedUser`
 * em `req.user` para o `@CurrentUser()` e o `RolesGuard`.
 */
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { JWT_STRATEGY } from './jwt.strategy';

@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY) {}
