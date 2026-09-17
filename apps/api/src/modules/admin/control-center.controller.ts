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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  controlCenterOverviewResponseSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { CurrentUser } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ControlCenterService } from './control-center.service';

@ApiTags('Admin · Central de Controle')
@ApiBearerAuth('access-token')
@Controller('control-center')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ControlCenterController {
  constructor(private readonly controlCenter: ControlCenterService) {}

  @Get('overview')
  @RequireCapabilities(Capability.OVERVIEW_READ)
  @ApiOperation({
    summary: 'Visão geral — uma linha por pilar de decisão',
    description:
      'Só calcula (e retorna) a linha dos pilares (STUDENTS/FINANCE/MARKETING/AI/SYSTEM) que o ator pode ver — um pilar sem capability nem chega a ser computado no servidor, não é só escondido na UI.',
  })
  @ApiResponse({
    status: 200,
    description: 'Linhas-resumo dos pilares visíveis ao ator.',
    schema: zodSchemaToOpenApi(controlCenterOverviewResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability OVERVIEW_READ.' })
  overview(@CurrentUser() actor: AuthenticatedUser) {
    return this.controlCenter.overview(actor);
  }

  @Get('marketing')
  @RequireCapabilities(Capability.MARKETING_READ)
  @ApiOperation({
    summary: 'Pilar Marketing do Control Center',
    description:
      'Funil de anamnese, segmentação (sujeita a k-anonimato — nenhuma célula entre 1 e 9 é publicada) e métricas de aquisição.',
  })
  @ApiResponse({ status: 200, description: 'Métricas do pilar Marketing.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability MARKETING_READ.' })
  marketing() {
    return this.controlCenter.marketing();
  }

  @Get('campaigns')
  @RequireCapabilities(Capability.MARKETING_READ)
  @ApiOperation({
    summary: 'Desempenho por campanha de mídia paga',
    description:
      'Cruza `ad_spend` com atribuição de conversão por campanha (CAC por canal/campanha).',
  })
  @ApiResponse({ status: 200, description: 'Métricas por campanha.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability MARKETING_READ.' })
  campaigns() {
    return this.controlCenter.campaigns();
  }

  @Get('students')
  @RequireCapabilities(Capability.STUDENTS_READ)
  @ApiOperation({
    summary: 'Lista de alunos (pilar Students)',
    description:
      'Listagem operacional — a ficha individual com dados de saúde vive em `GET /control-center/students/:id`, sob capability separada.',
  })
  @ApiResponse({ status: 200, description: 'Lista de alunos.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability STUDENTS_READ.' })
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
  @ApiOperation({
    summary: 'Ficha unificada de um aluno',
    description:
      '`STUDENTS_READ` abre a ficha; a seção de SAÚDE (PAR-Q, relato de dor, evolução ' +
      'declarada, conteúdo de conversa) só entra no payload para quem também tem ' +
      '`STUDENTS_HEALTH_READ` — o corte é feito no servidor, não escondido na UI. Sem ' +
      'essa segunda capability, `health` vem `null` na resposta.',
  })
  @ApiParam({ name: 'id', description: 'UUID do aluno.' })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Recorta a timeline por período em dias (1 a 365). Fora da faixa é ignorado.',
  })
  @ApiResponse({
    status: 200,
    description: 'Ficha do aluno (`health: null` sem STUDENTS_HEALTH_READ).',
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability STUDENTS_READ.' })
  @ApiResponse({ status: 404, description: 'Aluno inexistente.' })
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
  @ApiOperation({
    summary: 'Pilar Sistema — saúde e disponibilidade',
    description:
      'Saúde de dependências, filas BullMQ, custo/latência de IA e demais indicadores operacionais.',
  })
  @ApiResponse({ status: 200, description: 'Métricas do pilar Sistema.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability SYSTEM_READ.' })
  system() {
    return this.controlCenter.system();
  }

  @Get('finance')
  @RequireCapabilities(Capability.FINANCE_READ)
  @ApiOperation({
    summary: 'Pilar Financeiro do Control Center',
    description:
      'MRR/ARR, churn, LTV/CAC e demais indicadores financeiros agregados (visão de leitura — lançamentos ficam em `/control-center/finance/*`).',
  })
  @ApiResponse({ status: 200, description: 'Métricas do pilar Financeiro.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability FINANCE_READ.' })
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
  @ApiOperation({
    summary: 'Painel "Sistema → Integração" (teste interno de WhatsApp)',
    description:
      'Ferramenta INTERNA via EvolutionAPI/QR Code, usada enquanto a criação de templates da AraraHQ está bloqueada. Nunca é o canal de produção dos usuários finais.',
  })
  @ApiResponse({ status: 200, description: 'Estado da instância de teste.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability SYSTEM_READ.' })
  integration() {
    return this.controlCenter.integration();
  }

  @Post('integration/whatsapp/instance')
  @RequireCapabilities(Capability.SYSTEM_OPERATE)
  @ApiOperation({
    summary: 'Cria/reinicia a instância de teste da EvolutionAPI',
    description:
      'Requer `SYSTEM_OPERATE` (mais restrita que `SYSTEM_READ`). Gera o QR Code para pareamento do WhatsApp de teste.',
  })
  @ApiResponse({ status: 200, description: 'Instância criada — retorna o QR Code de pareamento.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability SYSTEM_OPERATE.' })
  createWhatsappInstance(@Body() body: unknown) {
    return this.controlCenter.createWhatsappInstance(body);
  }

  @Get('compliance')
  @RequireCapabilities(Capability.COMPLIANCE_READ, Capability.AUDIT_READ)
  @ApiOperation({
    summary: 'Painel de compliance (LGPD)',
    description:
      'Requer AMBAS as capabilities `COMPLIANCE_READ` e `AUDIT_READ`. Solicitações de titular, prazos de resposta e estado de retenção/anonimização.',
  })
  @ApiResponse({ status: 200, description: 'Estado de compliance.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities COMPLIANCE_READ + AUDIT_READ.',
  })
  compliance() {
    return this.controlCenter.compliance();
  }

  @Post('admin/subjects/:id/anonymize')
  @RequireCapabilities(Capability.ADMIN_DESTRUCTIVE_REQUEST)
  @ApiOperation({
    summary: 'Anonimização de titular (BLOQUEADA por design)',
    description:
      'Endpoint existe como placeholder de contrato, mas sempre responde 409: a ' +
      'anonimização real depende de um fluxo de step-up de autenticação e de um workflow ' +
      'de retenção auditável que ainda não foram implementados. Requer a capability mais ' +
      'restrita do sistema (`ADMIN_DESTRUCTIVE_REQUEST`) mesmo assim, para quando for.',
  })
  @ApiParam({ name: 'id', description: 'UUID do titular.' })
  @ApiResponse({
    status: 409,
    description:
      'Sempre — anonimização indisponível até existir step-up e workflow de retenção auditável.',
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability ADMIN_DESTRUCTIVE_REQUEST.' })
  denyUnsafeAnonymization(@Param('id', new ParseUUIDPipe({ version: '4' })) _id: string): never {
    throw new ConflictException({
      code: 'STEP_UP_REQUIRED_NOT_IMPLEMENTED',
      status: 'UNAVAILABLE',
      message:
        'A anonimização permanece bloqueada até existir step-up e workflow de retenção auditável.',
    });
  }
}
