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
import { PinoLogger } from 'nestjs-pino';
import { and, desc, eq, lt, ne } from 'drizzle-orm';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { users, workoutSessions, workoutSetEntries } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { WorkoutJournalService } from '../workout/workout-journal.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import {
  WorkoutFeedbackService,
  type PreviousExecution,
  type RealizedExercise,
  type WorkoutHistoryLine,
} from './workout-feedback.service';

export interface WorkoutFeedbackJob {
  userId: string;
  workoutSessionId: string;
}

/**
 * Tempo entre o "Finalizar" e a primeira bolha do comentário aparecer para o aluno. Decisão do
 * fundador (2026-10-16): 5 minutos NO TOTAL, para o comentário chegar como quem de fato
 * analisou o treino. O texto é gerado logo (o dado já está completo no Finalizar) e o envio é
 * agendado para fechar a conta: geração e "digitando…" saem do mesmo orçamento, não somam.
 */
const FEEDBACK_TOTAL_DELAY_MS = 5 * 60_000;
/**
 * O transporte mostra "digitando…" por 15–20 s ANTES de cada bolha sair (anti-ban, ver
 * `HUMAN_DELAY_*` em `evolution-transport.ts`); o valor médio é descontado do agendamento
 * para a 1ª bolha chegar perto dos 5 minutos. A 2ª vem ~15–20 s depois, como numa conversa.
 */
const OUTBOUND_TYPING_ALLOWANCE_MS = 17_500;

/** Sessões anteriores usadas só como contexto curto — não é a periodização do mesociclo. */
const HISTORY_WINDOW = 2;

/**
 * Quanto falta esperar para a 1ª bolha chegar `FEEDBACK_TOTAL_DELAY_MS` depois de o job nascer
 * (= o Finalizar). Usa o relógio do job, não o da tentativa: um retry não reinicia a contagem.
 * Geração lenta, ou job sem relógio, manda sem espera extra.
 */
export function remainingSendDelayMs(createdAtMs: number | undefined, nowMs: number): number {
  if (!createdAtMs) return 0;
  const elapsed = Math.max(0, nowMs - createdAtMs);
  return Math.max(0, FEEDBACK_TOTAL_DELAY_MS - OUTBOUND_TYPING_ALLOWANCE_MS - elapsed);
}

