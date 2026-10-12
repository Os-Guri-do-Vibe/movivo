/**
 * `SystemScriptsService` — painel "Sistema → Scripts".
 *
 * Lista os crons/rotinas/scripts do catálogo e executa à força os que podem rodar pelo painel.
 *
 * Execução de um CRON: enfileira um job extra (`manual-…`, `force: true`) na MESMA fila do
 * scheduler. O agendamento registrado por `upsertJobScheduler` não é lido nem alterado — a
 * execução manual é só mais um job, consumido pelo worker de sempre (retry, DLQ e limites
 * de concorrência incluídos), sem rodar varredura pesada dentro da requisição HTTP.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ControlCenterCapability as Capability,
  type ControlCenterScript,
  type ControlCenterScriptRunResponse,
  type ControlCenterScriptRunState,
  type ControlCenterScriptsResponse,
} from '@movivo/shared';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { roleHasCapabilities } from '../auth/capabilities';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { QueueManager } from '../jobs/queue-manager.service';
import { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import { AuditService } from './audit.service';
import { FinanceService } from './finance.service';
import {
  ALL_SCRIPTS,
  type CronScript,
  type RoutineScript,
  type ScriptDefinition,
} from './system-scripts.catalog';

const TIMEZONE = 'America/Sao_Paulo' as const;

/** Quantos jobs recentes de cada fila olhar atrás de execuções manuais. */
const RECENT_JOBS = 100;

const FINANCE_CAPABILITIES = [Capability.FINANCE_READ, Capability.FINANCE_WRITE];

interface ManualJobData {
  kind: 'SCAN';
  force: true;
  manual: true;
  scriptId: string;
  requestedBy: string;
}

type LastRun = NonNullable<ControlCenterScript['lastRun']>;

function runState(job: Job): ControlCenterScriptRunState {
  if (job.finishedOn) return job.failedReason ? 'FAILED' : 'COMPLETED';
  return job.processedOn ? 'RUNNING' : 'QUEUED';
}

function summarize(job: Job, labels: CronScript['resultLabels']): string | null {
  if (job.finishedOn && job.failedReason) return job.failedReason.slice(0, 200);
  const value: unknown = job.returnvalue;
  if (!value || typeof value !== 'object') return null;
  const parts = Object.entries(labels)
    .map(([key, label]) => {
      const amount = (value as Record<string, unknown>)[key];
      return typeof amount === 'number' ? `${amount} ${label}` : null;
    })
    .filter((part): part is string => part !== null);
  return parts.length ? parts.join(' · ') : null;
}

@Injectable()
export class SystemScriptsService {
  constructor(
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
    private readonly finance: FinanceService,
    private readonly exerciseCatalog: ExerciseCatalogProvider,
  ) {}

  async list(actor: AuthenticatedUser): Promise<ControlCenterScriptsResponse> {
    const cronRuns = new Map<string, LastRun>();
    for (const queueName of new Set(this.crons().map((cron) => cron.queue))) {
      for (const [scriptId, run] of await this.manualRuns(queueName)) cronRuns.set(scriptId, run);
    }
    const scripts = ALL_SCRIPTS.map((script) => this.toView(script, actor, cronRuns));
    return this.envelope({ scripts });
  }

  async run(actor: AuthenticatedUser, id: string): Promise<ControlCenterScriptRunResponse> {
    const script = ALL_SCRIPTS.find((candidate) => candidate.id === id);
    if (!script) throw new NotFoundException('Script não encontrado.');
    if (script.kind === 'TERMINAL') {
      throw new BadRequestException(`Este script só roda no terminal: ${script.notRunnableReason}`);
    }
    const result =
      script.kind === 'CRON'
        ? await this.runCron(actor, script)
        : await this.runRoutine(actor, script);
    await this.recordAudit(actor, script, result.status);
    return this.envelope(result);
  }

  private crons(): CronScript[] {
    return ALL_SCRIPTS.filter((script): script is CronScript => script.kind === 'CRON');
  }

  private async runCron(
    actor: AuthenticatedUser,
    script: CronScript,
  ): Promise<ControlCenterScriptRunResponse['data']> {
    const running = (await this.manualRuns(script.queue)).get(script.id);
    if (running && (running.state === 'QUEUED' || running.state === 'RUNNING')) {
      throw new ConflictException('Este script já está em execução. Aguarde terminar.');
    }
    const data: ManualJobData = {
      kind: 'SCAN',
      force: true,
      manual: true,
      scriptId: script.id,
      requestedBy: actor.userId,
    };
    const jobId = await this.queues.enqueue(script.queue, `manual-${script.schedulerId}`, data, {
      jobId: `manual-${script.id}-${randomUUID()}`,
    });
    return {
      id: script.id,
      status: 'ENQUEUED',
      message: `Execução de "${script.name}" enfileirada (${jobId}). O resultado aparece aqui em instantes.`,
    };
  }

