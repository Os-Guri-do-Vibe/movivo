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
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { FinanceService } from './finance.service';

@Controller('control-center/finance')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('expenses')
  @RequireCapabilities(Capability.FINANCE_READ)
  ledger() {
    return this.finance.ledger();
  }

  @Post('expenses')
  @RequireCapabilities(Capability.FINANCE_READ, Capability.FINANCE_WRITE)
  createExpense(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.createExpense(actor, body);
  }

  @Post('expenses/:id/reverse')
  @RequireCapabilities(Capability.FINANCE_READ, Capability.FINANCE_WRITE)
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
  materializeRecurring(@CurrentUser() actor: AuthenticatedUser) {
    return this.finance.materializeRecurring(actor);
  }

  @Get('model-pricing')
  @RequireCapabilities(Capability.FINANCE_READ)
  modelPricing() {
    return this.finance.modelPricingHistory();
  }

  @Post('model-pricing')
  @RequireCapabilities(Capability.FINANCE_READ, Capability.FINANCE_WRITE)
  createModelPricing(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.finance.createModelPricing(actor, body);
  }
}
