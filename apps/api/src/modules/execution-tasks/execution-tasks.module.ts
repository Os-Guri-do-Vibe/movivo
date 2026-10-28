import { Module, type OnModuleInit } from '@nestjs/common';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import { foodLogCases, foodLogChecks, foodLogTask } from '../nutrition/food-log-task';
import { screenshotCases } from '../vision/vision-cases';
import { mealPhotoTask, workoutScreenshotTask } from '../vision/vision-tasks';

/**
 * Catálogo das tarefas do dia a dia do aluno (leitura de print de treino, foto e texto de
 * refeição), com os casos de avaliação. Sem workers nem controladores: a aplicação e a linha de
 * comando de avaliação registram as MESMAS tarefas.
 */
@Module({})
export class ExecutionTasksModule implements OnModuleInit {
  constructor(private readonly registry: AgentTaskRegistry) {}

  onModuleInit(): void {
    this.registry.register(workoutScreenshotTask, screenshotCases);
    this.registry.register(mealPhotoTask, []);
    this.registry.register(foodLogTask, foodLogCases, foodLogChecks);
  }
}
