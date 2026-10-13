import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardNotificationsService } from './dashboard-notifications.service';

@ApiTags('Admin · Dashboard')
@ApiBearerAuth('access-token')
@Controller('professional/dashboard/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROFESSIONAL', 'ADMIN')
export class DashboardNotificationsController {
  constructor(private readonly notifications: DashboardNotificationsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Notificações do sino (alertas + Fila do Profissional) com estado de leitura',
  })
  @ApiResponse({ status: 200, description: 'Itens do popover, total pendente e não lidas.' })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.list(actor);
  }

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Contagem de não lidas e de alertas de segurança abertos' })
  @ApiResponse({ status: 200, description: 'Números do badge, sem dados de aluno.' })
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.notifications.summary(actor);
  }

  @Post('read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca uma notificação como lida para a conta atual (idempotente)' })
  @ApiResponse({ status: 200, description: 'Leitura registrada.' })
  markRead(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.notifications.markRead(actor, body);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca como lidas todas as pendências existentes até `until`' })
  @ApiResponse({ status: 200, description: 'Leituras registradas.' })
  markAllRead(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.notifications.markAllRead(actor, body);
  }
}
