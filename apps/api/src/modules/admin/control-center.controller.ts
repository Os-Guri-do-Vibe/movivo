import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { CurrentUser } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ControlCenterService } from './control-center.service';

@Controller('control-center')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ControlCenterController {
  constructor(private readonly controlCenter: ControlCenterService) {}

  @Get('overview')
  @RequireCapabilities(Capability.OVERVIEW_READ)
  overview(@CurrentUser() actor: AuthenticatedUser) {
    return this.controlCenter.overview(actor);
  }

  @Get('marketing')
  @RequireCapabilities(Capability.MARKETING_READ)
  marketing() {
    return this.controlCenter.marketing();
  }

  @Get('campaigns')
  @RequireCapabilities(Capability.MARKETING_READ)
  campaigns() {
    return this.controlCenter.campaigns();
  }

  @Get('students')
  @RequireCapabilities(Capability.STUDENTS_READ)
  students(@CurrentUser() actor: AuthenticatedUser) {
    return this.controlCenter.students(actor);
  }

  /**
   * Ficha unificada do aluno (US-7.4). `STUDENTS_READ` abre a ficha; a **seção de
   * saúde** (PAR-Q, relato de dor, evolução declarada, conteúdo de conversa) só entra
   * no payload para quem também tem `STUDENTS_HEALTH_READ` — o corte é no serviço, não
   * na UI. Suporte abre a mesma ficha e recebe `health: null`.
   *
   * `days` recorta a timeline por período (1..365).
   */
  @Get('students/:id')
  @RequireCapabilities(Capability.STUDENTS_READ)
  student(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('days', new ParseIntPipe({ optional: true })) days?: number,
  ) {
    const period = days && days > 0 ? Math.min(days, 365) : undefined;
    return this.controlCenter.student(actor, id, period);
  }

  @Get('system')
  @RequireCapabilities(Capability.SYSTEM_READ)
  system() {
    return this.controlCenter.system();
  }

  @Get('finance')
  @RequireCapabilities(Capability.FINANCE_READ)
  finance() {
    return this.controlCenter.finance();
  }

  /**
   * Painel "Sistema → Integração" — ferramenta INTERNA de teste do fluxo de WhatsApp
   * via EvolutionAPI (QR Code), usada enquanto a criação de templates da AraraHQ está
   * bloqueada. Nunca é o canal de produção dos usuários finais. Reusa `SYSTEM_READ`/
   * `SYSTEM_OPERATE` — não é uma capacidade própria (é literalmente uma operação de
   * sistema, o mesmo pilar de "Saúde & Disponibilidade").
   */
  @Get('integration')
  @RequireCapabilities(Capability.SYSTEM_READ)
  integration() {
    return this.controlCenter.integration();
  }

  @Post('integration/whatsapp/instance')
  @RequireCapabilities(Capability.SYSTEM_OPERATE)
  createWhatsappInstance(@Body() body: unknown) {
    return this.controlCenter.createWhatsappInstance(body);
  }

  @Get('compliance')
  @RequireCapabilities(Capability.COMPLIANCE_READ, Capability.AUDIT_READ)
  compliance() {
    return this.controlCenter.compliance();
  }

  @Post('admin/subjects/:id/anonymize')
  @RequireCapabilities(Capability.ADMIN_DESTRUCTIVE_REQUEST)
  denyUnsafeAnonymization(@Param('id', new ParseUUIDPipe({ version: '4' })) _id: string): never {
    throw new ConflictException({
      code: 'STEP_UP_REQUIRED_NOT_IMPLEMENTED',
      status: 'UNAVAILABLE',
      message:
        'A anonimização permanece bloqueada até existir step-up e workflow de retenção auditável.',
    });
  }
}
