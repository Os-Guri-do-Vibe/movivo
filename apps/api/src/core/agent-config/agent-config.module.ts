/**
 * `AgentConfigModule` (US-7.6) — bloco CORE. `@Global()` via `CoreModule`, para que
 * `whatsapp`, `subscription` e `coach` consumam `AgentPersonaService` por DI sem
 * importar módulo de domínio um do outro (§12.5).
 */
import { Global, Module } from '@nestjs/common';

import { AgentConfigRepository } from './agent-config.repository';
import { AgentPersonaService } from './agent-persona.service';
import { FaqService } from './faq.service';

@Global()
@Module({
  providers: [AgentConfigRepository, AgentPersonaService, FaqService],
  exports: [AgentConfigRepository, AgentPersonaService, FaqService],
})
export class AgentConfigModule {}
