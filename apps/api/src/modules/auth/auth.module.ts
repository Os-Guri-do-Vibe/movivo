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
 *
 * # `PassportModule.register({})` em vez do import "nu" (migração NestJS v12)
 * O `JwtAuthGuard` estende `AuthGuard(JWT_STRATEGY)` (mixin do `@nestjs/passport`), que
 * injeta `AuthModuleOptions` como `@Optional()` no construtor da classe-base do mixin — não
 * no `JwtAuthGuard` diretamente. A partir do `@nestjs/core@12`, `Injector.reflectOptionalParams`
 * passou a usar `Reflect.getOwnMetadata` (não mais `Reflect.getMetadata`, que percorre a cadeia
 * de protótipos) para achar metadata de `@Optional()` — regressão upstream que faz o parâmetro
 * herdado do mixin parecer obrigatório e quebra a resolução de DI do `JwtAuthGuard` sob
 * `Test.createTestingModule(...).compile()` (`TestingInjector`) com "Nest can't resolve
 * dependencies of the JwtAuthGuard". Registrar `AuthModuleOptions` explicitamente com
 * `.register({})` (mesmo valor-padrão `{}` que o mixin já usava) garante que o provider
 * sempre exista, contornando o bug sem depender do `@Optional()` quebrado.
 *
 * `PassportModule` também precisa estar em `exports` (não só `imports`): o `JwtAuthGuard`
 * é aplicado via `@UseGuards(JwtAuthGuard)` em controllers de outros módulos (ADMIN etc.),
 * e o mesmo bug de `@Optional()` se manifesta lá — reexportar `PassportModule` propaga
 * `AuthModuleOptions` para o escopo de DI de quem importa `AuthModule`.
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
  imports: [PassportModule.register({})],
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
    PassportModule,
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
