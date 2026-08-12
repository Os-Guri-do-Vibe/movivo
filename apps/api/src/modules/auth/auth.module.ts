/**
 * `AuthModule` — JWT RS256 + refresh rotation + RBAC (US-1.4).
 *
 * Consome apenas o CORE por DI (config, banco, Redis, logger — todos `@Global()`), sem
 * importar outro módulo de domínio (regra §12.5 — sem imports circulares).
 *
 * # Rate limit do login (10/min por IP — brute force, Rafael §1218)
 * O `ThrottlerModule.forRoot` do `@nestjs/throttler` é **global e last-wins**: registrar
 * um segundo `forRoot` aqui sobrescreveria a config global (a do `AnamnesisModule`, 60/min)
 * e vice-versa. Por isso NÃO chamamos `forRoot` — usamos o `ThrottlerModule` global já
 * existente e sobrescrevemos só a rota de login com `@Throttle({ default: { limit: 10 } })`
 * (padrão idiomático: um throttler global + override por rota). O `ThrottlerGuard` resolve
 * storage/options do módulo global. ponytail: storage em memória (single-instance MVP);
 * trocar por storage Redis quando a API escalar horizontalmente.
 */
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CapabilitiesGuard } from './capabilities.guard';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { TokenDenylistService } from './token-denylist.service';
import { TokenService } from './token.service';
import { UserRoleCacheService } from './user-role-cache.service';

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TokenDenylistService,
    PasswordService,
    UserRoleCacheService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    CapabilitiesGuard,
  ],
  exports: [
    AuthService,
    TokenService,
    PasswordService,
    UserRoleCacheService,
    JwtAuthGuard,
    RolesGuard,
    CapabilitiesGuard,
  ],
})
export class AuthModule {}
