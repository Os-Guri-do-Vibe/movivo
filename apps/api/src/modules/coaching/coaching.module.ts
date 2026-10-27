import { Module } from '@nestjs/common';

import { DomainEventsModule } from '../domain-events/domain-events.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { PublishedPolicies } from './policy/published-policies';
import { SafetyService } from './safety/safety.service';

/**
 * Núcleo de decisão: políticas de autonomia, sentinela de segurança e (a partir do M8) o
 * orquestrador que transforma eventos em propostas, decisões e execuções.
 */
@Module({
  imports: [DomainEventsModule, PublishedMethodologyModule],
  providers: [PublishedPolicies, SafetyService],
  exports: [PublishedPolicies, SafetyService],
})
export class CoachingModule {}
