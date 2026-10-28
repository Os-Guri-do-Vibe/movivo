/**
 * `ConversationModule` — a conversa com o aluno pelo WhatsApp: classifica, executa dentro das
 * políticas e responde. Módulo-folha: só o `AppModule` o importa.
 */
import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { CoachingModule } from '../coaching/coaching.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { JobsModule } from '../jobs/jobs.module';
import { PublishedMethodologyModule } from '../methodology/published-methodology.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { StudentStateModule } from '../student-state/student-state.module';
import { TrainingModule } from '../training/training.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConversationStore } from './conversation-store';
import { ConversationWorker } from './conversation.worker';
import { DomainCommands } from './domain-commands.service';
import { ConversationOrchestrator } from './orchestrator.service';

@Module({
  imports: [
    CatalogModule,
    CoachingModule,
    DomainEventsModule,
    JobsModule,
    NutritionModule,
    PublishedMethodologyModule,
    StudentStateModule,
    TrainingModule,
    WhatsappModule,
  ],
  providers: [ConversationStore, DomainCommands, ConversationOrchestrator, ConversationWorker],
  exports: [ConversationOrchestrator, ConversationStore, DomainCommands],
})
export class ConversationModule {}
