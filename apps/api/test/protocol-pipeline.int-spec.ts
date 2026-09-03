/**
 * Integração do pipeline de geração de protocolo (US-2.4) contra o stack Docker.
 *
 * Prova, com I/O real (Postgres via PgBouncer + Redis via Sentinel), com um **fake do
 * `ProtocolGeneratorService`** (sem rede/sem chave de LLM) e o `ValidationService` REAL:
 *   (feliz)      submit → job → geração(fake) → validação limpa → `protocols`
 *                AUTO_APPROVED/ACTIVE assinado (RT) sob RLS → entrega enfileirada;
 *   (validador)  usuário com lesão que contraindica o exercício gerado → BLOCK → template
 *                → PENDING_REVIEW, sem entrega;
 *   (PAR-Q)      sessão de risco (`requires_professional_review`) → GERA em modo
 *                conservador como `MANDATORY`, ligada à sessão, sem auto-liberação
 *                agendada, e as três camadas que impedem a entrega automática;
 *   (idempotência) reprocessar o mesmo job não cria protocolo duplicado;
 *   (DLQ)        geração que falha além dos retries → mensagem de espera + template pendente.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CONSENT_TEXTS,
  PARQ_DECLARATIONS,
  PARQ_DECLARATIONS_VERSION,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  REQUIRED_CONSENT_TYPES,
  type ProtocolStructure,
} from '@movivo/shared';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { anamnesisSessions, protocols, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { AnamnesisService } from '../src/modules/anamnesis/anamnesis.service';
import { ConsentService } from '../src/modules/anamnesis/consent.service';
import { QUEUE } from '../src/modules/jobs/jobs.config';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import type {
  GenerateProtocolCommand,
  GenerateProtocolResult,
} from '../src/modules/protocol/protocol-generator.service';
import { ProtocolGeneratorService } from '../src/modules/protocol/protocol-generator.service';
import { ProtocolRepository } from '../src/modules/protocol/protocol.repository';
import { DashboardService } from '../src/modules/admin/dashboard.service';
import { seedHealthEligibility } from './health-fixtures';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const ORIGIN = { ip: '203.0.113.40', userAgent: 'vitest/protocol-pipeline' };

/** Protocolo canônico do fake: usa `agachamento_goblet` (contraindicado p/ KNEE — útil no bloqueio). */
function fakeStructure(goal: ProtocolStructure['goal']): ProtocolStructure {
  return {
    promptVersion: 'methodology-int+catalog-int',
    goal,
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'Dia A',
        focus: 'Corpo inteiro',
        exercises: [
          {
            exerciseId: 'agachamento_goblet',
            name: 'Agachamento goblet',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

/** Fake do gerador: throw se `injuriesRaw` pede DLQ; senão devolve o protocolo canônico. */
const fakeGenerator: Pick<ProtocolGeneratorService, 'generate'> = {
  async generate(command: GenerateProtocolCommand): Promise<GenerateProtocolResult> {
    if (command.constraints.injuriesRaw.some((i) => i.includes('forcar-dlq'))) {
      throw new Error('LLM indisponível (fake DLQ)');
    }
    return {
      structure: fakeStructure(command.constraints.goal),
      provider: 'OPENAI_GPT41',
      model: 'gpt-4.1',
      attempt: 1,
      costBrl: 0.01,
      promptVersion: 'methodology-int+catalog-int',
      unknownExerciseIds: [],
    };
  },
};

let app: INestApplication;
let anamnesis: AnamnesisService;
let consents: ConsentService;
let queues: QueueManager;
let db: TenantDatabase;
let cipher: HealthCipherService;

const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

let seq = 0;
const phone = () => `+5541${RUN}${(seq += 1)}`;

/** Bloco cifrado da anamnese v2: secao 4 + textos livres + PAR-Q + declaracoes. */
function healthBlock(painRegions: string[], riskIds: string[] = [], trigger?: string) {
  return {
    pain:
      painRegions.length > 0 || trigger
        ? {
            hasPain: true,
            trend: 'STABLE',
            // "forcar-dlq" (fake do gerador, linha ~87) precisa de free-text: o schema v2 não
            // aceita mais injuries livres, então o trigger é o único campo que ecoa verbatim
            // em `injuriesRaw` (via `painToConstraints`).
            points:
              painRegions.length > 0
                ? painRegions.map((region) => ({ region, intensity: 6 }))
                : [{ region: 'KNEE', intensity: 1 }],
            ...(trigger ? { trigger } : {}),
            hasProfessionalExplanation: false,
            underMedicalFollowUp: false,
            hasAvoidanceRecommendation: false,
          }
        : { hasPain: false, points: [] },
    freeText: {},
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: riskIds.includes(questionId),
        ...(questionId === 'Q9' && riskIds.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
    declarations: {
      version: PARQ_DECLARATIONS_VERSION,
      accepted: PARQ_DECLARATIONS.map((d) => d.id),
      acceptedAt: new Date().toISOString(),
    },
  };
}

/** Secoes 1/2/3/5 da anamnese v2 (jsonb em claro). */
function structured(over: Record<string, unknown> = {}) {
  return {
    primaryGoal: 'GAIN_MUSCLE',
    emphasis: [],
    hasImportantEvent: false,
    trainingStatus: 'REGULAR',
    experience: 'BEGINNER',
    pastActivities: [],
    consistencyBarriers: [],
    daysPerWeek: 3,
    preferredDays: [],
    sessionDuration: 'M45_TO_60',
    location: 'HOME',
    preferredPeriod: 'MORNING',
    practicesOtherSport: false,
    hasAvoidedExercise: false,
    ...over,
  };
}

/** Roda a anamnese completa pelo serviço real e submete (o submit enfileira o job). */
async function submitAnamnesis(painRegions: string[], riskIds: string[] = []) {
  const { token } = await anamnesis.start({ primaryGoal: 'GAIN_MUSCLE' });
  const phoneNumber = phone();
  await consents.recordForSessionToken(
    token,
    REQUIRED_CONSENT_TYPES.map((type) => ({
      type,
      version: CONSENT_TEXTS[type].version,
      accepted: true,
    })),
    ORIGIN,
  );
  // Este teste e do PIPELINE DE PROTOCOLO, nao do OTP: a posse do numero e carimbada
  // direto (o fluxo do codigo tem cobertura propria em anamnesis.int-spec.ts).
  await adminClient`
    UPDATE anamnesis_sessions SET phone_e164 = ${phoneNumber}, phone_verified_at = now()
      WHERE token = ${token}`;
  await anamnesis.patchStep(token, 1, {
    name: 'Fulano Pipeline',
    birthDate: '1996-04-02',
    biologicalSex: 'MALE',
    heightCm: 178,
    weightKg: 80,
    phoneNumber,
    email: `p${RUN}${seq}@example.com`,
  });
  await anamnesis.patchStep(token, 2, {
    anamnesis: { structured: structured(), freeText: {} },
    pain:
      painRegions.length > 0
        ? {
            hasPain: true,
            trend: 'STABLE',
            points: painRegions.map((region) => ({ region, intensity: 6 })),
            hasProfessionalExplanation: false,
            underMedicalFollowUp: false,
            hasAvoidanceRecommendation: false,
          }
        : { hasPain: false, points: [] },
  });
  await anamnesis.patchStep(token, 3, {
    parq: healthBlock([], riskIds).parq,
    declarationsVersion: PARQ_DECLARATIONS_VERSION,
    declarations: PARQ_DECLARATIONS.map((d) => d.id),
  });
  await anamnesis.submit(token);
  const [row] = await adminClient<Array<{ user_id: string; id: string }>>`
    SELECT user_id, id FROM anamnesis_sessions WHERE token = ${token}`;
  return { userId: row.user_id, sessionId: row.id };
}

/** Cria usuário + sessão SUBMITTED direto no banco (sem auto-enqueue) — para DLQ/idempotência. */
async function seedUser(painRegions: string[], trigger?: string) {
  const userId = await db.runAsSystem(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ phoneNumber: phone(), name: 'Seed', requiresProfessionalReview: false })
      .returning({ id: users.id });
    if (!u) throw new Error('seed: usuário não criado');
    return u.id;
  });
  const sessionId = await db.runAsUser(userId, 'USER', async (tx) => {
    const [s] = await tx
      .insert(anamnesisSessions)
      .values({
        userId,
        token: randomBytes(32).toString('hex'),
        status: 'SUBMITTED',
        submittedAt: new Date(),
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        dataBlock1: {
          name: 'Seed',
          birthDate: '1996-04-02',
          biologicalSex: 'MALE',
          phoneNumber: '+550',
        },
        dataBlock2: await cipher.encryptHealth(
          JSON.stringify(healthBlock(painRegions, [], trigger)),
        ),
        dataBlock3: structured(),
      })
      .returning({ id: anamnesisSessions.id });
    if (!s) throw new Error('seed: sessão não criada');
    return s.id;
  });
  // Titular semeado direto no banco (sem submit): recria o vínculo CREF + consentimento
  // de saúde que o fluxo real teria criado, senão a mensagem de espera é descartada.
  await seedHealthEligibility(adminClient, userId);
  return { userId, sessionId };
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function readProtocol(userId: string) {
  const rows = await db.runAsUser(userId, 'USER', (tx) =>
    tx.select().from(protocols).where(eq(protocols.userId, userId)),
  );
  return rows;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ProtocolGeneratorService)
    .useValue(fakeGenerator)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.enableShutdownHooks();
  await app.init();

  anamnesis = app.get(AnamnesisService);
  consents = app.get(ConsentService);
  queues = app.get(QueueManager);
  db = app.get(TenantDatabase);
  cipher = app.get(HealthCipherService);

  await queues.get(QUEUE.whatsappOutbound).obliterate({ force: true });
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM protocol_versions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM protocols WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM ai_jobs WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM consents WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%')
         OR anamnesis_session_id IN (SELECT id FROM anamnesis_sessions WHERE token LIKE '%${RUN}%');
       DELETE FROM anamnesis_sessions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM professional_assignments WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       ALTER TABLE user_status_transitions DISABLE TRIGGER trg_user_status_transitions_immutable;
       DELETE FROM user_status_transitions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       ALTER TABLE user_status_transitions ENABLE TRIGGER trg_user_status_transitions_immutable;
       -- A assinatura CREF (testes de auditoria) grava em audit_logs, que referencia
       -- users tanto por actor_id quanto por user_id. A tabela é imutável por trigger;
       -- desligá-lo aqui é o mesmo tratamento já dado a user_status_transitions acima, e
       -- vale só para as linhas DESTA execução (prefixo de telefone com o RUN).
       ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable;
       DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%')
         OR actor_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable;
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('pipeline de protocolo — caminho feliz (US-2.4)', () => {
  it('submit → PENDING_REVIEW/OPTIONAL sob RLS + auto-liberação de 1h agendada', async () => {
    const { userId, sessionId } = await submitAnamnesis([]); // sem lesão → validador limpo

    // Decisão do fundador (2026-08-18): PASS limpo NÃO entrega mais sozinho na hora —
    // entra na fila como PENDING_REVIEW/OPTIONAL igual a qualquer outro protocolo. O único
    // motivo pra travar sem prazo (MANDATORY) é PAR-Q, já filtrado antes de chegar aqui.
    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.status).toBe('PENDING_SIGNATURE');
    expect(proto.humanReviewRequired).toBe(true);
    expect(proto.reviewUrgency).toBe('OPTIONAL');
    expect(proto.signatureHash).toBeNull();
    expect(proto.generatedBy).toBe('OPENAI_GPT41');
    expect(proto.modelVersion).toBe('gpt-4.1');
    expect(proto.promptVersion).toBe('methodology-int+catalog-int');

    // Ninguém entrega sozinho na hora: a entrega só existe após o RT assinar ou a janela
    // de cortesia de 1h (`ProtocolAutoReleaseWorker`) liberar.
    const delivery = await queues
      .get(QUEUE.whatsappOutbound)
      .getJob(`protocol-delivery_${userId}_1`);
    expect(delivery).toBeUndefined();

    // A auto-liberação de 1h foi agendada (delay real, não aguardado aqui — é coberta
    // isoladamente pelo spec do `ProtocolAutoReleaseWorker`).
    const autoRelease = await queues
      .get(QUEUE.protocolAutoRelease)
      .getJob(`auto-release-${proto.id}`);
    expect(autoRelease).toBeDefined();
    expect(autoRelease?.opts.delay).toBe(60 * 60 * 1000);

    // Idempotência: reprocessar o mesmo job não cria um segundo protocolo.
    await queues.enqueue(QUEUE.protocolGeneration, 'generate-protocol', {
      userId,
      anamnesisSessionId: sessionId,
      submittedAt: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await readProtocol(userId)).toHaveLength(1);
  }, 40_000);
});

describe('pipeline de protocolo — bloqueado pelo validador (US-2.4)', () => {
  it('lesão contraindica o exercício gerado → template → PENDING_REVIEW, sem entrega', async () => {
    const { userId } = await submitAnamnesis(['KNEE']); // KNEE contraindica agachamento_goblet

    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.status).toBe('PENDING_SIGNATURE');
    expect(proto.humanReviewRequired).toBe(true);
    expect(proto.signatureHash).toBeNull();

    const delivery = await queues
      .get(QUEUE.whatsappOutbound)
      .getJob(`protocol-delivery_${userId}_1`);
    expect(delivery).toBeUndefined();
  }, 40_000);
});

/**
 * PAR-Q bloqueante (2026-08-24) — substitui o antigo "gate PAR-Q", que afirmava
 * `readProtocol(userId)).toHaveLength(0)`.
 *
 * A decisão do fundador inverteu a regra: PAR-Q deixou de TRAVAR a geração e virou
 * **modo conservador + revisão humana obrigatória**. O teste antigo continuou verde no
 * runner unitário (que não toca este arquivo) e vermelho aqui, mas o problema maior é
 * que, enquanto ele afirmava o comportamento revogado, a garantia NOVA — a mais crítica
 * do sistema — não tinha cobertura de integração nenhuma.
 *
 * A garantia, em três camadas independentes, é o que este bloco prova com I/O real:
 *   1. aplicação (worker): `MANDATORY` nunca ENFILEIRA job de auto-liberação;
 *   2. aplicação (repositório): mesmo com o job forçado à mão, `autoRelease()` reconfere
 *      o estado sob `FOR UPDATE` e recusa;
 *   3. banco: a CHECK `protocols_mandatory_never_auto_approved` rejeita o `UPDATE` mesmo
 *      partindo de um superusuário, que é o que sobra quando (1) e (2) falham.
 */
describe('pipeline de protocolo — PAR-Q bloqueante (2026-08-24)', () => {
  let userId: string;
  let sessionId: string;
  let protocolId: string;

  beforeAll(async () => {
    // Q2 = "dor no peito ao se exercitar" → bloqueia o PAR-Q e mapeia para CARDIAC.
    ({ userId, sessionId } = await submitAnamnesis([], ['Q2']));
    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    protocolId = proto.id;
  }, 40_000);

  it('GERA o protocolo (não trava mais), como PENDING_REVIEW/MANDATORY e ligado à sessão', async () => {
    const [proto] = await readProtocol(userId);

    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.status).toBe('PENDING_SIGNATURE');
    expect(proto.humanReviewRequired).toBe(true);
    // A garantia central: nasce MANDATORY, não OPTIONAL.
    expect(proto.reviewUrgency).toBe('MANDATORY');
    expect(proto.signatureHash).toBeNull();
    // Vínculo com a sessão: é por ele que a assinatura acha o PAR-Q certo pra liberar.
    expect(proto.anamnesisSessionId).toBe(sessionId);
  });

  it('aplica o modo conservador: par_q_flags recebe a tag do PAR-Q, não as de lesão', async () => {
    const [proto] = await readProtocol(userId);

    // Regressão do bug corrigido em 2026-08-24: esta coluna recebia `injuryTags`. O
    // titular não declarou dor nenhuma, então qualquer coisa aqui só pode vir do PAR-Q.
    expect(proto.parQFlags).toEqual(['CARDIAC']);
    const constraints = proto.constraints as {
      requiresProfessionalReview: boolean;
      parqTags: string[];
      parqTriggered: string[];
      injuryTags: string[];
    };
    expect(constraints.requiresProfessionalReview).toBe(true);
    expect(constraints.parqTriggered).toEqual(['Q2']);
    // A tag do PAR-Q é mesclada em `injuryTags` de propósito: é o que faz gerador e
    // validador tratarem "CARDIAC vindo do PAR-Q" com a força de uma lesão de verdade.
    expect(constraints.injuryTags).toContain('CARDIAC');
  });

  it('NUNCA agenda job de auto-liberação (camada 1 — o worker nem enfileira)', async () => {
    const autoRelease = await queues
      .get(QUEUE.protocolAutoRelease)
      .getJob(`auto-release-${protocolId}`);
    expect(autoRelease).toBeUndefined();

    // E nada foi entregue: sem assinatura humana, não existe entrega.
    const delivery = await queues
      .get(QUEUE.whatsappOutbound)
      .getJob(`protocol-delivery_${userId}_1`);
    expect(delivery).toBeUndefined();
  });

  it('recusa a liberação mesmo com o job FORÇADO à mão (camada 2 — autoRelease reconfere)', async () => {
    // Força exatamente a corrida que o worker evita: chama o repositório como se o job
    // tivesse sido agendado por engano (bug, replay de fila, script administrativo).
    const repository = app.get(ProtocolRepository);
    const result = await repository.autoRelease(userId, protocolId);

    expect(result.released).toBe(false);

    // E a linha não foi tocada: continua aguardando assinatura humana.
    const [proto] = await readProtocol(userId);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.status).toBe('PENDING_SIGNATURE');
    expect(proto.signedAt).toBeNull();
  });

  it('o banco rejeita um UPDATE que burle a aplicação (camada 3 — CHECK constraint)', async () => {
    // `adminClient` é superusuário: passa por cima de RLS e de toda regra de aplicação.
    // Se a CHECK não existisse, este UPDATE passaria e o protocolo de um titular com
    // alerta clínico ficaria AUTO_APPROVED sem nenhuma assinatura humana.
    await expect(
      adminClient`UPDATE protocols SET approval_status = 'AUTO_APPROVED' WHERE id = ${protocolId}::uuid`,
    ).rejects.toThrow(/protocols_mandatory_never_auto_approved/);

    // A mesma CHECK barra o caminho inverso (virar MANDATORY já estando AUTO_APPROVED).
    await expect(
      adminClient`
        UPDATE protocols SET approval_status = 'AUTO_APPROVED', review_urgency = 'MANDATORY'
        WHERE id = ${protocolId}::uuid`,
    ).rejects.toThrow(/protocols_mandatory_never_auto_approved/);

    const [proto] = await readProtocol(userId);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
  });

  it('mantém o PAR-Q bloqueado enquanto não houver assinatura humana', async () => {
    const [session] = await adminClient<Array<{ parq_state: string }>>`
      SELECT parq_state FROM anamnesis_sessions WHERE id = ${sessionId}::uuid`;
    expect(session.parq_state).toBe('BLOQUEADO_AGUARDANDO_CLEARANCE');

    const [user] = await adminClient<Array<{ requires_professional_review: boolean }>>`
      SELECT requires_professional_review FROM users WHERE id = ${userId}::uuid`;
    expect(user.requires_professional_review).toBe(true);
  });
});

