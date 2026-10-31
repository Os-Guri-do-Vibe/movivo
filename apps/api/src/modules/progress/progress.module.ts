import { Module } from '@nestjs/common';

import { CoachingModule } from '../coaching/coaching.module';
import { ConversationModule } from '../conversation/conversation.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { GoalProgressService } from './goal-progress.service';
import { MonthlyReportController, MonthlyReportService } from './monthly-report.service';
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
  controllers: [MonthlyReportController],
  providers: [
    GoalProgressService,
    WeeklyReviewService,
    PreferenceExtractionService,
    WeeklyReviewScheduler,
    MonthlyReportService,
  ],
  exports: [
    GoalProgressService,
    WeeklyReviewService,
    PreferenceExtractionService,
    WeeklyReviewScheduler,
  ],
})
export class ProgressModule {}
