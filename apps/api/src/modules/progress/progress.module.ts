import { Module } from '@nestjs/common';

import { AuditService } from '../admin/audit.service';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CoachingModule } from '../coaching/coaching.module';
import { ConversationModule } from '../conversation/conversation.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { PlanningModule } from '../planning/planning.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { AgentMessenger } from './agent-messenger';
import { CareScheduler } from './care.scheduler';
import { CareService } from './care.service';
import { CycleCareService } from './cycle-care.service';
import { DayDigestService } from './day-digest.service';
import { MessageQualityController } from './message-quality.controller';
import { MessageQualityService } from './message-quality.service';
import { SessionSnapshotService } from './session-snapshot.service';
import { FollowUpWorker } from './follow-up.worker';
import { GoalProgressService } from './goal-progress.service';
import { MonthlyReportController, MonthlyReportService } from './monthly-report.service';
import { MealRoutineService } from './meal-routine.service';
import { MemoryCuratorService } from './memory-curator.service';
import { MissedSessionService } from './missed-session.service';
import { SpecialistDailyService } from './specialist-daily.service';
import { SpecialistFollowUpScheduler } from './specialist-follow-up.scheduler';
import { NutritionFollowUpService } from './nutrition-follow-up.service';
import { PainGuidanceService } from './pain-guidance.service';
import { PreferenceExtractionService } from './preference-extraction.service';
import { StudentEvolutionController } from './student-evolution.controller';
import { StudentEvolutionService } from './student-evolution.service';
import { TrainingFollowUpService } from './training-follow-up.service';
import { WorkoutFeedbackService } from './workout-feedback.service';
import { WeeklyReviewScheduler } from './weekly-review.scheduler';
import { WeeklyReviewService } from './weekly-review.service';

/** Inteligência longitudinal: revisão semanal do progresso e preferências observadas. */
@Module({
  imports: [
    AuthModule,
    CatalogModule,
    CoachingModule,
    ConversationModule,
    DomainEventsModule,
    JobsModule,
    PlanningModule,
    PublishedMethodologyModule,
    StudentStateModule,
  ],
  controllers: [MonthlyReportController, StudentEvolutionController, MessageQualityController],
  providers: [
    AgentMessenger,
    AuditService,
    CareScheduler,
    CareService,
    CycleCareService,
    DayDigestService,
    MessageQualityService,
    SessionSnapshotService,
    StudentEvolutionService,
    GoalProgressService,
    FollowUpWorker,
    PainGuidanceService,
    WorkoutFeedbackService,
    MissedSessionService,
    MealRoutineService,
    SpecialistDailyService,
    MemoryCuratorService,
    NutritionFollowUpService,
    TrainingFollowUpService,
    SpecialistFollowUpScheduler,
    WeeklyReviewService,
    PreferenceExtractionService,
    WeeklyReviewScheduler,
    MonthlyReportService,
  ],
  exports: [
    AgentMessenger,
    GoalProgressService,
    WeeklyReviewService,
    PreferenceExtractionService,
    WeeklyReviewScheduler,
  ],
})
export class ProgressModule {}