/**
 * Assinatura CREF com I/O real (2026-08-24). Até aqui, `signProtocol` só tinha cobertura
 * UNITÁRIA — com `audit.append` e `tx.execute` mockados. Isso deixava sem prova nenhuma
 * justamente as partes que só existem no banco:
 *   - a função `SECURITY DEFINER` `release_parq_on_signature` (autorização, derivação da
 *     sessão a partir do protocolo, conferência de titular, no-op de estado);
 *   - a **cadeia de hash** de `audit_logs`, que é produzida por trigger `BEFORE INSERT`,
 *     não pela aplicação — um mock de `append` nunca poderia atestá-la;
 *   - a atomicidade dos dois atos (assinar + liberar) na MESMA transação.
 */
describe('assinatura CREF — libera o PAR-Q e deixa trilha auditável (2026-08-24)', () => {
  let dashboard: DashboardService;
  let admin: { userId: string; role: 'ADMIN'; jti: string };

  beforeAll(async () => {
    dashboard = app.get(DashboardService);
    const [row] = await adminClient<Array<{ id: string }>>`
      INSERT INTO users (phone_number, name, role)
      VALUES (${phone()}, 'Admin Assinatura', 'ADMIN') RETURNING id`;
    admin = { userId: row.id, role: 'ADMIN', jti: 'int-sign' };
  }, 30_000);

  /** Eventos de auditoria do titular, em ordem, com os campos da cadeia. */
  async function auditTrail(ownerId: string) {
    return adminClient<
      Array<{
        id: string;
        action: string;
        entity_type: string;
        entity_id: string;
        row_hash: string;
        previous_hash: string | null;
      }>
    >`SELECT id, action, entity_type, entity_id, row_hash, previous_hash
        FROM audit_logs WHERE user_id = ${ownerId}::uuid ORDER BY id ASC`;
  }

  it('protocolo com PAR-Q bloqueado: assina, libera o PAR-Q e grava DOIS eventos distintos', async () => {
    const { userId: owner, sessionId: session } = await submitAnamnesis([], ['Q2']);
    const proto = await waitFor(async () => (await readProtocol(owner))[0]);
    expect(proto.reviewUrgency).toBe('MANDATORY');

    await dashboard.signProtocol(admin, proto.id, { confirmation: true });

    // (a) o protocolo foi assinado por HUMANO — nunca AUTO_APPROVED.
    const [signedRow] = await readProtocol(owner);
    expect(signedRow.status).toBe('ACTIVE');
    expect(signedRow.approvalStatus).toBe('HUMAN_APPROVED');
    expect(signedRow.professionalId).toBe(admin.userId);
    expect(signedRow.signatureHash).not.toBeNull();

    // (b) o PAR-Q foi liberado na MESMA transação, com o estado de ressalva do RT.
    const [sessionRow] = await adminClient<Array<{ parq_state: string }>>`
      SELECT parq_state FROM anamnesis_sessions WHERE id = ${session}::uuid`;
    expect(sessionRow.parq_state).toBe('LIBERADO_COM_RESSALVA_RT');
    const [userRow] = await adminClient<Array<{ requires_professional_review: boolean }>>`
      SELECT requires_professional_review FROM users WHERE id = ${owner}::uuid`;
    expect(userRow.requires_professional_review).toBe(false);

    // (c) DOIS eventos distintos, cada um no seu entityType.
    const trail = await auditTrail(owner);
    const signedEvent = trail.filter((e) => e.action === 'PROTOCOL_SIGNED');
    const releasedEvent = trail.filter((e) => e.action === 'PARQ_RELEASED_BY_HUMAN');
    expect(signedEvent).toHaveLength(1);
    expect(releasedEvent).toHaveLength(1);
    expect(signedEvent[0].entity_type).toBe('protocol');
    expect(signedEvent[0].entity_id).toBe(proto.id);
    expect(releasedEvent[0].entity_type).toBe('anamnesis_session');
    expect(releasedEvent[0].entity_id).toBe(session);
  }, 60_000);

  it('a cadeia de hash da trilha continua íntegra após os dois eventos', async () => {
    // A cadeia é GLOBAL (o trigger encadeia com a última linha da tabela, não por
    // titular), então a integridade se verifica na tabela inteira: cada linha tem de
    // apontar para o `row_hash` da anterior.
    const chain = await adminClient<
      Array<{ id: string; row_hash: string; previous_hash: string | null }>
    >`
      SELECT id, row_hash, previous_hash FROM audit_logs ORDER BY id ASC`;
    expect(chain.length).toBeGreaterThan(1);

    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].previous_hash).toBe(chain[i - 1].row_hash);
    }
    // E nenhum hash ficou com o placeholder que a aplicação envia antes do trigger.
    for (const row of chain) {
      expect(row.row_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 30_000);

  it('protocolo SEM PAR-Q bloqueado: assina e grava só PROTOCOL_SIGNED', async () => {
    const { userId: owner } = await submitAnamnesis([]); // PAR-Q limpo → OPTIONAL
    const proto = await waitFor(async () => (await readProtocol(owner))[0]);
    expect(proto.reviewUrgency).toBe('OPTIONAL');

    await dashboard.signProtocol(admin, proto.id, { confirmation: true });

    const trail = await auditTrail(owner);
    const actions = trail.map((e) => e.action);
    expect(actions).toContain('PROTOCOL_SIGNED');
    // O no-op de `release_parq_on_signature` não pode virar evento de liberação.
    expect(actions).not.toContain('PARQ_RELEASED_BY_HUMAN');
  }, 60_000);
});

describe('pipeline de protocolo — DLQ e fallback (US-2.4)', () => {
  it('falha terminal → template pendente de revisão, sem reagendar a apresentação da agente', async () => {
    const { userId, sessionId } = await seedUser([], 'forcar-dlq');
    await queues.enqueue(
      QUEUE.protocolGeneration,
      'generate-protocol',
      { userId, anamnesisSessionId: sessionId, submittedAt: new Date().toISOString() },
      { attempts: 1 },
    );

    // Fallback: template pendente de revisão persistido (task manual — painel Sprint 5).
    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.humanReviewRequired).toBe(true);
    expect(proto.generatedBy).toBe('FALLBACK_TEMPLATE');

    // A mensagem "estou analisando" é agendada no SUBMIT do formulário (30min depois
    // dele), não aqui: este caminho não enfileira nada de outbound. Este job foi
    // enfileirado direto na fila de geração, sem passar pelo submit — logo não existe.
    expect(
      await queues.get(QUEUE.whatsappOutbound).getJob(`protocol-waiting_${userId}`),
    ).toBeFalsy();
  }, 40_000);
});
