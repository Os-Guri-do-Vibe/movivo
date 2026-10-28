import type { AgentTaskRegistry } from '../../../core/agents/agent-task-registry';
import { PLANNING_CASES, PLANNING_CHECKS } from '../cases';
import { hybridTask } from './hybrid';
import { hyroxTask } from './hyrox';
import { nutritionTask } from './nutrition';
import { runningTask } from './running';
import { strategyTask } from './strategy';
import { strengthTask } from './strength';

/** Registra as tarefas de planejamento com os casos de avaliação de cada uma. */
export function registerPlanningTasks(registry: AgentTaskRegistry): void {
  const cases = (id: string) => PLANNING_CASES[id] ?? [];
  const checks = (id: string) => PLANNING_CHECKS[id] ?? {};
  registry.register(strategyTask, cases(strategyTask.id), checks(strategyTask.id));
  registry.register(strengthTask, cases(strengthTask.id), checks(strengthTask.id));
  registry.register(runningTask, cases(runningTask.id), checks(runningTask.id));
  registry.register(hyroxTask, cases(hyroxTask.id), checks(hyroxTask.id));
  registry.register(hybridTask, cases(hybridTask.id), checks(hybridTask.id));
  registry.register(nutritionTask, cases(nutritionTask.id), checks(nutritionTask.id));
}
