import { Module } from '@nestjs/common';

import { AiModule } from '../../core/ai/ai.module';
import { AuditService } from '../admin/audit.service';
import { AuthModule } from '../auth/auth.module';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { AgentProfilesService } from './agent-profiles.service';
import { AgentsPanelController } from './agents-panel.controller';
import { AgentsPanelService } from './agents-panel.service';

@Module({
  imports: [AiModule, AuthModule, EvaluationModule],
  controllers: [AgentsPanelController],
  providers: [AgentsPanelService, AgentProfilesService, AuditService],
})
export class AgentsPanelModule {}