  private async runRoutine(
    actor: AuthenticatedUser,
    script: RoutineScript,
  ): Promise<ControlCenterScriptRunResponse['data']> {
    if (script.id === 'exercise-catalog-refresh') {
      await this.exerciseCatalog.refresh();
      return { id: script.id, status: 'COMPLETED', message: 'Catálogo de exercícios recarregado.' };
    }
    if (script.id === 'finance-recurring-expenses') {
      this.assertFinanceAccess(actor);
      const result = await this.finance.materializeRecurring(actor);
      const created = result.data.created;
      return {
        id: script.id,
        status: 'COMPLETED',
        message: created
          ? `${created} despesa(s) recorrente(s) lançada(s) no livro-caixa.`
          : 'Nenhuma despesa recorrente pendente de lançamento.',
      };
    }
    throw new BadRequestException('Rotina sem executor registrado.');
  }

  private assertFinanceAccess(actor: AuthenticatedUser): void {
    if (!roleHasCapabilities(actor.role, FINANCE_CAPABILITIES)) {
      throw new ForbiddenException(
        'Esta rotina altera o livro-caixa e exige as permissões financeiras de leitura e escrita.',
      );
    }
  }

  /**
   * Execuções manuais ainda visíveis em uma fila, a mais recente de cada script. Concluídas
   * ficam 1h no Redis e falhas 7 dias (`resolveJobOptions`) — fora disso a lista volta a
   * mostrar "sem execução recente", sem inventar histórico.
   */
  private async manualRuns(queueName: CronScript['queue']): Promise<Map<string, LastRun>> {
    const jobs = await this.queues
      .get(queueName)
      .getJobs(
        ['active', 'waiting', 'delayed', 'prioritized', 'completed', 'failed'],
        0,
        RECENT_JOBS - 1,
        false,
      );
    const labelsById = new Map(this.crons().map((cron) => [cron.id, cron.resultLabels]));
    const latest = new Map<string, { job: Job; at: number }>();
    for (const job of jobs) {
      const data = job.data as Partial<ManualJobData> | undefined;
      if (!data?.manual || !data.scriptId) continue;
      const at = job.finishedOn ?? job.processedOn ?? job.timestamp;
      const current = latest.get(data.scriptId);
      if (!current || at > current.at) latest.set(data.scriptId, { job, at });
    }
    const runs = new Map<string, LastRun>();
    for (const [scriptId, { job, at }] of latest) {
      runs.set(scriptId, {
        state: runState(job),
        at: new Date(at).toISOString(),
        summary: summarize(job, labelsById.get(scriptId) ?? {}),
      });
    }
    return runs;
  }

  private toView(
    script: ScriptDefinition,
    actor: AuthenticatedUser,
    cronRuns: ReadonlyMap<string, LastRun>,
  ): ControlCenterScript {
    const base = { id: script.id, name: script.name, description: script.description };
    if (script.kind === 'TERMINAL') {
      return {
        ...base,
        kind: 'TERMINAL',
        schedule: null,
        runEffect: null,
        runnable: false,
        command: script.command,
        notRunnableReason: script.notRunnableReason,
        lastRun: null,
      };
    }
    const financeBlocked =
      script.id === 'finance-recurring-expenses' &&
      !roleHasCapabilities(actor.role, FINANCE_CAPABILITIES);
    return {
      ...base,
      kind: script.kind,
      schedule: script.schedule,
      runEffect: script.runEffect,
      runnable: !financeBlocked,
      command: null,
      notRunnableReason: financeBlocked
        ? 'Exige as permissões financeiras de leitura e escrita.'
        : null,
      lastRun: script.kind === 'CRON' ? (cronRuns.get(script.id) ?? null) : null,
    };
  }

  /** Trilha imutável: quem forçou a execução de qual script, e quando. */
  private async recordAudit(
    actor: AuthenticatedUser,
    script: ScriptDefinition,
    status: 'ENQUEUED' | 'COMPLETED',
  ): Promise<void> {
    await this.db.runAsSystem((tx) =>
      this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'system.script.run',
        entityType: 'system_script',
        entityId: randomUUID(),
        changes: { script: script.id, kind: script.kind, status },
      }),
    );
  }

  private envelope<T>(data: T) {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }
}
