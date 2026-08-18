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

  @Get('queue/parq/:id/anamnesis')
  @Roles('PROFESSIONAL', 'ADMIN')
  parqAnamnesisAnswers(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.dashboard.parqAnamnesisAnswers(actor, id);
  }

  @Patch('protocols/:id')
  editProtocol(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.editProtocol(actor, id, body);
  }

  @Post('protocols/:id/sign')
  signProtocol(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.signProtocol(actor, id, body);
  }

  @Post('parq/:id/release')
  releaseParq(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.releaseParq(actor, id, body);
  }

  @Post('handoffs/:id/resolve')
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
