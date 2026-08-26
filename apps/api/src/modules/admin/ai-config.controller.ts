/**
 * Rotas do pilar IA do Control Center (US-7.7).
 *
 * Leitura sob `AI_CONFIG_READ`; **publicar e reverter exigem `AI_CONFIG_WRITE` no
 * servidor** — quem tem só leitura recebe 403 aqui mesmo chamando o endpoint direto, sem
 * depender de a UI esconder o botão (TASK-7.7.5).
 *
 * ## Slot da persona (Sprint 11)
 * Toda rota de persona é escopada a um dos dois públicos (`MALE`/`FEMALE`): `targetSex` é
 * **query param nos GETs** e **campo do corpo nos POSTs**. `POST /simulate` é a exceção
 * deliberada: os quatro checks do simulador não dependem do público, então exigir o slot ali
 * seria contrato morto.
 */
import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  biologicalSexSchema,
  ControlCenterCapability as Capability,
  type BiologicalSex,
} from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { AiConfigService } from './ai-config.service';

/**
 * Slot da persona vindo da query string dos GETs.
 *
 * **Query param, nunca path param** (`persona/:targetSex`): a rota `persona/history` já
 * ocupa esse segmento, e um path param genérico competiria com ela na resolução de rotas do
 * Nest — `GET /persona/history` casaria com `targetSex = 'history'` dependendo da ordem de
 * registro. Nos POSTs o slot vai no corpo, validado pelo Zod junto do resto do payload.
 */
function parseTargetSex(raw: unknown): BiologicalSex {
  const parsed = biologicalSexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'INVALID_INPUT',
      message: 'targetSex é obrigatório e precisa ser MALE ou FEMALE.',
    });
  }
  return parsed.data;
}

@Controller('control-center/ai')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class AiConfigController {
  constructor(private readonly aiConfig: AiConfigService) {}

  @Get('persona')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  persona(@Query('targetSex') targetSex: unknown) {
    return this.aiConfig.persona(parseTargetSex(targetSex));
  }

  @Get('persona/history')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  history(@Query('targetSex') targetSex: unknown) {
    return this.aiConfig.history(parseTargetSex(targetSex));
  }

  @Get('inviolable-rules')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  inviolableRules(@Query('targetSex') targetSex: unknown) {
    return this.aiConfig.inviolableRules(parseTargetSex(targetSex));
  }

  @Post('simulate')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  simulate(@Body() body: unknown) {
    return this.aiConfig.simulate(body);
  }

  @Post('persona')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.aiConfig.publish(actor, body);
  }

  @Post('persona/rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  rollback(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.aiConfig.rollback(actor, body);
  }
}
