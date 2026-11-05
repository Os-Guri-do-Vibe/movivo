import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ControlCenterCapability as Capability,
  simulateAgentConfigSchema,
  type ConfigSimulationResponse,
} from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  simulateFaqConfig,
  simulateForbiddenTopicConfig,
  simulateL1GuardrailConfig,
} from './config-gate';

@ApiTags('Admin · Governança do atendimento')
@ApiBearerAuth('access-token')
@Controller('control-center/ai')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ConfigGateController {
  @Post('simulate')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Roda o gate de publicação (FAQ, guardrail L1, tema proibido) sem publicar',
    description:
      'O mesmo gate roda dentro da publicação: a tela só antecipa o resultado. Nenhum modelo é chamado.',
  })
  simulate(@Body() raw: unknown): ConfigSimulationResponse {
    const input = parseBody(simulateAgentConfigSchema, raw);
    const data =
      input.kind === 'FAQ'
        ? simulateFaqConfig(input.candidate)
        : input.kind === 'GUARDRAIL'
          ? simulateL1GuardrailConfig(input.candidate)
          : simulateForbiddenTopicConfig(input.candidate);
    return {
      data: data as ConfigSimulationResponse['data'],
      meta: {
        generatedAt: new Date().toISOString(),
        timezone: 'America/Sao_Paulo',
        dataQuality: ['Gate determinístico: nenhum modelo é chamado e nada é publicado.'],
      },
    };
  }
}
