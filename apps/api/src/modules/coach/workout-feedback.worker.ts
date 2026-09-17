/**
 * `WorkoutFeedbackWorker` — consome `QUEUE.workoutFeedback`, enfileirado por
 * `WorkoutJournalService.finish()` a cada treino registrado no diário.
 *
 * Mora aqui (não em `workout`, que não pode falar com `LlmRouter`/`ValidationService` —
 * fronteira §12.5) e não em `protocol` (que não tem nada a ver com o diário de treino) —
 * `CoachModule` já importa os dois (`AiCoachModule` e `ProtocolModule`) para o
 * `AIResponseWorker`, então é aqui que qualquer geração de texto do Coach mora.
 *
 * Sempre best-effort: `WorkoutFeedbackService.comment()` nunca lança — se a IA falhar ou a
 * resposta for reprovada na validação, este worker simplesmente não manda bolha nenhuma.
 * O registro do treino em si já foi salvo por `finish()`, antes de este job existir.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { and, desc, eq, ne } from 'drizzle-orm';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { users, workoutSessions, workoutSetEntries } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import {
  WorkoutFeedbackService,
  type RealizedExercise,
  type WorkoutHistoryLine,
} from './workout-feedback.service';

export interface WorkoutFeedbackJob {
  userId: string;
  workoutSessionId: string;
}

/** Sessões anteriores usadas só como contexto curto — não é a periodização do mesociclo. */
const HISTORY_WINDOW = 2;

@Injectable()
export class WorkoutFeedbackWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly feedback: WorkoutFeedbackService,
  ) {}

  onModuleInit(): void {
    this.workers.create<WorkoutFeedbackJob>(QUEUE.workoutFeedback, (job) => this.process(job));
  }

  async process(job: Job<WorkoutFeedbackJob>): Promise<{ status: string }> {
    const { userId, workoutSessionId } = job.data;
    const loaded = await this.load(userId, workoutSessionId);
    if (!loaded) return { status: 'NOT_FOUND' };

    const text = await this.feedback.comment({
      userId,
      user: { name: loaded.name, phoneNumber: loaded.phoneNumber, email: loaded.email },
      biologicalSex: loaded.biologicalSex,
      planejado: loaded.planejado,
      realizado: loaded.realizado,
      esforcoPercebido: loaded.perceivedEffort,
      dorRelatada: loaded.painReported,
      comentarioDoAluno: loaded.feelingNotes,
      historicoRecente: loaded.historicoRecente,
    });
    if (!text) return { status: 'SKIPPED' };

    const outbound: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      dedupeId: `workout-feedback-${workoutSessionId}`,
      text: `Acabei de analisar os resultados do seu treino de hoje!\n---\n${text}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-feedback', outbound, {
      jobId: `wa-workout-feedback-${workoutSessionId}`,
    });
    return { status: 'SENT' };
  }

  private async load(
    userId: string,
    workoutSessionId: string,
  ): Promise<{
    name: string | null;
    phoneNumber: string | null;
    email: string | null;
    biologicalSex: import('@movivo/shared').BiologicalSex | null;
    planejado: { foco: string; exercicios: { name: string; sets: number }[] };
    realizado: RealizedExercise[];
    perceivedEffort: number | null;
    painReported: boolean;
    feelingNotes?: string;
    historicoRecente: WorkoutHistoryLine[];
  } | null> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [self] = await tx
        .select({
          name: users.name,
          phoneNumber: users.phoneNumber,
          email: users.email,
          biologicalSex: users.biologicalSex,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!self) return null;

      const [session] = await tx
        .select({
          scheduledDate: workoutSessions.scheduledDate,
          prescription: workoutSessions.prescription,
          perceivedEffort: workoutSessions.perceivedEffort,
          painReported: workoutSessions.painReported,
          feedbackCipher: workoutSessions.feedbackCipher,
        })
        .from(workoutSessions)
        .where(and(eq(workoutSessions.id, workoutSessionId), eq(workoutSessions.userId, userId)))
        .limit(1);
      if (!session) return null;

      const entries = await tx
        .select({
          exerciseId: workoutSetEntries.exerciseId,
          setNumber: workoutSetEntries.setNumber,
          reps: workoutSetEntries.reps,
          loadValue: workoutSetEntries.loadValue,
          loadUnit: workoutSetEntries.loadUnit,
          durationSeconds: workoutSetEntries.durationSeconds,
          completed: workoutSetEntries.completed,
          skipped: workoutSetEntries.skipped,
        })
        .from(workoutSetEntries)
        .where(eq(workoutSetEntries.workoutSessionId, workoutSessionId));

      const byExercise = new Map<string, typeof entries>();
      for (const entry of entries) {
        const list = byExercise.get(entry.exerciseId) ?? [];
        list.push(entry);
        byExercise.set(entry.exerciseId, list);
      }
      const realizado: RealizedExercise[] = [...byExercise.entries()].map(([exerciseId, sets]) => ({
        exercicio: exerciseId,
        series: sets
          .sort((a, b) => a.setNumber - b.setNumber)
          .map((s) => ({
            serie: s.setNumber,
            reps: s.reps,
            carga: s.loadValue !== null ? Number(s.loadValue) : null,
            unidade: s.loadUnit,
            duracaoSegundos: s.durationSeconds,
            concluida: s.completed,
            pulada: s.skipped,
          })),
      }));

      let feelingNotes: string | undefined;
      if (session.feedbackCipher) {
        try {
          const parsed = JSON.parse(await this.cipher.decryptHealth(session.feedbackCipher)) as {
            feelingNotes?: string;
          };
          feelingNotes = parsed.feelingNotes?.trim() || undefined;
        } catch {
          feelingNotes = undefined;
        }
      }

      const priorSessions = await tx
        .select({
          scheduledDate: workoutSessions.scheduledDate,
          sessionKey: workoutSessions.sessionKey,
          perceivedEffort: workoutSessions.perceivedEffort,
          painReported: workoutSessions.painReported,
          durationSeconds: workoutSessions.durationSeconds,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            eq(workoutSessions.status, 'COMPLETED'),
            ne(workoutSessions.id, workoutSessionId),
          ),
        )
        .orderBy(desc(workoutSessions.scheduledDate))
        .limit(HISTORY_WINDOW);

      const historicoRecente: WorkoutHistoryLine[] = priorSessions.reverse().map((prior) => ({
        data: prior.scheduledDate,
        resumo:
          `${prior.sessionKey}, esforço percebido ${prior.perceivedEffort ?? 'n/d'}, ` +
          `dor: ${prior.painReported ? 'sim' : 'não'}`,
      }));

      const prescription = session.prescription as {
        focus: string;
        exercises: { exerciseId: string; name: string; sets: number }[];
      };

      return {
        name: self.name,
        phoneNumber: self.phoneNumber,
        email: self.email,
        biologicalSex: self.biologicalSex,
        planejado: {
          foco: prescription.focus,
          exercicios: prescription.exercises.map((e) => ({ name: e.name, sets: e.sets })),
        },
        realizado,
        perceivedEffort: session.perceivedEffort,
        painReported: session.painReported,
        feelingNotes,
        historicoRecente,
      };
    });
  }
}
