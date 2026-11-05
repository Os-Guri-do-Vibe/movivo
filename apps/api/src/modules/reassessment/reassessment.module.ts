import { Module } from '@nestjs/common';

import { AnamnesisModule } from '../anamnesis/anamnesis.module';
import { CheckInModule } from '../checkin-v2/check-in.module';
import { CoachingModule } from '../coaching/coaching.module';
import { ConversationModule } from '../conversation/conversation.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { PlanningModule } from '../planning/planning.module';
import { ProgressModule } from '../progress/progress.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { TrainingModule } from '../training/training.module';
import { CycleRenewalService } from './cycle-renewal.service';
import { ReassessmentController } from './reassessment.controller';
import { ReassessmentPhotosService } from './reassessment-photos.service';
import { ReassessmentService } from './reassessment.service';
import { ReassessmentWorker } from './reassessment.worker';

/** Reavaliação de fim de ciclo: link no vencimento, formulário, análise e protocolo do próximo ciclo. */
@Module({
  imports: [
    AnamnesisModule,
    CheckInModule,
    CoachingModule,
    ConversationModule,
    DomainEventsModule,
    JobsModule,
    PlanningModule,
    ProgressModule,
    PublishedMethodologyModule,
    StudentStateModule,
    TrainingModule,
  ],
  controllers: [ReassessmentController],
  providers: [
    ReassessmentService,
    ReassessmentPhotosService,
    CycleRenewalService,
    ReassessmentWorker,
  ],
})
export class ReassessmentModule {}
