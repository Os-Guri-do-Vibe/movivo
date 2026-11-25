import { Controller, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MessageQualityService } from './message-quality.service';

@ApiTags('Admin · Qualidade dos agentes')
@ApiBearerAuth('access-token')
@Controller('control-center/quality')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class MessageQualityController {
  constructor(private readonly quality: MessageQualityService) {}

  @Get('summary')
  @RequireCapabilities(Capability.SYSTEM_READ)
  @ApiOperation({
    summary: 'Qualidade das mensagens dos agentes e eficácia dos contatos proativos',
    description:
      'Por fluxo: mensagens auditadas, parte revisada pelo juiz, taxa de revisão, nota média e repetição. Por abordagem: contatos enviados e taxa de resposta do aluno.',
  })
  summary(@Query('days', new ParseIntPipe({ optional: true })) days?: number) {
    return this.quality.summary(days && days > 0 ? Math.min(days, 180) : 30);
  }
}
