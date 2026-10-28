import { Module, type OnModuleInit } from '@nestjs/common';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import { registerPlanningTasks } from './tasks/registry';

/**
 * Só o catálogo das tarefas de planejamento (sem workers nem controladores), para a aplicação e
 * a linha de comando de avaliação registrarem as MESMAS tarefas e casos.
 */
@Module({})
export class PlanningTasksModule implements OnModuleInit {
  constructor(private readonly registry: AgentTaskRegistry) {}

  onModuleInit(): void {
    registerPlanningTasks(this.registry);
  }
}
