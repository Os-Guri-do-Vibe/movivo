/**
 * Avaliação de tarefas de agente pela linha de comando.
 *
 *   pnpm --filter @movivo/api run eval -- --list
 *   pnpm --filter @movivo/api run eval -- --task running.build_block
 *   pnpm --filter @movivo/api run eval -- --task running.build_block --case longao-sem-pressa
 *   pnpm --filter @movivo/api run eval -- --task running.build_block --vendor ANTHROPIC --model <id>
 *
 * Roda os casos de referência com o modelo real (chaves do `.env`), grava `eval_runs` e sai com
 * código 1 se algum caso reprovar — serve de gate em script ou CI. Roda do `dist/` compilado
 * (como os demais scripts Nest): o `tsx` não emite os metadados de decorator da injeção.
 */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from 'node:util';

import { MODEL_VENDORS, type ModelVendor, type TierRoute } from '../core/ai/ai.types';
import { AgentsModule } from '../core/agents/agents.module';
import { AgentTaskRegistry } from '../core/agents/agent-task-registry';
import { CoreModule } from '../core/core.module';
import { EvaluationModule } from '../modules/evaluation/evaluation.module';
import { EvaluationService } from '../modules/evaluation/evaluation.service';
import { PlanningTasksModule } from '../modules/planning/planning-tasks.module';

/**
 * Só núcleo, agentes e avaliação — nunca o `AppModule`: ele liga os workers das filas, e uma
 * avaliação local não pode consumir jobs (ex.: enviar WhatsApp).
 */
@Module({ imports: [CoreModule, AgentsModule, EvaluationModule, PlanningTasksModule] })
class EvalCliModule {}

function routeOverride(vendor?: string, model?: string): TierRoute | undefined {
  if (!vendor && !model) return undefined;
  if (!vendor || !model || !MODEL_VENDORS.includes(vendor as ModelVendor)) {
    throw new Error(`--vendor (${MODEL_VENDORS.join('|')}) e --model precisam vir juntos`);
  }
  return {
    vendor: vendor as ModelVendor,
    model,
    maxOutputTokens: 12_000,
    timeoutMs: 180_000,
    temperature: 0.3,
    vision: true,
  };
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    // O pnpm repassa um `--` literal antes dos argumentos do script.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      list: { type: 'boolean' },
      task: { type: 'string' },
      case: { type: 'string', multiple: true },
      vendor: { type: 'string' },
      model: { type: 'string' },
    },
  });
  const app = await NestFactory.createApplicationContext(EvalCliModule, { logger: ['error'] });
  try {
    if (values.list || !values.task) {
      for (const task of app.get(AgentTaskRegistry).list()) {
        print(`${task.id}  tier=${task.tier}  prompt=${task.promptVersion}  casos=${task.cases}`);
      }
      return;
    }
    const summary = await app.get(EvaluationService).evaluate(values.task, {
      caseIds: values.case,
      routeOverride: routeOverride(values.vendor, values.model),
    });
    for (const result of summary.results) {
      print(
        `${result.pass ? 'OK ' : 'FALHOU'} ${result.caseId} — nota ${result.score.toFixed(2)}` +
          (result.error ? ` — ${result.error}` : ''),
      );
      for (const assertion of result.assertions.filter((a) => !a.pass)) {
        print(`    ✗ ${assertion.description}: ${assertion.detail}`);
      }
    }
    print(
      `\n${summary.taskId}: ${summary.casesPassed}/${summary.casesTotal} casos — custo R$ ${summary.costBrl.toFixed(4)} — eval_run ${summary.evalRunId}`,
    );
    if (!summary.passed) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
