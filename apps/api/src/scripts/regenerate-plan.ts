/**
 * Regera o protocolo de um aluno a partir de um caso de falha (`DECISION_FAILURE`), com todos os
 * agentes de planejamento fixados num único modelo — sem reserva de outro fornecedor.
 *
 *   docker exec movivo-api node dist/scripts/regenerate-plan.js \
 *     --user <userId> --case <exceptionCaseId> --actor <staffId> \
 *     --vendor DEEPSEEK --model deepseek-v4-pro [--note "texto"] \
 *     [--reasoning-effort low|high|max] [--max-output-tokens N] [--timeout-ms N]
 *
 * Faz o que a Fila faz ao encerrar o caso (status, resolução, auditoria) e enfileira o MESMO job
 * `retry` do worker, com o modelo fixado. Não grava `ExceptionResolved`: o consumidor desse evento
 * enfileiraria um segundo retry, sem o modelo fixado. Os limites (tokens, timeout, temperatura)
 * vêm da rota configurada do modelo no tier — ele precisa estar habilitado.
 *
 * Com `--reasoning-effort` o raciocínio (thinking) é ligado: ele conta como saída (custo e teto),
 * então o teto padrão sobe para 48 mil tokens e o timeout por chamada para 20 min. O job roda UMA vez (sem as novas tentativas automáticas da
 * fila): um timeout não repete a geração inteira e não multiplica o custo.
 *
 * Roda do `dist/` compilado (como o `eval`): o `tsx` não emite os metadados de decorator da
 * injeção. Só núcleo e filas — nunca o `AppModule`, que liga os workers (o job roda na API).
 */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';

import type { PinnedModel } from '../core/agents/agent-runner';
import {
  MODEL_VENDORS,
  REASONING_EFFORTS,
  type ModelVendor,
  type ReasoningEffort,
} from '../core/ai/ai.types';
import { CoreModule } from '../core/core.module';
import { exceptionCases } from '../core/database/schema';
import { TenantDatabase } from '../core/database/tenant-database.service';
import { AuditService } from '../modules/admin/audit.service';
import { QUEUE } from '../modules/jobs/jobs.config';
import { JobsModule } from '../modules/jobs/jobs.module';
import { QueueManager } from '../modules/jobs/queue-manager.service';
import type { PlanGenerationJob } from '../modules/planning/plan-generation.worker';

@Module({ imports: [CoreModule, JobsModule], providers: [AuditService] })
class RegeneratePlanCliModule {}

const print = (line: string) => process.stdout.write(`${line}\n`);

/** Com thinking, o raciocínio conta no teto de saída: o padrão comporta raciocínio + JSON. */
const THINKING_MAX_OUTPUT_TOKENS = 48_000;
const THINKING_TIMEOUT_MS = 20 * 60_000;

function positiveInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`--${name} precisa ser inteiro > 0`);
  return parsed;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`--${name} é obrigatório`);
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      user: { type: 'string' },
      case: { type: 'string' },
      actor: { type: 'string' },
      vendor: { type: 'string' },
      model: { type: 'string' },
      note: { type: 'string' },
      'reasoning-effort': { type: 'string' },
      'max-output-tokens': { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
  });
  const userId = required('user', values.user);
  const caseId = required('case', values.case);
  const actorId = required('actor', values.actor);
  const vendor = required('vendor', values.vendor);
  if (!MODEL_VENDORS.includes(vendor as ModelVendor)) {
    throw new Error(`--vendor precisa ser ${MODEL_VENDORS.join('|')}`);
  }
  const effort = values['reasoning-effort'];
  if (effort !== undefined && !REASONING_EFFORTS.includes(effort as ReasoningEffort)) {
    throw new Error(`--reasoning-effort precisa ser ${REASONING_EFFORTS.join('|')}`);
  }
  const reasoningEffort = effort as ReasoningEffort | undefined;
  const maxOutputTokens =
    positiveInt('max-output-tokens', values['max-output-tokens']) ??
    (reasoningEffort ? THINKING_MAX_OUTPUT_TOKENS : undefined);
  const timeoutMs =
    positiveInt('timeout-ms', values['timeout-ms']) ??
    (reasoningEffort ? THINKING_TIMEOUT_MS : undefined);
  const pinnedModel: PinnedModel = {
    vendor: vendor as ModelVendor,
    model: required('model', values.model),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
  const label = `${vendor}/${pinnedModel.model}${reasoningEffort ? ` (thinking ${reasoningEffort})` : ''}`;
  const note = values.note ?? `Regerado pela operação com o modelo fixado ${label}.`;

  const app = await NestFactory.createApplicationContext(RegeneratePlanCliModule, {
    logger: ['error'],
  });
  try {
    const db = app.get(TenantDatabase);
    const audit = app.get(AuditService);
    await db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select({ status: exceptionCases.status, kind: exceptionCases.kind })
        .from(exceptionCases)
        .where(and(eq(exceptionCases.id, caseId), eq(exceptionCases.userId, userId)))
        .for('update');
      if (!locked) throw new Error('caso não encontrado para este aluno');
      if (locked.kind !== 'DECISION_FAILURE') {
        throw new Error(`o caso é ${locked.kind}; só falhas de geração (DECISION_FAILURE)`);
      }
      if (locked.status === 'RESOLVED') throw new Error('o caso já está resolvido');
      await tx
        .update(exceptionCases)
        .set({
          status: 'RESOLVED',
          resolvedAt: new Date(),
          assignedStaffId: actorId,
          resolution: { outcome: 'RESOLVED', note, pinnedModel },
        })
        .where(eq(exceptionCases.id, caseId));
      await audit.append(tx, {
        actorId,
        userId,
        action: 'exception.resolve',
        entityType: 'exception_case',
        entityId: caseId,
        changes: { kind: locked.kind, via: 'regenerate-plan', pinnedModel },
      });
    });

    const job: PlanGenerationJob = {
      userId,
      triggerEventId: null,
      exceptionCaseId: caseId,
      pinnedModel,
    };
    const jobId = await app.get(QueueManager).enqueue(QUEUE.planGeneration, 'retry', job, {
      jobId: `plan-retry-pinned_${caseId}`,
      attempts: 1,
    });
    print(`caso ${caseId} encerrado; job ${jobId} enfileirado em ${label}`);
    print(
      `  teto de saída ${pinnedModel.maxOutputTokens ?? 'do tier'}; timeout ${pinnedModel.timeoutMs ?? 'do tier'} ms`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
