/**
 * `AgentConfigModule` (US-7.6) — bloco CORE. `@Global()` via `CoreModule`, para que
 * `whatsapp`, `subscription` e `coach` consumam `AgentPersonaService` por DI sem
 * importar módulo de domínio um do outro (§12.5).
 */
import { Global, Module } from '@nestjs/common';

import { AgentConfigRepository } from './agent-config.repository';
import { AgentPersonaService } from './agent-persona.service';
import { FaqService } from './faq.service';
import { ForbiddenTopicsService } from './forbidden-topics.service';
import { L1GuardrailService } from './l1-guardrail.service';

const PROVIDERS = [
  AgentConfigRepository,
  AgentPersonaService,
  FaqService,
  ForbiddenTopicsService,
  L1GuardrailService,
];

@Global()
@Module({
  providers: PROVIDERS,
  exports: PROVIDERS,
})
export class AgentConfigModule {}
