/**
 * `AttendanceRulesModule` — bloco CORE. `@Global()` via `CoreModule`: a conversa e o painel
 * consomem as regras publicadas pelos profissionais (FAQ, temas proibidos e guardrails L1) por
 * DI, sem importar módulo de domínio um do outro (§12.5).
 */
import { Global, Module } from '@nestjs/common';

import { FaqService } from './faq.service';
import { ForbiddenTopicsService } from './forbidden-topics.service';
import { L1GuardrailService } from './l1-guardrail.service';

const PROVIDERS = [FaqService, ForbiddenTopicsService, L1GuardrailService];

@Global()
@Module({
  providers: PROVIDERS,
  exports: PROVIDERS,
})
export class AttendanceRulesModule {}
