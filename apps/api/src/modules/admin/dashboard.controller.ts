import { Body, Controller, Get, Header, Param, Patch, Post, Sse, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';

@Controller('professional/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROFESSIONAL')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('queue')
  @Roles('PROFESSIONAL', 'ADMIN')
  queue(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.queue(actor);
  }

  @Sse('queue/events')
  @Roles('PROFESSIONAL', 'ADMIN')
  @Header('Cache-Control', 'private, no-store, no-transform')
  @Header('X-Accel-Buffering', 'no')
  events(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.events(actor);
  }

  @Get('queue/:kind/:id')
  @Roles('PROFESSIONAL', 'ADMIN')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    return this.dashboard.detail(actor, kind, id);
  }

  @Get('queue/protocol/:id/anamnesis')
  @Roles('PROFESSIONAL', 'ADMIN')
  anamnesisAnswers(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.dashboard.anamnesisAnswers(actor, id);
  }

  /**
   * `ADMIN` (conta fundador) tem acesso total à fila, inclusive assinatura de protocolo
   * (achado 2026-08-22, decisão do fundador): a MOVIVO no início só tem um profissional
   * CREF, também sócio-fundador, e a conta dele já usa o papel de fundador. Por isso todo
   * `ADMIN` ganha as mesmas ações de `PROFESSIONAL` aqui — a segunda barreira (crédito
   * CREF ativo) continua existindo só para contas `PROFESSIONAL`, ver `signProtocol` em
   * `dashboard.service.ts`.
   */
  @Patch('protocols/:id')
  @Roles('PROFESSIONAL', 'ADMIN')
  editProtocol(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.editProtocol(actor, id, body);
  }

  @Post('protocols/:id/sign')
  @Roles('PROFESSIONAL', 'ADMIN')
  signProtocol(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.signProtocol(actor, id, body);
  }

  @Post('handoffs/:id/resolve')
  @Roles('PROFESSIONAL', 'ADMIN')
  resolveHandoff(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.resolveHandoff(actor, id, body);
  }

  @Get('operations')
  @Roles('PROFESSIONAL', 'ADMIN')
  operations(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.operations(actor);
  }
}
