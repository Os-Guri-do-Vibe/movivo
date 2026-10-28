import { describe, expect, it } from 'vitest';

import { AgentTaskRegistry } from '../../../core/agents/agent-task-registry';
import type { StrengthInput } from '../tasks/strength';
import { hybridTask } from '../tasks/hybrid';
import { hyroxTask } from '../tasks/hyrox';
import { nutritionTask } from '../tasks/nutrition';
import { registerPlanningTasks } from '../tasks/registry';
import { runningTask } from '../tasks/running';
import { strategyTask } from '../tasks/strategy';
import { strengthTask } from '../tasks/strength';
import { PLANNING_CASES } from './index';

const TASKS = [strategyTask, strengthTask, runningTask, hyroxTask, hybridTask, nutritionTask];

describe('casos de avaliação do planejamento', () => {
  it('registra todas as tarefas com seus casos e checagens', () => {
    const registry = new AgentTaskRegistry();
    registerPlanningTasks(registry);
    const listed = registry.list();
    expect(listed.map((t) => t.id).sort()).toEqual(TASKS.map((t) => t.id).sort());
    expect(listed.every((t) => t.cases > 0)).toBe(true);
  });

  it.each(TASKS.map((t) => [t.id, t] as const))(
    'toda entrada de %s respeita o schema',
    (id, task) => {
      for (const evalCase of PLANNING_CASES[id] ?? []) {
        const parsed = task.input.safeParse(evalCase.input);
        expect(parsed.success, `${evalCase.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(
          true,
        );
      }
    },
  );

  it('os casos de força têm candidatos que cobrem os grupos principais', () => {
    for (const evalCase of PLANNING_CASES['strength.build_block'] ?? []) {
      // Com dor no ombro nenhum exercício de peito é viável: o validador não o exige.
      if (evalCase.id === 'avancado-com-dor-no-ombro') continue;
      const input = evalCase.input as StrengthInput;
      const groups = new Set(input.candidates.map((c) => c.muscleGroups[0]));
      for (const major of [
        'peito',
        'costas',
        'ombro',
        'quadríceps',
        'posterior de coxa',
        'glúteo',
      ]) {
        expect(groups.has(major), `${evalCase.id} sem ${major}`).toBe(true);
      }
    }
  });

  it('o aluno com dor no ombro não recebe exercício contraindicado ao ombro', () => {
    const evalCase = PLANNING_CASES['strength.build_block']?.find(
      (c) => c.id === 'avancado-com-dor-no-ombro',
    );
    const ids = new Set((evalCase?.input as StrengthInput).candidates.map((c) => c.id));
    expect(ids.size).toBeGreaterThan(20);
    expect(ids.has('supino_reto_barra')).toBe(false);
  });
});
