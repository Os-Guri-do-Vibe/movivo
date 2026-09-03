/**
 * `CoachModule` (US-3.5) — hospeda o `AIResponseWorker`, o orquestrador da conversa.
 *
 * Fronteira §12.5 (sem ciclo): é um módulo-folha (só o `AppModule` o importa). Importa o que
 * REUSA — `ProtocolModule` (ValidationService), `AiCoachModule` (Intent/Context/LLM/AbuseGuard),
 * `JobsModule` (WorkerFactory/QueueManager) e `WhatsappModule` (UserJobLock + fila outbound).
 * Nenhum desses importa o CoachModule de volta, então não há import circular.
 */
import { Module } from '@nestjs/common';

import { AiCoachModule } from '../ai-coach/ai-coach.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProtocolModule } from '../protocol/protocol.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WorkoutModule } from '../workout/workout.module';
import { AIResponseWorker } from './ai-response.worker';
import { ConversationRepository } from './conversation.repository';
import { SubstitutionResolutionService } from './substitution-resolution.service';
import { SubstitutionTargetService } from './substitution-target.service';
import { WorkoutReminderResolutionService } from './workout-reminder-resolution.service';

@Module({
  imports: [ProtocolModule, AiCoachModule, JobsModule, WhatsappModule, WorkoutModule],
  providers: [
    AIResponseWorker,
    ConversationRepository,
    SubstitutionTargetService,
    SubstitutionResolutionService,
    WorkoutReminderResolutionService,
  ],
})
export class CoachModule {}
