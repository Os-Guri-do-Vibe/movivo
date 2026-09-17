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
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { loginSchema } from '@movivo/shared';
import type { Request, Response } from 'express';

import { AppConfigService } from '../../core/config';
import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from './jwt.strategy';
import { capabilitiesForRole } from './capabilities';

/** Nome do cookie do refresh. Escopo de path restrito a `/auth` — não vaza em outras rotas. */
const REFRESH_COOKIE = 'movivo_refresh';

@ApiTags('Auth')
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
  @ApiOperation({
    summary: 'Login (e-mail + senha)',
    description:
      'Autentica uma conta interna (PROFESSIONAL/ADMIN) com Argon2id. Emite um access ' +
      'token (corpo da resposta) e um refresh token, que viaja **somente** no cookie ' +
      'httpOnly `movivo_refresh` — nunca aparece no JSON de resposta. Rate limit de ' +
      '10 requisições/min por IP para conter brute force.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(loginSchema) })
  @ApiResponse({
    status: 200,
    description: 'Login efetuado. Retorna accessToken e dados básicos do usuário.',
  })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema (e-mail inválido, senha ausente).',
  })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas.' })
  @ApiResponse({ status: 429, description: 'Rate limit de login excedido para o IP de origem.' })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = loginSchema.parse(body ?? {});
    const result = await this.auth.login(input);
    this.setRefreshCookie(res, result.refreshCookie);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('movivo_refresh')
  @ApiOperation({
    summary: 'Renova a sessão (rotation)',
    description:
      'Lê o cookie httpOnly `movivo_refresh`, rotaciona o refresh token (o anterior é ' +
      'invalidado) e emite um novo access token. Detecta reuse de um refresh já ' +
      'rotacionado como sinal de token roubado e revoga a sessão inteira nesse caso.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sessão renovada. Novo accessToken e cookie de refresh rotacionado.',
  })
  @ApiResponse({
    status: 401,
    description: 'Cookie ausente, expirado, ou reuse de refresh detectado.',
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(cookie);
    this.setRefreshCookie(res, result.refreshCookie);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Logout',
    description:
      'Coloca o `jti` do access token atual em denylist (o token para de ser aceito ' +
      'mesmo antes de expirar) e revoga a sessão do refresh. Limpa o cookie de refresh.',
  })
  @ApiResponse({ status: 204, description: 'Logout efetuado — sem corpo de resposta.' })
  @ApiResponse({ status: 401, description: 'Access token ausente, expirado ou já denylistado.' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.userId, user.role, user.jti);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Identidade da conta autenticada',
    description:
      'Sanidade autenticada — qualquer papel. Usada pelo dashboard para hidratar o header (nome, avatar, capabilities de UI derivadas do papel).',
  })
  @ApiResponse({
    status: 200,
    description: 'Dados da conta autenticada e capabilities de UI para o papel.',
  })
  @ApiResponse({ status: 401, description: 'Access token ausente ou inválido.' })
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
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Sanidade de RBAC (somente PROFESSIONAL/ADMIN)',
    description:
      'Endpoint de diagnóstico para confirmar que o RBAC está barrando o papel USER corretamente. Sem uso funcional no produto.',
  })
  @ApiResponse({ status: 200, description: 'Papel autorizado — retorna o próprio papel do token.' })
  @ApiResponse({
    status: 403,
    description: 'Papel USER tentando acessar rota restrita a PROFESSIONAL/ADMIN.',
  })
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
