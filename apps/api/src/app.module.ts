/**
 * `AppModule` — raiz do monólito modular (`ARQUITETURA.md` §4, C4 nível 3).
 *
 * A árvore é deliberadamente rasa e **acíclica por construção**:
 *
 *   AppModule
 *     ├─ CoreModule ──── ConfigModule · LoggerModule · DatabaseModule · RedisModule
 *     │                  TelemetryModule (stub) · EventBusModule (stub)
 *     ├─ HealthModule ── depende só do CORE
 *     └─ 9 módulos de domínio (vazios nesta sprint)
 *
 * Como os ciclos são evitados:
 *  1. Os submódulos do CORE são `@Global()`: domínio consome provider do CORE por DI
 *     sem `imports`, então não existe aresta domínio → CORE no grafo de módulos.
 *  2. Domínio **nunca** importa domínio. Comunicação por evento (`EventBusModule`) ou
 *     por fila (`JobsModule`).
 *  3. CORE nunca importa domínio. A seta aponta sempre para dentro.
 *
 * Quebrar (1)–(3) é o caminho mais curto para `forwardRef()` espalhado pelo código, que
 * é como um monólito modular vira um monólito comum.
 */
import { Module } from '@nestjs/common';

import { CoreModule } from './core/core.module';
import { HealthModule } from './health/health.module';
import { AccountModule } from './modules/account/account.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnamnesisModule } from './modules/anamnesis/anamnesis.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { AgentsPanelModule } from './modules/agents-panel/agents-panel.module';
import { ExceptionsModule } from './modules/exceptions/exceptions.module';
import { ProgressModule } from './modules/progress/progress.module';
import { AgentsModule } from './core/agents/agents.module';
import { CoachingModule } from './modules/coaching/coaching.module';
import { MethodologyModule } from './modules/methodology/methodology.module';
import { PlanningModule } from './modules/planning/planning.module';
import { CheckInModule } from './modules/checkin-v2/check-in.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { TrainingModule } from './modules/training/training.module';
import { StudentStateModule } from './modules/student-state/student-state.module';
import { DomainEventsModule } from './modules/domain-events/domain-events.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    // Infraestrutura compartilhada.
    CoreModule,
    HealthModule,

    // Domínio — cascas vazias até as sprints correspondentes.
    AuthModule,
    AccountModule,
    AnamnesisModule,
    WhatsappModule,
    ConversationModule,
    ProgressModule,
    ExceptionsModule,
    AgentsPanelModule,
    SubscriptionModule,
    JobsModule,
    DomainEventsModule,
    AgentsModule,
    StudentStateModule,
    MethodologyModule,
    CoachingModule,
    PlanningModule,
    TrainingModule,
    NutritionModule,
    CheckInModule,
    AdminModule,
  ],
})
export class AppModule {}
