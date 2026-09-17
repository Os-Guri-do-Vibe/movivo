/**
 * Rotas de escrita financeira do Control Center (US-8.4).
 *
 * Leitura do extrato exige `FINANCE_READ`; **lançar, estornar e mudar preço de modelo
 * exigem `FINANCE_WRITE` no servidor** — quem tem só leitura recebe 403 aqui mesmo
 * chamando o endpoint direto, sem depender de a UI esconder o botão.
 *
 * Não existe `PATCH`/`PUT` de despesa neste controller. Correção é `POST .../reverse` +
 * novo `POST` de lançamento.
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  createExpenseSchema,
  createModelPricingSchema,
  reverseExpenseSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { FinanceService } from './finance.service';

@ApiTags('Admin · Financeiro')
@ApiBearerAuth('access-token')
@Controller('control-center/finance')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('expenses')
  @RequireCapabilities(Capability.FINANCE_READ)
  @ApiOperation({ summary: 'Extrato de despesas', description: 'Requer `FINANCE_READ`.' })
  @ApiResponse({ status: 200, description: 'Lançamentos de despesa.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability FINANCE_READ.' })
  ledger() {
    return this.finance.ledger();
  }

  @Post('expenses')
  @RequireCapabilities(Capability.FINANCE_READ, Capability.FINANCE_WRITE)
  @ApiOperation({
    summary: 'Lança uma despesa',
    description:
      'Não existe UPDATE de valor — corrigir é estornar (`.../reverse`) e lançar de novo. Despesa recorrente exige `recurrencePeriod`.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(createExpenseSchema) })
  @ApiResponse({ status: 200, description: 'Despesa lançada.' })
  @ApiResponse({
    status: 400,
    description:
      'Corpo fora do schema (ex.: recorrente sem `recurrencePeriod`, valor não positivo).',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities FINANCE_READ + FINANCE_WRITE.',
  })
  createExpense(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.createExpense(actor, body);
  }

  @Post('expenses/:id/reverse')
  @RequireCapabilities(Capability.FINANCE_READ, Capability.FINANCE_WRITE)
  @ApiOperation({
    summary: 'Estorna uma despesa',
    description:
      'Grava uma linha de sinal contrário apontando para o lançamento original — livro-caixa que se edita é livro-caixa em que ninguém confia.',
  })
  @ApiParam({ name: 'id', description: 'UUID do lançamento original.' })
  @ApiBody({ schema: zodSchemaToOpenApi(reverseExpenseSchema) })
  @ApiResponse({ status: 200, description: 'Estorno registrado.' })
  @ApiResponse({
    status: 400,
    description: 'Lançamento já estornado ou `id` fora do formato UUID v4.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities FINANCE_READ + FINANCE_WRITE.',
  })
  reverseExpense(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    return this.finance.reverseExpense(actor, id, body);
  }

  /** Acionamento manual do job de materialização — ver `ponytail:` no serviço. */
  @Post('expenses/materialize-recurring')
  @RequireCapabilities(Capability.FINANCE_READ, Capability.FINANCE_WRITE)
  @ApiOperation({
    summary: 'Materializa manualmente as despesas recorrentes do mês',
    description:
      'Mesmo job que roda agendado — este endpoint é o acionamento manual (ex.: para conferência fora do horário do agendamento).',
  })
  @ApiResponse({ status: 200, description: 'Despesas recorrentes materializadas.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities FINANCE_READ + FINANCE_WRITE.',
  })
  materializeRecurring(@CurrentUser() actor: AuthenticatedUser) {
    return this.finance.materializeRecurring(actor);
  }

  @Get('model-pricing')
  @RequireCapabilities(Capability.FINANCE_READ)
  @ApiOperation({
    summary: 'Histórico de vigência de preço por modelo de LLM',
    description: 'Requer `FINANCE_READ`. Base para o cálculo de custo de IA por período.',
  })
  @ApiResponse({ status: 200, description: 'Vigências de preço por modelo.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability FINANCE_READ.' })
  modelPricing() {
    return this.finance.modelPricingHistory();
  }

  @Post('model-pricing')
  @RequireCapabilities(Capability.FINANCE_READ, Capability.FINANCE_WRITE)
  @ApiOperation({
    summary: 'Registra uma nova vigência de preço de modelo',
    description:
      'A vigência anterior do mesmo modelo é fechada automaticamente na data informada. Preço em centavos por 1k tokens, decimal exato.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(createModelPricingSchema) })
  @ApiResponse({ status: 200, description: 'Vigência registrada.' })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities FINANCE_READ + FINANCE_WRITE.',
  })
  createModelPricing(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.createModelPricing(actor, body);
  }
}
