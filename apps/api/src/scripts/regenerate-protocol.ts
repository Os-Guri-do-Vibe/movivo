/**
 * Regera do zero o protocolo (treino OU alimentar) de um caso de revisão da Fila, pela linha de
 * comando. Faz o mesmo que o botão "Regerar" do painel (`ExceptionsService.regenerateProtocol`):
 * recusa a proposta atual sem que chegue ao aluno, encerra o caso (REGENERATION_REQUESTED), audita
 * e pede ao planejamento que refaça aquele protocolo a partir do Estado do Aluno e da estratégia
 * salva, sem usar o rascunho antigo como base.
 *
 *   docker compose exec api node --enable-source-maps dist/scripts/regenerate-protocol.js \
 *     --user <userId> --case <exceptionCaseId> --actor <staffId>
 *
 * Quando usar: o painel exige sessão de profissional; este script serve a quem opera o ambiente
 * (o `--actor` é o profissional que pediu e fica na auditoria). Útil depois de um conserto de
 * dados (ex.: `repair-anamnesis-notes`) que muda o que os agentes recebem.
 *
 * Se o job de uma regeneração já pedida falhou (caso encerrado com REGENERATION_REQUESTED e sem
 * protocolo novo), rodar de novo com os mesmos argumentos só enfileira o job outra vez.
 *
 * Não grava `ExceptionResolved`: o consumidor desse evento enfileiraria um segundo job. O job
 * `regenerate` é enfileirado aqui, com id estável pelo caso (rodar de novo não duplica), e roda
 * no worker da API. Só núcleo e filas: nunca o `AppModule`, que liga os workers.
 */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';

import { CoreModule } from '../core/core.module';
import { coachingProposals, exceptionCases } from '../core/database/schema';
import { TenantDatabase } from '../core/database/tenant-database.service';
import { AuditService } from '../modules/admin/audit.service';
import { QUEUE } from '../modules/jobs/jobs.config';
import { JobsModule } from '../modules/jobs/jobs.module';
import { QueueManager } from '../modules/jobs/queue-manager.service';
import type { PlanGenerationJob } from '../modules/planning/plan-generation.worker';

@Module({ imports: [CoreModule, JobsModule], providers: [AuditService] })
class RegenerateProtocolCliModule {}

const print = (line: string) => process.stdout.write(`${line}\n`);

const REGENERATION_NOTE = 'Regeneração completa do protocolo pedida pelo profissional.';

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`--${name} é obrigatório`);
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { user: { type: 'string' }, case: { type: 'string' }, actor: { type: 'string' } },
  });
  const userId = required('user', values.user);
  const caseId = required('case', values.case);
  const actorId = required('actor', values.actor);

  const app = await NestFactory.createApplicationContext(RegenerateProtocolCliModule, {
    logger: ['error'],
  });
  try {
    const db = app.get(TenantDatabase);
    const audit = app.get(AuditService);
    const kind = await db.runAsSystem(async (tx) => {
      const [locked] = await tx
        .select({
          status: exceptionCases.status,
          kind: exceptionCases.kind,
          subject: exceptionCases.subject,
          resolution: exceptionCases.resolution,
        })
        .from(exceptionCases)
        .where(and(eq(exceptionCases.id, caseId), eq(exceptionCases.userId, userId)))
        .for('update');
      if (!locked) throw new Error('caso não encontrado para este aluno');
      if (locked.kind !== 'PROTOCOL_REVIEW') {
        throw new Error(`o caso é ${locked.kind}; só protocolo em revisão (PROTOCOL_REVIEW)`);
      }
      if (locked.status === 'RESOLVED') {
        // Regeneração já pedida para este caso (o job anterior falhou ou se perdeu): só refaz o job.
        if (locked.resolution?.outcome === 'REGENERATION_REQUESTED') return 'REQUEUE' as const;
        throw new Error('o caso já está resolvido');
      }
      const proposalId = locked.subject.proposalId;
      const [proposal] = proposalId
        ? await tx
            .select({ action: coachingProposals.action })
            .from(coachingProposals)
            .where(eq(coachingProposals.id, proposalId))
        : [];
      const action = proposal?.action;
      if (
        !proposalId ||
        (action?.type !== 'PUBLISH_TRAINING_PLAN' && action?.type !== 'PUBLISH_NUTRITION_PLAN')
      ) {
        throw new Error('o caso não é de publicação de protocolo de treino ou alimentar');
      }
      const rejected = await tx
        .update(coachingProposals)
        .set({ status: 'REJECTED' })
        .where(and(eq(coachingProposals.id, proposalId), eq(coachingProposals.status, 'PENDING')))
        .returning({ id: coachingProposals.id });
      if (rejected.length === 0) throw new Error('a proposta não está mais pendente');
      await tx
        .update(exceptionCases)
        .set({
          status: 'RESOLVED',
          resolvedAt: new Date(),
          assignedStaffId: actorId,
          resolution: { outcome: 'REGENERATION_REQUESTED', note: REGENERATION_NOTE },
        })
        .where(eq(exceptionCases.id, caseId));
      const protocol = action.type === 'PUBLISH_TRAINING_PLAN' ? 'TRAINING' : 'NUTRITION';
      await audit.append(tx, {
        actorId,
        userId,
        action: 'exception.protocol_regenerate',
        entityType: 'exception_case',
        entityId: caseId,
        changes: {
          planId: action.planId,
          proposalId,
          kind: protocol,
          reason: 'FULL_REGENERATION',
          via: 'regenerate-protocol',
        },
      });
      return protocol;
    });

    const job: PlanGenerationJob = { userId, triggerEventId: null, exceptionCaseId: caseId };
    // O id do job é estável pelo caso (rodar de novo não duplica); ao refazer um job que falhou,
    // o id muda, senão a fila o trataria como o mesmo job já encerrado.
    const requeue = kind === 'REQUEUE';
    const jobId = await app.get(QueueManager).enqueue(QUEUE.planGeneration, 'regenerate', job, {
      jobId: requeue
        ? `plan-regenerate-cli_${caseId}_${Date.now()}`
        : `plan-regenerate-cli_${caseId}`,
    });
    print(
      requeue
        ? `caso ${caseId} já tinha a regeneração pedida; job ${jobId} enfileirado de novo`
        : `caso ${caseId} (${kind}) encerrado; job ${jobId} enfileirado`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
