import {
  AGENT_PROFILE_TASKS,
  AGENT_PROFILE_MAX_CHARS,
  AGENT_TASK_LABELS,
  agentOfTask,
  agentProfileUpdateSchema,
} from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { answerTask, specialistAnswerTasks, substituteTask } from '../conversation/tasks';
import { AgentProfilesService } from './agent-profiles.service';
import { foodLogTask } from '../nutrition/food-log-task';
import { coordinatorTask } from '../planning/tasks/coordinator';
import { hybridTask } from '../planning/tasks/hybrid';
import { hyroxTask } from '../planning/tasks/hyrox';
import { nutritionTask } from '../planning/tasks/nutrition';
import { runningTask } from '../planning/tasks/running';
import { strategyTask } from '../planning/tasks/strategy';
import { strengthTask } from '../planning/tasks/strength';
import { habitsTask, recoveryTask } from '../progress/analyst-tasks';
import { cycleCareTask } from '../progress/cycle-care-tasks';
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
    specialistAnswerTasks.HEALTH,
    cycleCareTask,
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

  it('toda tarefa de agente tem nome legível (o painel nunca mostra o id técnico)', () => {
    for (const id of TASK_IDS) expect(AGENT_TASK_LABELS[id], id).toBeTruthy();
  });
});

describe('teste da ficha não gasta à toa (sem chamar modelo: o avaliador é de mentira)', () => {
  const row = { id: 'x', agent: 'STRENGTH', version: 2, status: 'DRAFT', content: 'texto' };
  const taskIds = AGENT_PROFILE_TASKS.STRENGTH;

  function build(passedBy: (taskId: string) => boolean, costBrl = 0.1) {
    const chain: Record<string, unknown> = {};
    for (const name of ['from', 'where', 'orderBy', 'set']) chain[name] = () => chain;
    chain.returning = () => Promise.resolve([row]);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve([row]).then(resolve);
    const tx = { select: () => chain, update: () => chain };
    const evaluate = vi.fn((taskId: string) =>
      Promise.resolve({
        evalRunId: `run-${taskId}`,
        taskId,
        passed: passedBy(taskId),
        casesTotal: 2,
        casesPassed: 2,
        costBrl,
      }),
    );
    const registry = { list: () => taskIds.map((id) => ({ id, cases: 1 })) };
    const service = new AgentProfilesService(
      { runAsSystem: (cb: (t: unknown) => unknown) => cb(tx) } as never,
      registry as never,
      {
        evaluate,
        panelTestRoute: () => ({ vendor: 'DEEPSEEK', model: 'deepseek-flash' }),
      } as never,
      {} as never,
      {} as never,
    );
    return { service, evaluate };
  }

  it('avalia no modelo barato dos testes', async () => {
    const { service, evaluate } = build(() => true);
    await service.test('x', 'staff');
    expect((evaluate.mock.calls[0] as unknown[] | undefined)?.[1]).toMatchObject({
      routeOverride: { vendor: 'DEEPSEEK', model: 'deepseek-flash' },
    });
  });

  it('para na primeira tarefa que reprova', async () => {
    const { service, evaluate } = build((taskId) => taskId !== taskIds[0]);
    const result = await service.test('x', 'staff');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(result.passed).toBe(false);
  });

  it('para ao passar do teto de gasto e não conta como aprovada', async () => {
    const { service, evaluate } = build(() => true, 3);
    const result = await service.test('x', 'staff');
    expect(evaluate).toHaveBeenCalledTimes(2); // R$ 3 + R$ 3 ≥ teto de R$ 5
    expect(result.passed).toBe(taskIds.length <= 2);
  });
});

describe('texto da ficha', () => {
  const note = 'Ajuste de tom';

  it('aceita até 20.000 caracteres e recusa mais que isso', () => {
    expect(AGENT_PROFILE_MAX_CHARS).toBe(20_000);
    const content = (size: number) => 'a'.repeat(size);
    expect(
      agentProfileUpdateSchema.safeParse({ content: content(20_000), changeNote: note }).success,
    ).toBe(true);
    expect(
      agentProfileUpdateSchema.safeParse({ content: content(20_001), changeNote: note }).success,
    ).toBe(false);
  });

  it('salva a ficha sem passar pelo filtro de linguagem (os limites são do próprio texto)', async () => {
    const row = { id: 'x', agent: 'PERSONA_FEMALE', version: 1, status: 'DRAFT', content: 'x' };
    const chain: Record<string, unknown> = {};
    for (const name of ['from', 'where', 'set']) chain[name] = () => chain;
    chain.returning = () => Promise.resolve([row]);
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve([row]).then(resolve);
    const tx = { select: () => chain, update: () => chain };
    const service = new AgentProfilesService(
      { runAsSystem: (cb: (t: unknown) => unknown) => cb(tx) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const content = `Nunca devo diagnosticar nem indicar tratamento. ${'a'.repeat(80)}`;
    await expect(service.updateDraft('x', { content, changeNote: note })).resolves.toBe(row);
  });
});
