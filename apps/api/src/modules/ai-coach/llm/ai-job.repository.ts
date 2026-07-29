/**
 * Persistência de `ai_jobs` sob RLS (US-2.2 / TASK-2.2.3 · Victor §6.1).
 *
 * Toda invocação de LLM grava uma linha completa e **pseudonimizada** (o `input_snapshot`
 * é a saída do PII Scrubber, nunca PII em claro). `ai_jobs` está sob `FORCE ROW LEVEL
 * SECURITY` (security-policies), então escreve/lê sempre via `TenantDatabase`, nunca conexão
 * crua — o mesmo padrão das tabelas de titular da Sprint 1.
 */
import { Injectable } from '@nestjs/common';

import { TenantDatabase } from '../../../core/database/tenant-database.service';
import { aiJobs, type AiJobRow } from '../../../core/database/schema/ai-jobs';
import type { LLMPurpose } from './llm.types';

export interface AiJobLog {
  jobType: LLMPurpose;
  status: 'COMPLETED' | 'FAILED';
  provider: string | null;
  modelUsed: string | null;
  dataClass: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  latencyMs: number;
  attempt: number;
  intent: string | null;
  costBrl: number;
  validationAction: string | null;
  /** Snapshot já pseudonimizado do que foi enviado. Nunca PII em claro. */
  inputSnapshot: string;
  errorMessage: string | null;
}

@Injectable()
export class AiJobRepository {
  constructor(private readonly db: TenantDatabase) {}

  /** Grava um registro de `ai_jobs` no contexto (RLS) do titular. */
  async record(userId: string, log: AiJobLog): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx.insert(aiJobs).values({
        userId,
        jobType: log.jobType,
        status: log.status,
        provider: log.provider,
        modelUsed: log.modelUsed,
        dataClass: log.dataClass,
        tokensInput: log.tokensInput,
        tokensOutput: log.tokensOutput,
        tokensCached: log.tokensCached,
        latencyMs: log.latencyMs,
        attempt: log.attempt,
        intent: log.intent,
        // numeric(10,5) → string para o driver.
        costBrl: log.costBrl.toFixed(5),
        validationAction: log.validationAction,
        inputSnapshot: log.inputSnapshot,
        errorMessage: log.errorMessage,
        startedAt: new Date(),
        completedAt: new Date(),
      });
    });
  }

  /** Lê os `ai_jobs` visíveis ao titular (a RLS já escopa por `user_id`). */
  async listForUser(userId: string): Promise<AiJobRow[]> {
    return this.db.runAsUser(userId, 'USER', (tx) => tx.select().from(aiJobs));
  }
}
