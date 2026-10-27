import { Global, Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { AgentRunner } from './agent-runner';
import { AgentTaskRegistry } from './agent-task-registry';

/**
 * Framework de agentes: tarefas tipadas, prompt em camadas, validação e correção, e o catálogo
 * de tarefas com seus casos de avaliação. `@Global`: o catálogo precisa ser UM só, visível a todo
 * módulo que registra tarefas e à avaliação (não tem ciclo de vida, então a ordem de
 * inicialização dos globais não o afeta).
 */
@Global()
@Module({
  imports: [AiModule],
  providers: [AgentRunner, AgentTaskRegistry],
  exports: [AgentRunner, AgentTaskRegistry],
})
export class AgentsModule {}
