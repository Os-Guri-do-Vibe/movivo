/**
 * Contratos REST de autenticação (US-1.4 — Sato §9 / ADR-006).
 *
 *  - `POST /auth/login`   — Argon2id, emite access + refresh (cookie httpOnly). Rate
 *                           limit 10/min por IP (`ThrottlerGuard`, brute force — Rafael §1218).
 *  - `POST /auth/refresh` — rotation + detecção de reuse. Lê o cookie httpOnly.
 *  - `POST /auth/logout`  — denylist do `jti` + revogação da sessão (exige access válido).
 *  - `GET  /auth/me`      — sanidade autenticada (qualquer papel).
 *  - `GET  /auth/admin/ping` — sanidade RBAC: só `PROFESSIONAL`/`ADMIN` (barra `USER`).
 *
 * O refresh vive em cookie `httpOnly + Secure + SameSite=Strict`: inacessível a JS
 * (defesa contra XSS) e não enviado cross-site (defesa contra CSRF no fluxo de refresh).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { loginSchema } from '@movivo/shared';
import type { Request, Response } from 'express';

import { AppConfigService } from '../../core/config';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from './jwt.strategy';
import { capabilitiesForRole } from './capabilities';

/** Nome do cookie do refresh. Escopo de path restrito a `/auth` — não vaza em outras rotas. */
const REFRESH_COOKIE = 'movivo_refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('login')
  // Override por rota (10/min por IP) sobre o throttler global — ver AuthModule.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = loginSchema.parse(body ?? {});
    const result = await this.auth.login(input);
    this.setRefreshCookie(res, result.refreshCookie);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(cookie);
    this.setRefreshCookie(res, result.refreshCookie);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.userId, user.role, user.jti);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser) {
    const { name, avatarPath } = await this.auth.getProfile(user.userId);
    return {
      userId: user.userId,
      role: user.role,
      name,
      avatarUrl: this.config.avatarUrl(avatarPath),
      capabilities: capabilitiesForRole(user.role),
    };
  }

  @Get('admin/ping')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROFESSIONAL', 'ADMIN')
  adminPing(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, role: user.role };
  }

  private setRefreshCookie(res: Response, value: string): void {
    res.cookie(REFRESH_COOKIE, value, this.cookieOptions(this.config.jwt.refreshTtlSeconds * 1000));
  }

  private cookieOptions(maxAgeMs: number) {
    return {
      httpOnly: true,
      // `Secure` só fora de dev: em teste/local o cookie viaja por http (supertest).
      secure: this.config.isProduction,
      sameSite: 'strict' as const,
      path: '/api/v1/auth',
      maxAge: maxAgeMs,
    };
  }
}