@Injectable()
export class WorkoutFeedbackWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly feedback: WorkoutFeedbackService,
    private readonly journal: WorkoutJournalService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutFeedbackWorker.name);
  }

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
      treinoDe: loaded.treinoDe,
      ...(loaded.ultimaExecucaoDoMesmoTreino
        ? { ultimaExecucaoDoMesmoTreino: loaded.ultimaExecucaoDoMesmoTreino }
        : {}),
      voltaAposDiaSemRegistro: loaded.painReported
        ? false
        : await this.returnedAfterMiss(userId, loaded.scheduledDate),
    });
    if (!text) return { status: 'SKIPPED' };

    const outbound: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      dedupeId: `workout-feedback-${workoutSessionId}`,
      text: `Acabei de analisar os resultados do seu treino de ${loaded.treinoDe}!\n---\n${text}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'workout-feedback', outbound, {
      jobId: `wa-workout-feedback-${workoutSessionId}`,
      delay: remainingSendDelayMs(job.timestamp, Date.now()),
    });
    return { status: 'SENT' };
  }

  /**
   * Este treino é uma volta? A sessão prevista imediatamente anterior ficou sem registro.
   * Calculado aqui (fila assíncrona, fora do caminho HTTP do `finish()`) e estável no retry,
   * porque dias passados não mudam. Melhor esforço: na dúvida, o comentário não cita a volta.
   */
  private async returnedAfterMiss(userId: string, scheduledDate: string): Promise<boolean> {
    try {
      const { target } = await this.journal.recentMissStreak(userId, scheduledDate);
      return target?.status.kind === 'MISSED';
    } catch (err: unknown) {
      this.logger.warn(
        { event: 'workout_feedback_return_check_failed', userId, err },
        'não foi possível checar se este treino é uma volta; o comentário segue sem citá-la',
      );
      return false;
    }
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
    scheduledDate: string;
    feelingNotes?: string;
    historicoRecente: WorkoutHistoryLine[];
    ultimaExecucaoDoMesmoTreino: PreviousExecution | null;
    /** "hoje", "ontem", "anteontem" ou o dia da semana: só difere de "hoje" no registro tardio. */
    treinoDe: string;
  } | null> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [self] = await tx
        .select({
          name: users.name,
          phoneNumber: users.phoneNumber,
          email: users.email,
          biologicalSex: users.biologicalSex,
          timezone: users.timezone,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!self) return null;

      const [session] = await tx
        .select({
          scheduledDate: workoutSessions.scheduledDate,
          sessionKey: workoutSessions.sessionKey,
          loggedLate: workoutSessions.loggedLate,
          protocolId: workoutSessions.protocolId,
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

      const prescription = session.prescription as {
        focus: string;
        exercises: { exerciseId: string; name: string; sets: number }[];
      };
      // O modelo recebe o NOME do exercício, nunca o id interno.
      const nameOf = new Map(prescription.exercises.map((e) => [e.exerciseId, e.name]));

      const byExercise = new Map<string, typeof entries>();
      for (const entry of entries) {
        const list = byExercise.get(entry.exerciseId) ?? [];
        list.push(entry);
        byExercise.set(entry.exerciseId, list);
      }
      const realizado: RealizedExercise[] = [...byExercise.entries()].map(([exerciseId, sets]) => ({
        exercicio: nameOf.get(exerciseId) ?? exerciseId,
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

      const ultimaExecucaoDoMesmoTreino = await this.loadPreviousExecution(tx, userId, {
        workoutSessionId,
        sessionKey: session.sessionKey,
        scheduledDate: session.scheduledDate,
        exerciseNames: nameOf,
      });

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
        scheduledDate: session.scheduledDate,
        feelingNotes,
        historicoRecente,
        ultimaExecucaoDoMesmoTreino,
        treinoDe: session.loggedLate
          ? describeTrainingDay(session.scheduledDate, self.timezone, new Date())
          : 'hoje',
      };
    });
  }

  /**
   * A última vez que o aluno fez ESTA sessão (mesmo `session_key`), seja em que dia da semana
   * for. Só entram os exercícios que também estão no treino de hoje: se o protocolo mudou de
   * mesociclo e a letra passou a significar outro treino, sem exercício em comum não há
   * comparação a fazer.
   */
  private async loadPreviousExecution(
    tx: TenantTransaction,
    userId: string,
    current: {
      workoutSessionId: string;
      sessionKey: string;
      scheduledDate: string;
      exerciseNames: ReadonlyMap<string, string>;
    },
  ): Promise<PreviousExecution | null> {
    const [previous] = await tx
      .select({
        id: workoutSessions.id,
        scheduledDate: workoutSessions.scheduledDate,
        perceivedEffort: workoutSessions.perceivedEffort,
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, 'COMPLETED'),
          eq(workoutSessions.sessionKey, current.sessionKey),
          ne(workoutSessions.id, current.workoutSessionId),
          lt(workoutSessions.scheduledDate, current.scheduledDate),
        ),
      )
      .orderBy(desc(workoutSessions.scheduledDate))
      .limit(1);
    if (!previous) return null;

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
      .where(eq(workoutSetEntries.workoutSessionId, previous.id));
    const exercicios = groupRealized(entries, current.exerciseNames);
    if (exercicios.length === 0) return null;
    return {
      quando: describeWhen(previous.scheduledDate, current.scheduledDate),
      esforcoPercebido: previous.perceivedEffort,
      exercicios,
    };
  }
}

type SetEntry = {
  exerciseId: string;
  setNumber: number;
  reps: number | null;
  loadValue: string | null;
  loadUnit: string;
  durationSeconds: number | null;
  completed: boolean;
  skipped: boolean;
};

/**
 * Agrupa as séries por exercício, mantendo só os que estão em `names` (os do treino de hoje) e,
 * neles, só o que de fato aconteceu (série concluída ou pulada de propósito).
 */
export function groupRealized(
  entries: readonly SetEntry[],
  names: ReadonlyMap<string, string>,
): RealizedExercise[] {
  const byExercise = new Map<string, SetEntry[]>();
  for (const entry of entries) {
    if (!names.has(entry.exerciseId)) continue;
    if (!entry.completed && !entry.skipped) continue;
    byExercise.set(entry.exerciseId, [...(byExercise.get(entry.exerciseId) ?? []), entry]);
  }
  return [...byExercise.entries()].map(([exerciseId, sets]) => ({
    exercicio: names.get(exerciseId) ?? exerciseId,
    series: [...sets]
      .sort((a, b) => a.setNumber - b.setNumber)
      .map((set) => ({
        serie: set.setNumber,
        reps: set.reps,
        carga: set.loadValue !== null ? Number(set.loadValue) : null,
        unidade: set.loadUnit,
        duracaoSegundos: set.durationSeconds,
        concluida: set.completed,
        pulada: set.skipped,
      })),
  }));
}

/**
 * Quando foi o treino, em palavras, para o dia local do aluno: "hoje", "ontem", "anteontem" ou o
 * dia da semana ("sexta"). Fuso inválido cai no de São Paulo.
 */
export function describeTrainingDay(
  scheduledDate: string,
  timezone: string | null,
  now: Date,
): string {
  const zone = (() => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: timezone ?? 'America/Sao_Paulo' });
      return timezone ?? 'America/Sao_Paulo';
    } catch {
      return 'America/Sao_Paulo';
    }
  })();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const at = (date: string) => new Date(`${date}T12:00:00.000Z`).getTime();
  const days = Math.round((at(today) - at(scheduledDate)) / 86_400_000);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days === 2) return 'anteontem';
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(at(scheduledDate)))
    .replace('-feira', '');
}

/** Ex.: "terça-feira, 13/10 (há 7 dias)". Datas são dias civis `YYYY-MM-DD`. */
export function describeWhen(previousDate: string, currentDate: string): string {
  const at = (date: string) => new Date(`${date}T12:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(
    at(previousDate),
  );
  const [, month, day] = previousDate.split('-');
  const days = Math.round((at(currentDate).getTime() - at(previousDate).getTime()) / 86_400_000);
  const ago = days === 1 ? 'ontem' : `há ${days} dias`;
  return `${weekday}, ${day}/${month} (${ago})`;
}
