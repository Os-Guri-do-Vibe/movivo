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
import {
  loginSchema,
  mfaEnableSchema,
  mfaSetupResponseSchema,
  mfaSetupSchema,
  mfaVerifySchema,
} from '@movivo/shared';
import type { Request, Response } from 'express';

import { AppConfigService } from '../../core/config';
import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { parseBody } from '../../core/validation/strict-input';
import { accessMetaFrom } from './auth-audit.service';
import { AuthService, isMfaChallenge } from './auth.service';
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
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseBody(loginSchema, body ?? {});
    const result = await this.auth.login(input, accessMetaFrom(req));
    // Senha certa + 2º fator pendente: devolve só o desafio (sem cookie, sem access token).
    if (isMfaChallenge(result)) return result;
    this.setRefreshCookie(res, result.refreshCookie, result.refreshExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('mfa/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Passo 2 do login — código do 2º fator',
    description:
      'Resolve o desafio devolvido por `POST /auth/login` com o código de 6 dígitos do app ' +
      'autenticador (ou um código de recuperação). Cada código TOTP vale uma única vez. 5 ' +
      'erros destroem o desafio; 10 erros em 15 min travam a conta para novos códigos (429).',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(mfaVerifySchema) })
  @ApiResponse({ status: 200, description: 'Sessão emitida (access no corpo, refresh no cookie).' })
  @ApiResponse({ status: 401, description: 'Código inválido ou desafio expirado.' })
  @ApiResponse({ status: 429, description: 'Conta travada por excesso de tentativas.' })
  async mfaVerify(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseBody(mfaVerifySchema, body ?? {});
    const result = await this.auth.completeMfaLogin(
      input.challengeToken,
      input.code,
      accessMetaFrom(req),
    );
    this.setRefreshCookie(res, result.refreshCookie, result.refreshExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('mfa/setup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inscrição no 2º fator — segredo e URI do QR',
    description:
      'Só para o desafio `setup` (instalação exige MFA e a conta ainda não tem). Idempotente ' +
      'dentro do mesmo desafio: devolve sempre o mesmo segredo, que só é gravado na conta ' +
      'depois de `POST /auth/mfa/enable` confirmar um código.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(mfaSetupSchema) })
  @ApiResponse({ status: 200, schema: zodSchemaToOpenApi(mfaSetupResponseSchema) })
  @ApiResponse({ status: 401, description: 'Desafio inválido, expirado ou de outro tipo.' })
  async mfaSetup(@Body() body: unknown) {
    const input = parseBody(mfaSetupSchema, body ?? {});
    return this.auth.startMfaSetup(input.challengeToken);
  }

  @Post('mfa/enable')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirma a inscrição no 2º fator e entra',
    description:
      'Valida o 1º código do app, ativa o MFA, emite a sessão e devolve os códigos de ' +
      'recuperação — **a única vez em que aparecem em claro**.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(mfaEnableSchema) })
  @ApiResponse({ status: 200, description: 'MFA ativo; sessão emitida + `recoveryCodes`.' })
  @ApiResponse({ status: 401, description: 'Código inválido ou desafio expirado.' })
  @ApiResponse({ status: 429, description: 'Conta travada por excesso de tentativas.' })
  async mfaEnable(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = parseBody(mfaEnableSchema, body ?? {});
    const result = await this.auth.enableMfa(input.challengeToken, input.code, accessMetaFrom(req));
    this.setRefreshCookie(res, result.refreshCookie, result.refreshExpiresAt);
    return {
      accessToken: result.accessToken,
      user: result.user,
      recoveryCodes: result.recoveryCodes,
    };
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
  @ApiResponse({ status: 409, description: 'Cookie rotacionado por requisição concorrente.' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(cookie, accessMetaFrom(req));
    this.setRefreshCookie(res, result.refreshCookie, result.refreshExpiresAt);
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
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user.userId, user.role, user.jti, accessMetaFrom(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions(0));
  }

  @Post('logout/refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('movivo_refresh')
  @ApiOperation({ summary: 'Encerra a família da sessão mesmo após expiração do access token' })
  @ApiResponse({ status: 204, description: 'Sessão revogada no servidor.' })
  @ApiResponse({ status: 401, description: 'Refresh ausente ou inválido.' })
  async logoutRefresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logoutRefresh(
      (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE],
      accessMetaFrom(req),
    );
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

  private setRefreshCookie(res: Response, value: string, expiresAt: Date): void {
    res.cookie(
      REFRESH_COOKIE,
      value,
      this.cookieOptions(Math.max(0, expiresAt.getTime() - Date.now())),
    );
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
