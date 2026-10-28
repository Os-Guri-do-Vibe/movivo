import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CoachingModule } from '../coaching/coaching.module';
import { ConversationModule } from '../conversation/conversation.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { JobsModule } from '../jobs/jobs.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { AuditService } from '../admin/audit.service';
import { ExceptionAlertHandler } from './exception-alert.handler';
import { ExceptionsController } from './exceptions.controller';
import { ExceptionsService } from './exceptions.service';
import { ProposalRunner } from './proposal-runner.service';

/** Fila de exceções por domínio profissional (CREF, CRN, CRM). */
@Module({
  imports: [
    AuthModule,
    CoachingModule,
    ConversationModule,
    DomainEventsModule,
    JobsModule,
    StudentStateModule,
  ],
  controllers: [ExceptionsController],
  providers: [ExceptionsService, ProposalRunner, AuditService, ExceptionAlertHandler],
  exports: [ExceptionsService],
})
export class ExceptionsModule {}
