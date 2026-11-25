import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  agentProfileUpdateSchema,
  ControlCenterCapability as Capability,
  saveTierRoutesRequestSchema,
} from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { MODEL_TIERS, type ModelTier } from '../../core/ai/ai.types';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { AgentProfilesService, parseAgent, view } from './agent-profiles.service';
import { AgentsPanelService } from './agents-panel.service';

const costsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) });
const tierSchema = z.enum(MODEL_TIERS as [ModelTier, ...ModelTier[]]);

@ApiTags('Admin · Agentes de IA')
@ApiBearerAuth('access-token')
@Controller('control-center/agents')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class AgentsPanelController {
  constructor(
    private readonly panel: AgentsPanelService,
    private readonly profilesService: AgentProfilesService,
  ) {}

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

  @Get('profiles')
  @RequireCapabilities(Capability.AGENTS_READ)
  @ApiOperation({ summary: 'Ficha de cada agente: versão publicada e rascunho aberto' })
  async profiles() {
    return { data: await this.profilesService.overview() };
  }

  @Post('profiles/:agent/drafts')
  @RequireCapabilities(Capability.AGENTS_READ, Capability.AGENT_PROFILES_WRITE)
  @ApiOperation({ summary: 'Abre (ou devolve) o rascunho da ficha do agente' })
  async openProfileDraft(@CurrentUser() user: AuthenticatedUser, @Param('agent') agent: string) {
    return { data: view(await this.profilesService.openDraft(parseAgent(agent), user.userId)) };
  }

  @Post('profiles/documents/:id/update')
  @RequireCapabilities(Capability.AGENTS_READ, Capability.AGENT_PROFILES_WRITE)
  @ApiOperation({ summary: 'Edita o rascunho da ficha (volta para rascunho e invalida testes)' })
  async updateProfile(@Param('id', ParseUUIDPipe) id: string, @Body() raw: unknown) {
    return {
      data: view(
        await this.profilesService.updateDraft(id, parseBody(agentProfileUpdateSchema, raw)),
      ),
    };
  }

  @Post('profiles/documents/:id/test')
  @RequireCapabilities(Capability.AGENTS_READ, Capability.AGENT_PROFILES_WRITE)
  @ApiOperation({ summary: 'Roda os casos de avaliação das tarefas do agente com o rascunho' })
  async testProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.profilesService.test(id, user.userId) };
  }

  @Post('profiles/documents/:id/publish')
  @RequireCapabilities(Capability.AGENTS_READ, Capability.AGENT_PROFILES_WRITE)
  @ApiOperation({ summary: 'Publica a ficha aprovada nos testes' })
  async publishProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: view(await this.profilesService.publish(id, user.userId)) };
  }

  @Post('profiles/documents/:id/discard')
  @RequireCapabilities(Capability.AGENTS_READ, Capability.AGENT_PROFILES_WRITE)
  @ApiOperation({ summary: 'Descarta o rascunho da ficha' })
  async discardProfile(@Param('id', ParseUUIDPipe) id: string) {
    await this.profilesService.discardDraft(id);
    return { data: { discarded: true } };
  }
}
