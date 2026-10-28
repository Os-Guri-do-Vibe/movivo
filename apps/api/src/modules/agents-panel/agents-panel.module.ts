import { Module } from '@nestjs/common';

import { AiModule } from '../../core/ai/ai.module';
import { AuditService } from '../admin/audit.service';
import { AuthModule } from '../auth/auth.module';
import { AgentsPanelController } from './agents-panel.controller';
import { AgentsPanelService } from './agents-panel.service';

@Module({
  imports: [AiModule, AuthModule],
  controllers: [AgentsPanelController],
  providers: [AgentsPanelService, AuditService],
})
export class AgentsPanelModule {}
