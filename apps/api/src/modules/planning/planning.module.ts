import { Module } from '@nestjs/common';

import { BodyAssessmentModule } from '../body-assessment/body-assessment.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CoachingModule } from '../coaching/coaching.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { PlanningTasksModule } from './planning-tasks.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { PlanApprovalHandler } from './plan-approval.handler';
import { PlanController } from './plan.controller';
import { PlanDelivery } from './plan-delivery.service';
import { PlanGenerationService } from './plan-generation.service';
import { PlanGenerationWorker } from './plan-generation.worker';
import { PlanRolloverScheduler } from './plan-rollover.scheduler';
import { PlanRolloverService } from './plan-rollover.service';
import { PlanPublisher } from './plan-publisher.service';
import { PlanViewService } from './plan-view.service';
import { ProtocolReviewService } from './protocol-review.service';

/**
 * Motor de Objetivos e plano integrado: estratégia, blocos por modalidade, reconciliação
 * híbrida, nutrição, publicação e leitura do plano pelo aluno.
 */
@Module({
  imports: [
    PlanningTasksModule,
    BodyAssessmentModule,
    CatalogModule,
    CoachingModule,
    DomainEventsModule,
    JobsModule,
    NutritionModule,
    PublishedMethodologyModule,
    StudentStateModule,
  ],
  controllers: [PlanController],
  providers: [
    PlanGenerationService,
    PlanGenerationWorker,
    PlanRolloverScheduler,
    PlanRolloverService,
    PlanApprovalHandler,
    PlanDelivery,
    PlanPublisher,
    PlanViewService,
    ProtocolReviewService,
  ],
  exports: [PlanGenerationService, PlanViewService, ProtocolReviewService],
})
export class PlanningModule {}
