/**
 * `WorkoutModule` (US-8.1) — captura do treino que o aluno realmente fez.
 *
 * Três peças e nada mais:
 *  - `WorkoutCompletionService` — grava em `workout_completions` com dedupe por fonte.
 *  - `WorkoutScheduler` — quick reply diário às 20h (`America/Sao_Paulo`).
 *  - `WorkoutInboundHandler` — ingestão do toque no botão.
 *
 * Fronteira (§12.5): depende só do CORE (global), `JobsModule` e `ShortLinkModule`
 * (utilitário sem regra de negócio, não conta como import entre domínios). O fallback pelo
 * check-in não é um import entre domínios — `CheckinService` recebe este service por DI
 * a partir do provider exportado aqui, e `CheckinModule` importa `WorkoutModule`.
 */
import { Module } from '@nestjs/common';

import { FollowupModule } from '../followup/followup.module';
import { JobsModule } from '../jobs/jobs.module';
import { ShortLinkModule } from '../short-link/short-link.module';
import { ShareCardRenderer } from './share-card/share-card-renderer.service';
import { WorkoutAccessService } from './workout-access.service';
import { WorkoutCompletionService } from './workout-completion.service';
import { WorkoutController } from './workout.controller';
import { WorkoutInboundHandler } from './workout-inbound.handler';
import { WorkoutJournalService } from './workout-journal.service';
import { AttendanceAlertService } from './attendance-alert.service';
import { MissedWorkoutAskPolicy } from './missed-workout-ask.policy';
import { WorkoutLateLogService } from './workout-late-log.service';
import { WorkoutLinkDispatcherService } from './workout-link-dispatcher.service';
import { WorkoutLinkResendService } from './workout-link-resend.service';
import { WorkoutProtocolChangedWorker } from './workout-protocol-changed.worker';
import { WorkoutRefreshOfferService } from './workout-refresh-offer.service';
import { WorkoutScheduleService } from './workout-schedule.service';
import { WorkoutScheduler } from './workout.scheduler';

@Module({
  imports: [JobsModule, ShortLinkModule, FollowupModule],
  controllers: [WorkoutController],
  providers: [
    WorkoutAccessService,
    WorkoutLinkResendService,
    WorkoutLinkDispatcherService,
    WorkoutRefreshOfferService,
    WorkoutLateLogService,
    WorkoutProtocolChangedWorker,
    WorkoutCompletionService,
    WorkoutJournalService,
    WorkoutScheduleService,
    ShareCardRenderer,
    WorkoutScheduler,
    MissedWorkoutAskPolicy,
    AttendanceAlertService,
    WorkoutInboundHandler,
  ],
  exports: [
    WorkoutCompletionService,
    WorkoutJournalService,
    WorkoutScheduleService,
    WorkoutAccessService,
    WorkoutLinkDispatcherService,
    WorkoutRefreshOfferService,
    WorkoutLateLogService,
  ],
})
export class WorkoutModule {}
