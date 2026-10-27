import { Injectable } from '@nestjs/common';

import type { AgentTask } from './agent-task';
import type { EvalCase, NamedCheck } from './eval-case';

interface RegisteredTask {
  task: AgentTask<unknown, unknown>;
  cases: readonly EvalCase[];
  checks: Readonly<Record<string, NamedCheck>>;
}

/**
 * Catálogo de tarefas de agente com os casos de avaliação de cada uma. Os módulos de domínio
 * registram as suas tarefas no `onModuleInit`; a avaliação e o painel leem daqui.
 */
@Injectable()
export class AgentTaskRegistry {
  private readonly tasks = new Map<string, RegisteredTask>();

  register<I, O>(
    task: AgentTask<I, O>,
    cases: readonly EvalCase[],
    checks: Readonly<Record<string, NamedCheck>> = {},
  ): void {
    if (this.tasks.has(task.id)) throw new Error(`tarefa de agente duplicada: ${task.id}`);
    for (const evalCase of cases) {
      if (evalCase.taskId !== task.id) {
        throw new Error(`caso ${evalCase.id} pertence a ${evalCase.taskId}, não a ${task.id}`);
      }
      for (const assertion of evalCase.assertions) {
        if (assertion.kind === 'check' && !(assertion.name in checks)) {
          throw new Error(`caso ${evalCase.id}: checagem "${assertion.name}" não registrada`);
        }
      }
    }
    this.tasks.set(task.id, { task: task as AgentTask<unknown, unknown>, cases, checks });
  }

  get(taskId: string): RegisteredTask {
    const registered = this.tasks.get(taskId);
    if (!registered) throw new Error(`tarefa de agente não registrada: ${taskId}`);
    return registered;
  }

  /** Tarefas cujo prompt usa o domínio de metodologia (são as testadas ao publicá-lo). */
  tasksUsing(domain: string): string[] {
    return [...this.tasks.values()]
      .filter(({ task }) => (task.methodology as readonly string[]).includes(domain))
      .map(({ task }) => task.id);
  }

  list(): { id: string; tier: string; promptVersion: string; cases: number }[] {
    return [...this.tasks.values()].map(({ task, cases }) => ({
      id: task.id,
      tier: task.tier,
      promptVersion: task.promptVersion,
      cases: cases.length,
    }));
  }
}
