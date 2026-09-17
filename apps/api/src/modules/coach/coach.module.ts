/**
 * `CoachModule` (US-3.5) — hospeda o `AIResponseWorker`, o orquestrador da conversa.
 *
 * Fronteira §12.5 (sem ciclo): é um módulo-folha (só o `AppModule` o importa). Importa o que
 * REUSA — `ProtocolModule` (ValidationService/ProtocolRepository), `AiCoachModule`
 * (Intent/Context/LLM/AbuseGuard), `JobsModule` (WorkerFactory/QueueManager), `WhatsappModule`
 * (UserJobLock + fila outbound) e `WorkoutModule` (`WorkoutCompletionService`, achado
 * 2026-09-13 — fallback de conclusão de treino a partir do check-in semanal). Nenhum desses
 * importa o CoachModule de volta, então não há import circular.
 */
import { Module } from '@nestjs/common';

import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProtocolModule } from '../protocol/protocol.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WorkoutModule } from '../workout/workout.module';
import { AIResponseWorker } from './ai-response.worker';
import { CheckinWeeklyFeedbackService } from './checkin-weekly-feedback.service';
import { CheckinWeeklyFeedbackWorker } from './checkin-weekly-feedback.worker';
import { ConversationRepository } from './conversation.repository';
import { ProtocolVolumeAdjustmentService } from './protocol-volume-adjustment.service';
import { SubstitutionCatalogLookupService } from './substitution-catalog-lookup.service';
import { SubstitutionResolutionService } from './substitution-resolution.service';
import { SubstitutionTargetService } from './substitution-target.service';
import { WorkoutFeedbackService } from './workout-feedback.service';
import { WorkoutFeedbackWorker } from './workout-feedback.worker';

@Module({
  imports: [ProtocolModule, AiCoachModule, JobsModule, WhatsappModule, WorkoutModule],
  providers: [
    AIResponseWorker,
    ConversationRepository,
    SubstitutionTargetService,
    SubstitutionResolutionService,
    SubstitutionCatalogLookupService,
    WorkoutFeedbackService,
    WorkoutFeedbackWorker,
    CheckinWeeklyFeedbackService,
    CheckinWeeklyFeedbackWorker,
    ProtocolVolumeAdjustmentService,
  ],
})
export class CoachModule {}
