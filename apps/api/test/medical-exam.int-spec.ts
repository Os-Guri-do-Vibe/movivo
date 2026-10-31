/**
 * Integração — exame recebido no WhatsApp. Pré-requisito: `pnpm run infra:up`, com o contêiner
 * `movivo-api` parado. O modelo é falso; o que se prova com Postgres real: arquivo cifrado em
 * repouso, leitura e comentário gravados cifrados, contexto de saúde (EXAM) para os agentes,
 * caso MEDICAL_EXAM no domínio do médico e a mensagem cautelosa ao aluno.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ExamComment, ExamReading } from '@movivo/shared';

import { AppModule } from '../src/app.module';
import { AgentRunner } from '../src/core/agents/agent-runner';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import {
  domainEvents,
  exceptionCases,
  medicalExams,
  studentHealthRecords,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import {
  examFileOf,
  examViewOf,
  MedicalExamService,
  type MedicalExamJob,
} from '../src/modules/medical/medical-exam.service';
import { createStudent } from './plan-fixtures';

const PDF = Buffer.from('%PDF-1.4 TSH 7,8 mUI/L (0,4 a 4,5)');
const reading: ExamReading = {
  isExam: true,
  examType: 'Exames de sangue',
  examDate: '2026-10-20',
  legibility: 'GOOD',
  values: [{ name: 'TSH', value: '7,8', unit: 'mUI/L', referenceRange: '0,4 a 4,5', flag: 'HIGH' }],
};
const comment: ExamComment = {
  message: 'O TSH veio acima da referência do laboratório. Vale levar a uma consulta médica.',
  attentionPoints: [{ marker: 'TSH', status: 'HIGH', note: 'Acima da referência.' }],
  specialties: ['Endocrinologia'],
  urgency: 'SOON',
  contextSummary: 'Exame de 10/2026: TSH acima da referência.',
};

let app: INestApplication;
let db: TenantDatabase;
let exams: MedicalExamService;
let enqueue: ReturnType<typeof vi.fn>;
let nextReading: ExamReading = reading;
const created: string[] = [];

beforeAll(async () => {
  const runner = {
    run: async (task: { id: string }) => ({
      output: task.id === 'medical.read_exam' ? nextReading : comment,
      modelRunIds: [],
      correctionRounds: 0,
      stateVersion: 0,
      methodologyVersions: {},
      costBrl: 0,
      promptVersion: 'test',
    }),
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AgentRunner)
    .useValue(runner)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  exams = app.get(MedicalExamService);
  enqueue = vi.spyOn(app.get(QueueManager), 'enqueue').mockResolvedValue('job') as never;
});

afterAll(async () => {
  if (db && created.length > 0) {
    await db.runAsSystem(async (tx) => {
      await tx.delete(exceptionCases).where(inArray(exceptionCases.userId, created));
      await tx.delete(domainEvents).where(inArray(domainEvents.userId, created));
      await tx.delete(users).where(inArray(users.id, created));
    });
  }
  await app?.close();
});

async function receiveAndProcess(userId: string): Promise<{ examId: string; result: string }> {
  enqueue.mockClear();
  expect(
    await exams.receive({ userId, messageKey: 'k1', mediaType: 'application/pdf', bytes: PDF }),
  ).toBe(true);
  const job = enqueue.mock.calls.find(([queue]) => queue === 'medical-exam')?.[2] as MedicalExamJob;
  const result = await exams.process({ data: job, attemptsMade: 0 } as Job<MedicalExamJob>);
  return { examId: job.examId, result };
}

describe('exame recebido no WhatsApp', () => {
  it('cifra o arquivo, comenta com cautela, alimenta o contexto e abre caso para o médico', async () => {
    const userId = await createStudent(db, created);
    nextReading = reading;
    const { examId, result } = await receiveAndProcess(userId);
    expect(result).toBe('COMMENTED');

    const [row] = await db.runAsSystem((tx) =>
      tx.select().from(medicalExams).where(eq(medicalExams.id, examId)),
    );
    expect(row?.status).toBe('COMMENTED');
    expect(row?.file.includes(Buffer.from('TSH'))).toBe(false);
    expect(row?.reading?.includes(Buffer.from('TSH'))).toBe(false);

    const cipher = app.get(HealthCipherService);
    const view = await db.runAsSystem((tx) => examViewOf(tx, cipher, examId));
    expect(view?.reading?.values[0]?.name).toBe('TSH');
    expect(view?.comment?.specialties).toEqual(['Endocrinologia']);
    const file = await db.runAsSystem((tx) => examFileOf(tx, cipher, examId));
    expect(Buffer.from(file?.base64 ?? '', 'base64').equals(PDF)).toBe(true);

    const [exception] = await db.runAsSystem((tx) =>
      tx
        .select()
        .from(exceptionCases)
        .where(eq(exceptionCases.id, row?.exceptionCaseId ?? '')),
    );
    expect(exception).toMatchObject({ kind: 'MEDICAL_EXAM', domain: 'MEDICAL' });
    expect(exception?.subject).toEqual({ examId });

    const records = await db.runAsSystem((tx) =>
      tx.select().from(studentHealthRecords).where(eq(studentHealthRecords.userId, userId)),
    );
    expect(records.map((r) => r.kind)).toContain('EXAM');

    const texts = enqueue.mock.calls.map(([, , data]) => String((data as { text?: string }).text));
    expect(texts.some((t) => t.includes(comment.message) && t.includes('não substitui'))).toBe(
      true,
    );
  });

  it('arquivo que não é exame: responde, não comenta e não abre caso', async () => {
    const userId = await createStudent(db, created);
    nextReading = { ...reading, isExam: false, values: [] };
    const { examId, result } = await receiveAndProcess(userId);
    expect(result).toBe('NOT_EXAM');
    const [row] = await db.runAsSystem((tx) =>
      tx.select().from(medicalExams).where(eq(medicalExams.id, examId)),
    );
    expect(row?.exceptionCaseId).toBeNull();
    expect(row?.comment).toBeNull();
  });
});
