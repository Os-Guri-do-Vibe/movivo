import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ControlCenterCapability as Capability, saveTierRoutesRequestSchema } from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { MODEL_TIERS, type ModelTier } from '../../core/ai/ai.types';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { AgentsPanelService } from './agents-panel.service';

const costsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const tierSchema = z.enum(MODEL_TIERS as [ModelTier, ...ModelTier[]]);

@ApiTags('Admin · Agentes de IA')
@ApiBearerAuth('access-token')
@Controller('control-center/agents')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class AgentsPanelController {
  constructor(private readonly panel: AgentsPanelService) {}

  @Get()
  @RequireCapabilities(Capability.AGENTS_READ)
  @ApiOperation({ summary: 'Tarefas dos agentes, último teste de cada uma e rotas dos níveis' })
  async overview() {
    return { tasks: await this.panel.tasks(), tiers: await this.panel.tierRoutes() };
  }

  @Get('costs')
  @RequireCapabilities(Capability.AGENTS_READ, Capability.STUDENTS_READ)
  @ApiOperation({ summary: 'Custo de IA por tarefa e por aluno' })
  costs(@Query() query: unknown) {
    return this.panel.costs(parseBody(costsQuerySchema, query).days);
  }

  @Put('tiers/:tier')
  @RequireCapabilities(Capability.AGENTS_READ, Capability.MODEL_TIERS_WRITE)
  @ApiOperation({ summary: 'Troca as rotas (provedor e modelo) de um nível, sem deploy' })
  saveTier(
    @CurrentUser() user: AuthenticatedUser,
    @Param('tier') rawTier: string,
    @Body() raw: unknown,
  ) {
    return this.panel.saveTier(
      user.userId,
      parseBody(tierSchema, rawTier),
      parseBody(saveTierRoutesRequestSchema, raw),
    );
  }
}
