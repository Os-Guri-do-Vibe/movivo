/**
 * `AdminModule` — **esqueleto vazio registrado** (TASK-0.3.6).
 *
 * Módulo ADMIN / CREF do C4 nível 3 (`ARQUITETURA.md` §4). Nesta sprint é só a casca:
 * nenhuma lógica de negócio, nenhum controller, nenhum provider. Existe para que a
 * sprint de implementação (Sprint 3) encaixe código sem reestruturar o app.
 *
 * Conteúdo previsto pelo diagrama de Rafael:
 *  - `DashboardService`
 *  - `AuditService`
 *  - `FlagService`
 *  - `ReportService`
 *
 * Regras que já valem para quem implementar:
 *  - Dashboard de operações do profissional CREF: fila de exceções, assinatura de protocolos, flags de risco.
 *  - Acesso restrito por RBAC e **toda** ação é registrada em `audit_logs` append-only (Alexandre/Sato) — inclusive leitura de dado de saúde de um titular.
 *  - Acesso administrativo a dado de saúde é o cenário de maior risco de IDOR do produto: autorização por titular, sempre, nunca só por papel.
 *
 * # Fronteira do módulo (regra §12.5 — sem imports circulares)
 * Este módulo pode depender do **CORE** (config, banco, Redis, logger) por DI, já que
 * todos os providers do CORE são globais. Não pode importar outro módulo de domínio:
 * a comunicação entre domínios é por evento (`EventBusModule`) ou por fila (`JobsModule`).
 */
import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProtocolModule } from '../protocol/protocol.module';
import { AiConfigController } from './ai-config.controller';
import { AiConfigService } from './ai-config.service';
import { AuditService } from './audit.service';
import { ControlCenterController } from './control-center.controller';
import { ControlCenterService } from './control-center.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FaqAdminController } from './faq-admin.controller';
import { FaqAdminService } from './faq-admin.service';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { L1GuardrailAdminController } from './l1-guardrail-admin.controller';
import { L1GuardrailAdminService } from './l1-guardrail-admin.service';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [AuthModule, JobsModule, ProtocolModule],
  controllers: [
    DashboardController,
    ControlCenterController,
    AiConfigController,
    FinanceController,
    MarketingController,
    PartnersController,
    FaqAdminController,
    L1GuardrailAdminController,
  ],
  providers: [
    AuditService,
    DashboardService,
    ControlCenterService,
    AiConfigService,
    FinanceService,
    MarketingService,
    PartnersService,
    FaqAdminService,
    L1GuardrailAdminService,
  ],
})
export class AdminModule {}
