import { Module } from '@nestjs/common';

import { CoachingModule } from '../coaching/coaching.module';
import { ConversationModule } from '../conversation/conversation.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { PreferenceExtractionService } from './preference-extraction.service';
import { WeeklyReviewScheduler } from './weekly-review.scheduler';
import { WeeklyReviewService } from './weekly-review.service';

/** Inteligência longitudinal: revisão semanal do progresso e preferências observadas. */
@Module({
  imports: [
    CoachingModule,
    ConversationModule,
    JobsModule,
    PublishedMethodologyModule,
    StudentStateModule,
  ],
  providers: [WeeklyReviewService, PreferenceExtractionService, WeeklyReviewScheduler],
  exports: [WeeklyReviewService, PreferenceExtractionService, WeeklyReviewScheduler],
})
export class ProgressModule {}
