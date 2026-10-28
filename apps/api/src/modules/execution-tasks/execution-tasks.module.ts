import { Module, type OnModuleInit } from '@nestjs/common';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import {
  answerCases,
  answerTask,
  classifyCases,
  classifyTask,
  riskCases,
  riskTask,
  substituteTask,
} from '../conversation/tasks';
import { foodLogCases, foodLogChecks, foodLogTask } from '../nutrition/food-log-task';
import { preferencesCases, preferencesTask, reviewCases, reviewTask } from '../progress/tasks';
import { screenshotCases } from '../vision/vision-cases';
import { mealPhotoTask, workoutScreenshotTask } from '../vision/vision-tasks';

/**
 * Catálogo das tarefas do dia a dia do aluno (leitura de print de treino, foto e texto de
 * refeição, classificação e resposta de conversa, sentinela de texto, revisão semanal e preferências), com os casos de avaliação. Sem workers nem controladores: a aplicação e a linha de
 * comando de avaliação registram as MESMAS tarefas.
 */
@Module({})
export class ExecutionTasksModule implements OnModuleInit {
  constructor(private readonly registry: AgentTaskRegistry) {}

  onModuleInit(): void {
    this.registry.register(workoutScreenshotTask, screenshotCases);
    this.registry.register(mealPhotoTask, []);
    this.registry.register(foodLogTask, foodLogCases, foodLogChecks);
    this.registry.register(classifyTask, classifyCases);
    this.registry.register(answerTask, answerCases);
    this.registry.register(substituteTask, []);
    this.registry.register(riskTask, riskCases);
    this.registry.register(reviewTask, reviewCases);
    this.registry.register(preferencesTask, preferencesCases);
  }
}
