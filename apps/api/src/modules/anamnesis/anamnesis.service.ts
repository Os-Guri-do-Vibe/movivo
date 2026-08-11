/**
 * `AnamnesisService` — onboarding v2 em 3 etapas (Sprint 6, US-6.3 a US-6.9).
 *
 * Sessão anônima acessada por token opaco até o submit. Invariantes que este serviço
 * protege (as mesmas da v1, agora sobre o wizard de 3 etapas):
 *  - **Token é credencial de dado de saúde**: CSPRNG de 256 bits, 72h de validade,
 *    nunca aceita `user_id`/`sessionId` do cliente (IDOR — Sato §8.1, ADR-006).
 *  - **Etapa 1 só fecha com o número provado** (US-6.5) e com os 3 consentimentos
 *    obrigatórios aceitos — o número é o identificador funcional do produto.
 *  - **18+ é regra de negócio validada no SERVIDOR**, com a mensagem exata do fundador.
 *    Validação de cliente é UX, não controle.
 *  - **Saúde no bloco cifrado**: seção 4 + PAR-Q + todo texto livre em `data_block_2`
 *    (`bytea`, `HealthCipherService`), gated por `HEALTH_DATA` **reavaliado no momento
 *    da coleta** (Alexandre §5.8, regra nova 4 — cobre revogação no meio do funil).
 *  - **Gate PAR-Q é trava, não flag**: `evaluateParq` determinístico no submit.
 *  - **A UI não deriva estado clínico**: o submit devolve `outcome` (READY |
 *    PENDING_REVIEW) e mais nada. Nunca as respostas, nunca o motivo (Sofia §9.2/§9.3).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  ageInYears,
  anamnesisStructuredSchema,
  CONSENT_TEXTS,
  MIN_AGE_YEARS,
  onboardingStep1Schema,
  onboardingStep2Schema,
  onboardingStep3Schema,
  PARQ_DECLARATIONS_VERSION,
  REQUIRED_CONSENT_TYPES,
  UNDER_AGE_MESSAGE,
  type ConsentTypeWithText,
  type OnboardingOutcome,
  type OnboardingStep1,
  type ParqState as ParqStateType,
  type StartAnamnesisInput,
} from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { and, eq, lt, sql } from 'drizzle-orm';

import { HealthCipherService, TenantDatabase, type TenantTransaction } from '../../core/database';
import { anamnesisSessions, users } from '../../core/database/schema';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { ConsentService } from './consent.service';
import { healthBlockSchema, isHealthBlockComplete, type HealthBlock } from './health-block';
import { evaluateParq } from './parq';
import { PhoneVerificationService, type SendCodeResult } from './phone-verification.service';

/** Janela de validade do link de retomada (Rafael §5 / Sofia §1.4). */
const SESSION_TTL_MS = 72 * 60 * 60 * 1000;

/** Etapas aceitas pelo `PATCH .../step/{n}`. */
export type StepNumber = 1 | 2 | 3;

export interface StartResult {
  token: string;
  expiresAt: Date;
  currentStep: number;
}

/** Item de consentimento que a Etapa 1 renderiza — texto vem do backend (Sofia §2.3). */
export interface ConsentItemView {
  type: ConsentTypeWithText;
  version: string;
  title: string | null;
  body: readonly string[];
  label: string;
  required: boolean;
}

export interface SessionView {
  status: string;
  currentStep: number;
  phoneVerified: boolean;
  primaryGoal: string | null;
  /** Consentimentos a exibir, na ordem definida por Alexandre. Nunca pré-marcados. */
  consents: ConsentItemView[];
  step1: unknown;
  /** Etapa 2, seções 1/2/3/5 (dado comum). */
  step2: unknown;
  /**
   * Saúde: só se foi preenchida, NUNCA o conteúdo. Devolver a seção 4 ou o PAR-Q ao
   * cliente convidaria a exibi-los, e exibi-los se aproxima de devolutiva clínica.
   */
  healthCompleted: boolean;
  parqCompleted: boolean;
  outcome: OnboardingOutcome | null;
  expiresAt: Date;
}

export interface SubmitResult {
  status: 'SUBMITTED';
  /** Único sinal que a UI recebe para escolher a tela V1/V2 (Sofia §9.2). */
  outcome: OnboardingOutcome;
}

