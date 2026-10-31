import { AGENT_PROFILE_STARTERS, AGENT_PROFILE_TASKS, agentOfTask } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { answerTask, substituteTask } from '../conversation/tasks';
import { foodLogTask } from '../nutrition/food-log-task';
import { coordinatorTask } from '../planning/tasks/coordinator';
import { hybridTask } from '../planning/tasks/hybrid';
import { hyroxTask } from '../planning/tasks/hyrox';
import { nutritionTask } from '../planning/tasks/nutrition';
import { runningTask } from '../planning/tasks/running';
import { strategyTask } from '../planning/tasks/strategy';
import { strengthTask } from '../planning/tasks/strength';
import { languageViolations } from '../planning/tasks/common';
import { habitsTask, recoveryTask } from '../progress/analyst-tasks';
import { reviewTask } from '../progress/tasks';
import { commentExamTask, readExamTask } from '../medical/exam-tasks';

const TASK_IDS = new Set(
  [
    answerTask,
    substituteTask,
    foodLogTask,
    coordinatorTask,
    hybridTask,
    hyroxTask,
    nutritionTask,
    runningTask,
    strategyTask,
    strengthTask,
    reviewTask,
    recoveryTask,
    habitsTask,
    readExamTask,
    commentExamTask,
  ].map((t) => t.id),
);

describe('fichas dos agentes', () => {
  it('toda tarefa mapeada existe (senão o teste da ficha não avaliaria nada)', () => {
    for (const tasks of Object.values(AGENT_PROFILE_TASKS)) {
      for (const id of tasks) expect(TASK_IDS.has(id), id).toBe(true);
    }
    expect(agentOfTask('strength.build_block')).toBe('STRENGTH');
    expect(agentOfTask('safety.detect_risk_signals')).toBeNull();
  });

  it('o ponto de partida de cada ficha respeita os guardrails de linguagem', () => {
    for (const [agent, content] of Object.entries(AGENT_PROFILE_STARTERS)) {
      expect(languageViolations(content, agent)).toEqual([]);
    }
  });
});
