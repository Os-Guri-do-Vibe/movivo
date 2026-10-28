import { Module } from '@nestjs/common';

import { CoachingModule } from '../coaching/coaching.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { TrainingModule } from '../training/training.module';
import { CheckInController } from './check-in.controller';
import { CheckInScheduler } from './check-in.scheduler';
import { CheckInService } from './check-in.service';
import { EvolutionService } from './evolution.service';

/** Check-in adaptativo semanal e evolução do aluno. */
@Module({
  imports: [
    CoachingModule,
    DomainEventsModule,
    JobsModule,
    PublishedMethodologyModule,
    TrainingModule,
  ],
  controllers: [CheckInController],
  providers: [CheckInService, CheckInScheduler, EvolutionService],
  exports: [CheckInService, EvolutionService],
})
export class CheckInModule {}
