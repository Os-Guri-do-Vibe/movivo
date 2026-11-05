import { Module } from '@nestjs/common';

import { DomainEventsModule } from '../domain-events/domain-events.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { MethodologyController } from './methodology.controller';
import { MethodologyService } from './methodology.service';
import { PublishedMethodologyModule } from './published-methodology.module';

/** Estúdio de metodologia: rascunho, teste contra os casos de avaliação e publicação. */
@Module({
  imports: [EvaluationModule, DomainEventsModule, PublishedMethodologyModule],
  controllers: [MethodologyController],
  providers: [MethodologyService],
  exports: [MethodologyService],
})
export class MethodologyModule {}
