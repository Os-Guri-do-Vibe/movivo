/**
 * EvaluationService — roda os casos de referência de uma tarefa de agente com o modelo real e
 * grava o resultado em `eval_runs`.
 *
 * Cada caso fixa o Estado do Aluno e a entrada; a metodologia vem do próprio caso ou, na falta,
 * da versão publicada. É o gate antes de publicar metodologia, trocar o modelo de um tier ou
 * mudar um prompt: a decisão de seguir em frente olha `passed` desta execução.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

import type { TierRoute } from '../../core/ai/ai.types';
import {
  type AgentContextSources,
  PUBLISHED_METHODOLOGY,
  type PublishedMethodology,
} from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  defineAgentTask,
  type MethodologyDomain,
  type StateSlice,
} from '../../core/agents/agent-task';
import { AgentTaskRegistry } from '../../core/agents/agent-task-registry';
import {
  type AssertionResult,
  type EvalCase,
  evaluatePath,
  scoreCase,
} from '../../core/agents/eval-case';
import { evalRuns, type EvalCaseResult } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';

/** Juiz por rubrica: só onde nenhuma checagem determinística é possível. */
export const judgeTask = defineAgentTask({
  id: 'evaluation.judge',
  role: 'Avaliador rigoroso de qualidade das saídas dos especialistas da MOVIVO.',
  instructions:
    'Leia a rubrica e a saída avaliada (em <dados>). Responda se a saída ATENDE a rubrica. Seja estrito: em dúvida, reprove. Explique em uma frase.',
  tier: 'STANDARD',
  methodology: [],
  state: [],
  input: z.object({ rubric: z.string().min(1), output: z.unknown() }),
  output: z.object({ pass: z.boolean(), reason: z.string().min(1).max(400) }),
  validators: [],
  maxCorrectionRounds: 1,
});

const NO_CONTEXT: AgentContextSources = {
  methodology: async () => ({ text: '', versions: {} }),
  state: async () => ({ slices: {}, version: 0 }),
};

export interface EvaluateOptions {
  caseIds?: readonly string[];
  routeOverride?: TierRoute;
  requestedBy?: string | null;
}

export interface EvalRunSummary {
  evalRunId: string;
  taskId: string;
  passed: boolean;
  casesTotal: number;
  casesPassed: number;
  costBrl: number;
  results: EvalCaseResult[];
}

@Injectable()
export class EvaluationService {
  constructor(
    private readonly registry: AgentTaskRegistry,
    private readonly runner: AgentRunner,
    private readonly db: TenantDatabase,
    @Optional()
    @Inject(PUBLISHED_METHODOLOGY)
    private readonly published: PublishedMethodology | null = null,
  ) {}

  async evaluate(taskId: string, options: EvaluateOptions = {}): Promise<EvalRunSummary> {
    const { task, cases, checks } = this.registry.get(taskId);
    const selected = options.caseIds ? cases.filter((c) => options.caseIds?.includes(c.id)) : cases;
    if (selected.length === 0) throw new Error(`${taskId}: nenhum caso de avaliação selecionado`);

    const startedAt = new Date();
    const results: EvalCaseResult[] = [];
    let methodologyVersions: Partial<Record<MethodologyDomain, number>> = {};
    for (const evalCase of selected) {
      const sources = this.sourcesFor(evalCase);
      try {
        const run = await this.runner.run(task, evalCase.input, {
          userId: null,
          sources,
          routeOverride: options.routeOverride,
        });
        methodologyVersions = { ...methodologyVersions, ...run.methodologyVersions };
        const assertions: AssertionResult[] = [];
        let judgeCost = 0;
        for (const assertion of evalCase.assertions) {
          if (assertion.kind === 'path') assertions.push(evaluatePath(run.output, assertion));
          else if (assertion.kind === 'check') {
            const check = checks[assertion.name];
            const verdict = check
              ? check(run.output, evalCase)
              : { pass: false, detail: 'checagem ausente' };
            assertions.push({ description: assertion.description, ...verdict });
          } else {
            const judged = await this.runner.run(
              judgeTask,
              { rubric: assertion.rubric, output: run.output },
              { userId: null, sources: NO_CONTEXT, routeOverride: options.routeOverride },
            );
            judgeCost += judged.costBrl;
            assertions.push({
              description: assertion.description,
              pass: judged.output.pass,
              detail: judged.output.reason,
            });
          }
        }
        const { score, pass } = scoreCase(evalCase, assertions);
        results.push({
          caseId: evalCase.id,
          pass,
          score,
          assertions,
          correctionRounds: run.correctionRounds,
          costBrl: run.costBrl + judgeCost,
          error: null,
        });
      } catch (error) {
        results.push({
          caseId: evalCase.id,
          pass: false,
          score: 0,
          assertions: [],
          correctionRounds: 0,
          costBrl: 0,
          error:
            error instanceof AgentTaskError
              ? `saída inválida: ${error.violations.map((v) => `${v.path}: ${v.message}`).join('; ')}`
              : error instanceof Error
                ? error.message
                : String(error),
        });
      }
    }

    const casesPassed = results.filter((r) => r.pass).length;
    const costBrl = results.reduce((sum, r) => sum + r.costBrl, 0);
    const passed = casesPassed === results.length;
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .insert(evalRuns)
        .values({
          taskId,
          promptVersion: task.promptVersion,
          methodologyVersions,
          vendor: options.routeOverride?.vendor ?? null,
          model: options.routeOverride?.model ?? null,
          casesTotal: results.length,
          casesPassed,
          passed,
          costBrl,
          results,
          requestedBy: options.requestedBy ?? null,
          startedAt,
          finishedAt: new Date(),
        })
        .returning({ id: evalRuns.id }),
    );
    if (!row) throw new Error('falha ao gravar eval_run');
    return {
      evalRunId: row.id,
      taskId,
      passed,
      casesTotal: results.length,
      casesPassed,
      costBrl,
      results,
    };
  }

  /** O caso fixa o estado; a metodologia vem do caso ou, na falta, da versão publicada. */
  private sourcesFor(evalCase: EvalCase): AgentContextSources {
    return {
      state: async (slices: readonly StateSlice[]) => ({
        slices: Object.fromEntries(
          slices.filter((s) => s in evalCase.state).map((s) => [s, evalCase.state[s]]),
        ),
        version: 0,
      }),
      methodology: async (domains: readonly MethodologyDomain[]) => {
        const fromCase = domains.filter((d) => evalCase.methodology?.[d] !== undefined);
        const missing = domains.filter((d) => evalCase.methodology?.[d] === undefined);
        const published =
          missing.length > 0 && this.published
            ? await this.published.render(missing)
            : { text: '', versions: {} };
        const caseText = fromCase
          .map((d) => `## ${d}\n${evalCase.methodology?.[d] ?? ''}`)
          .join('\n\n');
        return {
          text: [caseText, published.text].filter(Boolean).join('\n\n'),
          versions: published.versions,
        };
      },
    };
  }
}