/** Ordem de exibição da Etapa 1 = ordem das chaves de `CONSENT_TEXTS` (Alexandre §5.8). */
const CONSENT_ORDER = Object.keys(CONSENT_TEXTS) as ConsentTypeWithText[];

@Injectable()
export class AnamnesisService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consents: ConsentService,
    private readonly queues: QueueManager,
    private readonly phone: PhoneVerificationService,
  ) {
    // O `PinoLogger` simples é o provider GLOBAL do LoggerModule (Sprint 0). Setar o
    // contexto aqui evita o `@InjectPinoLogger(nome)`, cujo token nomeado
    // (`PinoLogger:AnamnesisService`) o nestjs-pino não expõe fora do módulo que o
    // registra — o que fazia o AppModule inteiro falhar no boot.
    this.logger.setContext(AnamnesisService.name);
  }

  /** `POST /anamnesis/start`: cria sessão anônima com token CSPRNG e TTL de 72h. */
  async start(input: StartAnamnesisInput): Promise<StartResult> {
    const token = randomBytes(32).toString('hex'); // 256 bits, exatamente 64 chars
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.db.runAsToken(async (tx) => {
      await tx.insert(anamnesisSessions).values({
        token,
        primaryGoal: input.primaryGoal ?? null,
        expiresAt,
      });
    });

    return { token, expiresAt, currentStep: 1 };
  }

  /** `GET /anamnesis/session/{token}`: alimenta a retomada e os consentimentos da UI. */
  async getByToken(token: string): Promise<SessionView> {
    const row = await this.db.runAsToken((tx) => this.selectByToken(tx, token));
    if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');

    if (this.isExpired(row.status, row.expiresAt)) {
      await this.expire(row.id);
      return this.toView({ ...row, status: 'EXPIRED', dataBlock2: null });
    }
    return this.toView(row);
  }

  // --- Etapa 1: verificação do número (US-6.5) ------------------------------

  /** `POST /anamnesis/session/{token}/phone/send-code`. */
  async sendPhoneCode(token: string, phoneNumber: string): Promise<SendCodeResult> {
    const row = await this.requireActiveSession(token);
    return this.phone.sendCode(row, phoneNumber);
  }

  /** `POST /anamnesis/session/{token}/phone/verify`. */
  async verifyPhoneCode(token: string, code: string): Promise<{ phoneVerified: true }> {
    const row = await this.requireActiveSession(token);
    await this.phone.verify(row, code);
    return { phoneVerified: true };
  }

  // --- Etapas 1..3 ----------------------------------------------------------

  /**
   * `PATCH /anamnesis/session/{token}/step/{n}`: salva a etapa e avança o progresso.
   *
   * Substitui o `PATCH .../block/{n}` da v1, que saiu do produto (D1). O escopo é
   * sempre o token: nenhum `user_id` do cliente é aceito em ponto algum.
   */
  async patchStep(
    token: string,
    step: StepNumber,
    data: unknown,
  ): Promise<{ currentStep: number }> {
    const row = await this.requireActiveSession(token);

    switch (step) {
      case 1:
        await this.saveStep1(row, data);
        break;
      case 2:
        await this.saveStep2(row, data);
        break;
      case 3:
        await this.saveStep3(row, data);
        break;
    }

    const currentStep = Math.min(Math.max(row.lastStep, step + 1), 3);
    await this.db.runAsTokenScoped(row.id, async (tx) => {
      await tx
        .update(anamnesisSessions)
        .set({ lastStep: currentStep })
        .where(eq(anamnesisSessions.id, row.id));
    });
    return { currentStep };
  }

  /**
   * Etapa 1 — cadastro + gate 18+ + consentimentos + posse do número.
   *
   * As três travas são de servidor. A ordem importa: recusamos o menor de 18 **antes**
   * de olhar consentimento, para não registrar aceite de quem não pode contratar.
   */
  private async saveStep1(row: SessionRow, data: unknown): Promise<void> {
    const step1 = onboardingStep1Schema.parse(data);

    if (ageInYears(step1.birthDate) < MIN_AGE_YEARS) {
      // 422 e não 400: a requisição está bem formada; o que não se aceita é a pessoa
      // menor de 18 (art. 14 LGPD + decisão de negócio). Mensagem EXATA do fundador.
      throw new UnprocessableEntityException(UNDER_AGE_MESSAGE);
    }

    const missing = await this.missingRequiredConsents(row.id);
    if (missing.length > 0) {
      throw new ForbiddenException(`Consentimentos obrigatórios pendentes: ${missing.join(', ')}.`);
    }

    if (!row.phoneVerifiedAt || row.phoneE164 !== step1.phoneNumber) {
      throw new ForbiddenException('Confirme o código enviado no WhatsApp antes de continuar.');
    }

    await this.writeJsonb(row.id, 'data_block_1', step1);
  }

  /** Etapa 2 — seções 1/2/3/5 em claro; seção 4 + textos livres no bloco cifrado. */
  private async saveStep2(row: SessionRow, data: unknown): Promise<void> {
    const { anamnesis, pain } = onboardingStep2Schema.parse(data);
    await this.assertHealthConsent(row.id);

    await this.writeJsonb(row.id, 'data_block_3', anamnesis.structured);
    await this.mergeHealthBlock(row.id, { pain, freeText: anamnesis.freeText });
  }

  /** Etapa 3 — PAR-Q reusado sem alteração + as 3 declarações finais. */
  private async saveStep3(row: SessionRow, data: unknown): Promise<void> {
    const step3 = onboardingStep3Schema.parse(data);
    await this.assertHealthConsent(row.id);

    await this.mergeHealthBlock(row.id, {
      parq: step3.parq,
      declarations: {
        version: PARQ_DECLARATIONS_VERSION,
        accepted: step3.declarations,
        acceptedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * `POST /anamnesis/session/{token}/submit`: avalia o PAR-Q, cria o `users`,
   * vincula a sessão e migra os consentimentos. Devolve só o `outcome`.
   */
  async submit(token: string): Promise<SubmitResult> {
    const row = await this.requireActiveSession(token);

    if (!row.dataBlock1 || !row.dataBlock2 || !row.dataBlock3) {
      throw new BadRequestException('Complete as três etapas antes de enviar.');
    }
    if (!row.phoneVerifiedAt) {
      throw new ForbiddenException('Confirme o código enviado no WhatsApp antes de continuar.');
    }
    await this.assertHealthConsent(row.id);

    // Revalida contra os contratos: o dado veio do banco, mas validar é barato e
    // protege de linha corrompida/migração parcial.
    const step1 = onboardingStep1Schema.parse(row.dataBlock1);
    if (ageInYears(step1.birthDate) < MIN_AGE_YEARS) {
      throw new UnprocessableEntityException(UNDER_AGE_MESSAGE);
    }
    anamnesisStructuredSchema.parse(row.dataBlock3);

    const health = await this.readHealthBlock(row.dataBlock2);
    if (!isHealthBlockComplete(health) || !health.parq) {
      throw new BadRequestException('Complete as três etapas antes de enviar.');
    }

    const gate = evaluateParq({ parq: health.parq });

    const userId = await this.db.runAsSystem(async (tx) => {
      const created = await this.createUser(tx, step1, gate.requiresProfessionalReview);
      // Conta unica do MVP, mas com vinculo explicito. A funcao falha se nao houver
      // exatamente um RT CREF ativo, evitando titular orfao ou acesso profissional global.
      await tx.execute(sql`SELECT assign_unique_active_professional(${created}::uuid)`);
      await tx
        .update(anamnesisSessions)
        .set({
          userId: created,
          status: 'SUBMITTED',
          parqState: gate.parqState,
          submittedAt: new Date(),
        })
        .where(eq(anamnesisSessions.id, row.id));
      return created;
    });

    // Migra os consentimentos da fase anônima para o titular (preserva a prova).
    await this.consents.linkSessionToUser(row.id, userId);

    // US-2.4 — gatilho do pipeline de protocolo. Enfileira SEMPRE (202/rápido): o gate
    // PAR-Q é aplicado no Worker (sessão de risco não gera — trava de negócio). Payload
    // só com UUIDs — o dado de saúde é carregado sob RLS pelo Worker, nunca no job.
    await this.queues.enqueue(QUEUE.protocolGeneration, 'generate-protocol', {
      userId,
      anamnesisSessionId: row.id,
      submittedAt: new Date().toISOString(),
      correlationId: row.id,
    });

    // US-2.5 — confirmação imediata no WhatsApp. Variante de cuidado quando o PAR-Q trava
    // (não promete plano automático). jobId idempotente; telefone é lido sob RLS no worker.
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'confirmation',
      { userId, type: gate.requiresProfessionalReview ? 'CONFIRMATION_CARE' : 'CONFIRMATION' },
      { jobId: `confirmation_${userId}` },
    );

    // US-4.3 — inicia o trial (7 dias) e agenda a sequência de conversão (dias 7/10/13/14).
    await this.queues.enqueue(
      QUEUE.conversionSequence,
      'trial-start',
      { userId },
      { jobId: `trial-start_${userId}` },
    );

    // `form_submitted` — evento de funil. Sem PII: só o id da sessão (UUID) e o estado.
    this.logger.info(
      { event: 'form_submitted', anamnesisSessionId: row.id, parqState: gate.parqState },
      'form_submitted',
    );

    return { status: 'SUBMITTED', outcome: this.toOutcome(gate.parqState) };
  }

  /**
   * Expurgo de sessões `IN_PROGRESS` expiradas (minimização LGPD): status→EXPIRED e
   * `data_block_2` descartado. Gancho para o job agendado da US-1.7 (BullMQ). Roda
   * como SYSTEM (varre todas as sessões, sem contexto de titular).
   * ponytail: varredura simples por índice `idx_anamnesis_sessions_expires_at`;
   * paginar se o volume crescer.
   */
  async purgeExpiredSessions(): Promise<number> {
    return this.db.runAsSystem(async (tx) => {
      const purged = (await tx
        .update(anamnesisSessions)
        .set({ status: 'EXPIRED', dataBlock2: null })
        .where(
          and(
            eq(anamnesisSessions.status, 'IN_PROGRESS'),
            lt(anamnesisSessions.expiresAt, new Date()),
          ),
        )
        .returning({ id: anamnesisSessions.id })) as Array<{ id: string }>;
      return purged.length;
    });
  }

  // --- helpers -------------------------------------------------------------

  /** Estado clínico interno → o que a UI pode saber (Sofia §9.2). */
  private toOutcome(parqState: ParqStateType | null): OnboardingOutcome {
    return parqState === 'LIBERADO' ? 'READY' : 'PENDING_REVIEW';
  }

  private async requireActiveSession(token: string): Promise<SessionRow> {
    const row = await this.db.runAsToken((tx) => this.selectByToken(tx, token));
    if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');
    this.assertActive(row.id, row.status, row.expiresAt);
    return row;
  }

  /**
   * Reavalia o consentimento de saúde **no momento da coleta**, e não uma vez na
   * Etapa 1 (Alexandre §5.8, regra nova 4): se o titular revogar entre a Etapa 1 e a
   * 2, a coleta é recusada mesmo com a Etapa 1 já concluída.
   */
  private async assertHealthConsent(sessionId: string): Promise<void> {
    if (!(await this.consents.hasValidHealthConsent(sessionId))) {
      throw new ForbiddenException('Consentimento de saúde é obrigatório antes desta etapa.');
    }
  }

  private async missingRequiredConsents(sessionId: string): Promise<ConsentTypeWithText[]> {
    const accepted = await this.consents.acceptedTypesForSession(sessionId);
    return REQUIRED_CONSENT_TYPES.filter((type) => !accepted.includes(type));
  }

  private async writeJsonb(sessionId: string, column: string, value: unknown): Promise<void> {
    await this.db.runAsTokenScoped(sessionId, async (tx) => {
      await tx.execute(
        sql`UPDATE anamnesis_sessions
            SET ${sql.identifier(column)} = ${sql`${JSON.stringify(value)}::jsonb`},
                updated_at = now()
            WHERE id = ${sessionId}`,
      );
    });
  }

  private async readHealthBlock(ciphertext: Buffer | null): Promise<HealthBlock> {
    if (!ciphertext) return {};
    const json = await this.cipher.decryptHealth(ciphertext);
    return healthBlockSchema.parse(JSON.parse(json));
  }

  /**
   * Escreve o bloco de saúde fundindo com o que já existe. O bloco é preenchido em
   * duas etapas (seção 4 na 2, PAR-Q na 3) — sobrescrever perderia metade dele.
   */
  private async mergeHealthBlock(sessionId: string, patch: HealthBlock): Promise<void> {
    const current = await this.db.runAsTokenScoped(sessionId, async (tx) => {
      const [row] = await tx
        .select({ dataBlock2: anamnesisSessions.dataBlock2 })
        .from(anamnesisSessions)
        .where(eq(anamnesisSessions.id, sessionId))
        .limit(1);
      return row?.dataBlock2 ?? null;
    });

    const merged = { ...(await this.readHealthBlock(current)), ...patch };
    const encrypted = await this.cipher.encryptHealth(JSON.stringify(merged));

    await this.db.runAsTokenScoped(sessionId, async (tx) => {
      await tx
        .update(anamnesisSessions)
        .set({ dataBlock2: encrypted })
        .where(eq(anamnesisSessions.id, sessionId));
    });
  }

  private async selectByToken(tx: TenantTransaction, token: string) {
    const [row] = await tx
      .select()
      .from(anamnesisSessions)
      .where(eq(anamnesisSessions.token, token))
      .limit(1);
    return row;
  }

  private isExpired(status: string, expiresAt: Date): boolean {
    return status === 'IN_PROGRESS' && expiresAt.getTime() < Date.now();
  }

  private assertActive(id: string, status: string, expiresAt: Date): void {
    if (this.isExpired(status, expiresAt)) {
      // Expira em background (best-effort): a resposta ao cliente é o 410, não
      // dependemos do carimbo EXPIRED. O `.catch` é obrigatório — sem ele, uma
      // falha do update vira unhandled rejection (e, sob teardown de teste, derruba
      // o worker do vitest). Se falhar, o próximo acesso reavalia e tenta de novo.
      this.expire(id).catch((err: unknown) => {
        this.logger.warn({ err, anamnesisSessionId: id }, 'expire best-effort falhou');
      });
      throw new GoneException('Sessão de anamnese expirada. Recomece o formulário.');
    }
    if (status !== 'IN_PROGRESS') {
      throw new ConflictException('Esta sessão de anamnese já foi enviada.');
    }
  }

  private async expire(id: string): Promise<void> {
    await this.db.runAsTokenScoped(id, async (tx) => {
      await tx
        .update(anamnesisSessions)
        .set({ status: 'EXPIRED', dataBlock2: null })
        .where(and(eq(anamnesisSessions.id, id), eq(anamnesisSessions.status, 'IN_PROGRESS')));
    });
  }

  private async createUser(
    tx: TenantTransaction,
    step1: OnboardingStep1,
    requiresProfessionalReview: boolean,
  ): Promise<string> {
    try {
      const [created] = await tx
        .insert(users)
        .values({
          name: step1.name,
          phoneNumber: step1.phoneNumber,
          email: step1.email ?? null,
          status: 'ONBOARDING',
          requiresProfessionalReview,
        })
        .returning({ id: users.id });
      if (!created) throw new Error('Falha ao criar usuário no submit da anamnese.');
      return created.id;
    } catch (error) {
      // 23505 = unique_violation (telefone/e-mail já cadastrado).
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new ConflictException('Já existe um cadastro com este telefone ou e-mail.');
      }
      throw error;
    }
  }

  private toView(row: SessionRow): SessionView {
    return {
      status: row.status,
      currentStep: row.lastStep,
      phoneVerified: row.phoneVerifiedAt != null,
      primaryGoal: row.primaryGoal,
      consents: CONSENT_ORDER.map((type) => ({
        type,
        version: CONSENT_TEXTS[type].version,
        title: CONSENT_TEXTS[type].title,
        body: CONSENT_TEXTS[type].body,
        label: CONSENT_TEXTS[type].label,
        required: CONSENT_TEXTS[type].required,
      })),
      step1: row.dataBlock1 ?? null,
      step2: row.dataBlock3 ?? null,
      healthCompleted: row.dataBlock2 != null,
      parqCompleted: row.parqState != null,
      outcome: row.parqState ? this.toOutcome(row.parqState as ParqStateType) : null,
      expiresAt: row.expiresAt,
    };
  }
}

type SessionRow = typeof anamnesisSessions.$inferSelect;
