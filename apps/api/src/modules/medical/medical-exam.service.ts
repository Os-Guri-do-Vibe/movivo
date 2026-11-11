/**
 * Exame recebido no WhatsApp: guarda o arquivo cifrado, lê os valores (visão), comenta ao aluno
 * com cautela, registra para o médico (CRM) e alimenta o contexto de saúde do aluno.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  WHATSAPP_BUBBLE_SEPARATOR,
  examCommentSchema,
  examReadingSchema,
  type ExamComment,
  type ExamReading,
  type MedicalExamView,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner } from '../../core/agents/agent-runner';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { medicalExams, studentHealthRecords } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { MEDIA_EXAM_EVENT, type InboundMediaEvent } from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { QUEUE, QUEUE_REGISTRY } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { StudentStateReader } from '../student-state/student-state.reader';
import { commentExamTask, readExamTask } from './exam-tasks';

export interface MedicalExamJob {
  examId: string;
  userId: string;
}

/** Exames por aluno por dia (cada um custa duas chamadas de modelo). */
const EXAMS_PER_DAY = 6;
const DAY_SECONDS = 86_400;

const RECEIVED_MESSAGE = 'Recebi o seu exame. Vou ler com cuidado e já te conto o que vi.';
const LIMIT_MESSAGE =
  'Já recebi vários exames hoje. Para eu ler com calma, mande os próximos amanhã, por favor.';
const NOT_EXAM_MESSAGE =
  'Esse arquivo não parece um resultado de exame. Por aqui eu leio exames em PDF ou foto; se for outra coisa, me conta por mensagem.';
const ILLEGIBLE_MESSAGE =
  'Não consegui ler os resultados com nitidez. Pode mandar o PDF do laboratório ou uma foto mais nítida, com a página inteira?';
const FAILED_MESSAGE =
  'Não consegui analisar o seu exame agora. Pode mandar de novo daqui a pouco, por favor?';
const DISCLAIMER =
  'Essa é uma leitura inicial e não substitui a consulta médica: leve o exame ao seu médico.';
/** Com ponto de atenção, a orientação é procurar um médico de fora: ninguém da equipe é prometido. */
export function seekDoctorMessage(specialties: readonly string[]): string {
  const where = specialties.length > 0 ? ` (${specialties.join(' ou ')})` : '';
  return `Essa é uma leitura inicial e não substitui a consulta médica. Como há pontos que merecem atenção, recomendo marcar uma avaliação médica${where} e levar este exame.`;
}

const decode = async <T>(
  cipher: HealthCipherService,
  value: Buffer | null,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
): Promise<T | null> => {
  if (!value) return null;
  const parsed = schema.safeParse(JSON.parse(await cipher.decryptHealth(value)));
  return parsed.success ? parsed.data : null;
};

/** Exame para o painel (leitura e comentário decifrados). */
export async function examViewOf(
  tx: TenantTransaction,
  cipher: HealthCipherService,
  examId: string,
): Promise<MedicalExamView | null> {
  const [row] = await tx
    .select({
      id: medicalExams.id,
      createdAt: medicalExams.createdAt,
      status: medicalExams.status,
      reading: medicalExams.reading,
      comment: medicalExams.comment,
    })
    .from(medicalExams)
    .where(eq(medicalExams.id, examId));
  if (!row) return null;
  return {
    id: row.id,
    receivedAt: row.createdAt.toISOString(),
    status: row.status as MedicalExamView['status'],
    reading: await decode<ExamReading>(cipher, row.reading, examReadingSchema),
    comment: await decode<ExamComment>(cipher, row.comment, examCommentSchema),
  };
}

/** Arquivo original decifrado, para o médico conferir a leitura. */
export async function examFileOf(
  tx: TenantTransaction,
  cipher: HealthCipherService,
  examId: string,
): Promise<{ mediaType: string; base64: string } | null> {
  const [row] = await tx
    .select({ mediaType: medicalExams.mediaType, file: medicalExams.file })
    .from(medicalExams)
    .where(eq(medicalExams.id, examId));
  if (!row) return null;
  return {
    mediaType: row.mediaType,
    base64: (await cipher.decryptBytes(row.file)).toString('base64'),
  };
}

