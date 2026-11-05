import { describe, expect, it } from 'vitest';

import { reengagementPlanTask, trackingGapTask } from './reengagement-tasks';
import { trainingDailyTask } from './daily-specialists-tasks';
import { followUpCases } from './follow-up-cases';
import { nutritionFollowUpTask } from './nutrition-follow-up-tasks';
import { trainingFollowUpTask } from './training-follow-up-tasks';

const tasks = [
  trainingFollowUpTask,
  nutritionFollowUpTask,
  reengagementPlanTask,
  trackingGapTask,
  trainingDailyTask,
];

describe('casos de avaliação dos agentes de acompanhamento', () => {
  it.each(tasks.map((t) => [t.id, t] as const))(
    '%s tem casos e todos têm entrada válida',
    (id, task) => {
      const cases = followUpCases[id] ?? [];
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) {
        expect(c.taskId).toBe(id);
        expect(c.assertions.length).toBeGreaterThan(0);
        const parsed = task.input.safeParse(c.input);
        expect(parsed.success, `${c.id}: ${parsed.success ? '' : parsed.error.message}`).toBe(true);
      }
    },
  );

  it('ids de caso são únicos', () => {
    const ids = Object.values(followUpCases).flatMap((cases) => cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
