import { Module } from '@nestjs/common';

import { AnamnesisModule } from '../anamnesis/anamnesis.module';
import { AuthModule } from '../auth/auth.module';
import { CoachingModule } from '../coaching/coaching.module';
import { ConversationModule } from '../conversation/conversation.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { JobsModule } from '../jobs/jobs.module';
import { PlanningModule } from '../planning/planning.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { TrainingModule } from '../training/training.module';
import { AuditService } from '../admin/audit.service';
import { ExceptionAlertHandler } from './exception-alert.handler';
import { ExceptionsController, ProtocolAmendmentController } from './exceptions.controller';
import { ExceptionsService } from './exceptions.service';
import { ProposalRunner } from './proposal-runner.service';
import { ProtocolAutoReleaseWorker } from './protocol-auto-release.worker';
import { ReviewHoldService } from './review-hold.service';

/** Fila de exceções por domínio profissional (CREF, CRN, CRM). */
@Module({
  imports: [
    AnamnesisModule,
    AuthModule,
    CoachingModule,
    ConversationModule,
    DomainEventsModule,
    JobsModule,
    // Revisão do protocolo (ver, editar) antes da aprovação: o planejamento valida e grava.
    PlanningModule,
    StudentStateModule,
    // Link do protocolo atualizado que vai ao aluno.
    TrainingModule,
  ],
  controllers: [ExceptionsController, ProtocolAmendmentController],
  providers: [
    ExceptionsService,
    ProposalRunner,
    AuditService,
    ExceptionAlertHandler,
    ReviewHoldService,
    ProtocolAutoReleaseWorker,
  ],
  exports: [ExceptionsService],
})
export class ExceptionsModule {}