@Injectable()
export class MedicalExamService implements OnModuleInit, OnModuleDestroy {
  private unregister?: () => void;

  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly pipeline: DecisionPipeline,
    private readonly events: DomainEventBus,
    private readonly queues: QueueManager,
    private readonly workers: WorkerFactory,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MedicalExamService.name);
  }

  onModuleInit(): void {
    this.unregister = this.events.register<InboundMediaEvent, boolean>(MEDIA_EXAM_EVENT, (event) =>
      this.receive(event),
    );
    this.workers.create<MedicalExamJob>(QUEUE.medicalExam, (job) => this.process(job));
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  /** Guarda cifrado e enfileira a análise (fora do webhook). `true` = recebido. */
  async receive(event: InboundMediaEvent): Promise<boolean> {
    const { userId, messageKey } = event;
    const counter = this.keys.forUser(userId, 'medical', 'exams-today');
    const count = await this.redis.incr(counter);
    if (count === 1) await this.redis.expire(counter, DAY_SECONDS);
    if (count > EXAMS_PER_DAY) {
      await this.reply(userId, `exam-limit-${messageKey}`, LIMIT_MESSAGE);
      return true;
    }
    const file = await this.cipher.encryptBytes(event.bytes);
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(medicalExams)
        .values({ userId, mediaType: event.mediaType, file })
        .returning({ id: medicalExams.id }),
    );
    if (!row) throw new Error('falha ao registrar o exame');
    await this.queues.enqueue(
      QUEUE.medicalExam,
      'analyze',
      { examId: row.id, userId },
      { jobId: `exam-${row.id}` },
    );
    await this.reply(userId, `exam-received-${row.id}`, RECEIVED_MESSAGE);
    return true;
  }

  async process(job: Job<MedicalExamJob>): Promise<string> {
    try {
      return await this.analyze(job.data);
    } catch (error) {
      // Última tentativa: o aluno não fica esperando uma resposta que não vem.
      if (job.attemptsMade + 1 < QUEUE_REGISTRY[QUEUE.medicalExam].attempts) throw error;
      await this.finish(job.data, 'FAILED', null, null);
      await this.reply(job.data.userId, `exam-failed-${job.data.examId}`, FAILED_MESSAGE);
      this.logger.warn(
        {
          event: 'medical_exam_failed',
          userId: job.data.userId,
          err: error instanceof Error ? error.message : 'erro desconhecido',
        },
        'análise de exame falhou',
      );
      return 'FAILED';
    }
  }

  private async analyze({ examId, userId }: MedicalExamJob): Promise<string> {
    const [exam] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          mediaType: medicalExams.mediaType,
          file: medicalExams.file,
          status: medicalExams.status,
        })
        .from(medicalExams)
        .where(and(eq(medicalExams.id, examId), eq(medicalExams.userId, userId))),
    );
    if (!exam || exam.status !== 'RECEIVED') return 'SKIPPED';

    const base64 = (await this.cipher.decryptBytes(exam.file)).toString('base64');
    const isPdf = exam.mediaType === 'application/pdf';
    const reading = (
      await this.runner.run(
        readExamTask,
        { fileKind: isPdf ? ('PDF' as const) : ('PHOTO' as const) },
        {
          userId,
          sources: this.sources(userId),
          images: [
            isPdf
              ? { type: 'document', mediaType: 'application/pdf', base64, fileName: 'exame.pdf' }
              : {
                  type: 'image',
                  mediaType: exam.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
                  base64,
                },
          ],
        },
      )
    ).output;

    if (!reading.isExam || reading.values.length === 0) {
      await this.finish({ examId, userId }, 'NOT_EXAM', reading, null);
      await this.reply(
        userId,
        `exam-done-${examId}`,
        reading.isExam ? ILLEGIBLE_MESSAGE : NOT_EXAM_MESSAGE,
      );
      return 'NOT_EXAM';
    }

    const comment = (
      await this.runner.run(
        commentExamTask,
        { examType: reading.examType, examDate: reading.examDate, values: reading.values },
        { userId, sources: this.sources(userId) },
      )
    ).output;
    const needsDoctor = comment.urgency !== 'ROUTINE' || comment.attentionPoints.length > 0;
    await this.finish({ examId, userId }, 'COMMENTED', reading, comment, needsDoctor);
    await this.reply(
      userId,
      `exam-done-${examId}`,
      [comment.message, needsDoctor ? seekDoctorMessage(comment.specialties) : DISCLAIMER].join(
        WHATSAPP_BUBBLE_SEPARATOR,
      ),
    );
    this.logger.info(
      { event: 'medical_exam_commented', userId, urgency: comment.urgency },
      'exame comentado',
    );
    return 'COMMENTED';
  }

  /** Grava leitura e comentário; com comentário, vira contexto de saúde e, se preciso, caso CRM. */
  private async finish(
    { examId, userId }: MedicalExamJob,
    status: 'COMMENTED' | 'NOT_EXAM' | 'FAILED',
    reading: ExamReading | null,
    comment: ExamComment | null,
    needsDoctor = false,
  ): Promise<void> {
    const encode = async (value: unknown) =>
      value ? await this.cipher.encryptHealth(JSON.stringify(value)) : null;
    const readingBytes = await encode(reading);
    const commentBytes = await encode(comment);
    const summary = comment
      ? await this.cipher.encryptHealth(
          JSON.stringify({
            summary: comment.contextSummary,
            ...(reading?.examDate ? { onDate: reading.examDate } : {}),
          }),
        )
      : null;
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      let exceptionCaseId: string | null = null;
      if (comment && needsDoctor) {
        exceptionCaseId = await this.pipeline.openCase(tx, {
          userId,
          kind: 'MEDICAL_EXAM',
          domain: 'MEDICAL',
          priority: comment.urgency === 'URGENT' ? 'URGENT' : 'NORMAL',
          summary: [
            comment.contextSummary,
            comment.specialties.length > 0
              ? `Especialidade sugerida ao aluno: ${comment.specialties.join(', ')}.`
              : null,
            'Leitura e comentário completos na ficha do aluno (Exames).',
          ]
            .filter(Boolean)
            .join(' '),
          subject: { examId },
        });
      }
      await tx
        .update(medicalExams)
        .set({ status, reading: readingBytes, comment: commentBytes, exceptionCaseId })
        .where(eq(medicalExams.id, examId));
      if (summary) {
        await tx.insert(studentHealthRecords).values({
          userId,
          kind: 'EXAM',
          payload: summary,
          origin: 'OBSERVED',
        });
      }
    });
  }

  private sources(userId: string): AgentContextSources {
    return {
      methodology: async () => ({ text: '', versions: {} }),
      state: (slices) => this.state.read(userId, slices),
    };
  }

  private async reply(userId: string, dedupeId: string, text: string): Promise<void> {
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'medical-exam',
      { userId, type: 'CONVERSATION_MESSAGE', dedupeId, text },
      { jobId: dedupeId },
    );
  }
}
