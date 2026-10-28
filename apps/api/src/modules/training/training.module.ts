import { Module } from '@nestjs/common';

import { CoachingModule } from '../coaching/coaching.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { ExecutionTasksModule } from '../execution-tasks/execution-tasks.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { ShortLinkModule } from '../short-link/short-link.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { ExecutionService } from './execution.service';
import { ScheduleService } from './schedule.service';
import { TrainingAccessService } from './training-access.service';
import { TrainingController } from './training.controller';
import { TrainingDailyScheduler } from './training-daily.scheduler';
import { TrainingLinkService } from './training-link.service';

/** Execução diária do treino (qualquer modalidade), agenda adaptativa e link do dia. */
@Module({
  imports: [
    CoachingModule,
    DomainEventsModule,
    ExecutionTasksModule,
    JobsModule,
    PublishedMethodologyModule,
    ShortLinkModule,
    StudentStateModule,
  ],
  controllers: [TrainingController],
  providers: [
    TrainingAccessService,
    ExecutionService,
    ScheduleService,
    TrainingLinkService,
    TrainingDailyScheduler,
  ],
  exports: [ExecutionService, ScheduleService, TrainingAccessService, TrainingLinkService],
})
export class TrainingModule {}
