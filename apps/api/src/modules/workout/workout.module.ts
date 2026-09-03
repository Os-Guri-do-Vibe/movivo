/**
 * `WorkoutModule` (US-8.1) — captura do treino que o aluno realmente fez.
 *
 * Três peças e nada mais:
 *  - `WorkoutCompletionService` — grava em `workout_completions` com dedupe por fonte.
 *  - `WorkoutScheduler` — quick reply diário às 20h (`America/Sao_Paulo`).
 *  - `WorkoutInboundHandler` — ingestão do toque no botão.
 *
 * Fronteira (§12.5): depende só do CORE (global) e de `JobsModule`. O fallback pelo
 * check-in não é um import entre domínios — `CheckinService` recebe este service por DI
 * a partir do provider exportado aqui, e `CheckinModule` importa `WorkoutModule`.
 */
import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { WorkoutAccessService } from './workout-access.service';
import { WorkoutCompletionService } from './workout-completion.service';
import { WorkoutController } from './workout.controller';
import { WorkoutInboundHandler } from './workout-inbound.handler';
import { WorkoutJournalService } from './workout-journal.service';
import { WorkoutScheduler } from './workout.scheduler';

@Module({
  imports: [JobsModule],
  controllers: [WorkoutController],
  providers: [
    WorkoutAccessService,
    WorkoutCompletionService,
    WorkoutJournalService,
    WorkoutScheduler,
    WorkoutInboundHandler,
  ],
  exports: [WorkoutCompletionService, WorkoutJournalService],
})
export class WorkoutModule {}
