import { agentTaskLabel, methodologyDomainSpec, METHODOLOGY_DOMAIN_SPECS } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import { ExecutionTasksModule } from './execution-tasks.module';
import { strengthDomainCases } from './strength-domain-cases';

const registry = new AgentTaskRegistry();
new ExecutionTasksModule(registry).onModuleInit();

describe('casos de avaliação das tarefas de musculação', () => {
  it.each(Object.entries(strengthDomainCases))('%s tem casos válidos', (taskId, cases) => {
    const { task } = registry.get(taskId) as unknown as {
      task: { input: { safeParse: (v: unknown) => { success: boolean; error?: Error } } };
    };
    expect(cases.length).toBeGreaterThan(0);
    for (const evalCase of cases) {
      expect(evalCase.taskId).toBe(taskId);
      expect(evalCase.assertions.length).toBeGreaterThan(0);
      const parsed = task.input.safeParse(evalCase.input);
      expect(parsed.success, `${evalCase.id}: ${parsed.error?.message ?? ''}`).toBe(true);
    }
  });

  it('ids de caso são únicos', () => {
    const ids = Object.values(strengthDomainCases).flatMap((cases) => cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('o teste da metodologia no estúdio', () => {
  it('a musculação não tem tarefa sem caso de avaliação', () => {
    const empty = registry
      .tasksUsing('STRENGTH')
      .filter((id) => registry.get(id).cases.length === 0);
    expect(empty).toEqual([]);
  });

  it('toda tarefa registrada tem nome legível em português', () => {
    const unnamed = registry
      .list()
      .map((t) => t.id)
      .filter((id) => agentTaskLabel(id) === 'Tarefa interna dos agentes');
    expect(unnamed).toEqual([]);
  });

  it('o domínio de musculação existe no catálogo', () => {
    expect(METHODOLOGY_DOMAIN_SPECS.some((s) => s.domain === 'STRENGTH')).toBe(true);
    expect(methodologyDomainSpec('STRENGTH').title).toBeTruthy();
  });
});
