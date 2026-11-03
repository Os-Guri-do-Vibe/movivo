/**
 * `AnamnesisService` — anamnese em 9 etapas (cadastro novo) e anamnese complementar (aluno que
 * já existia completa o que falta), salvas etapa a etapa.
 *
 * Invariantes:
 *  - **Token é credencial de dado de saúde**: CSPRNG de 256 bits, prazo de validade, nunca
 *    aceita `user_id`/`sessionId` do cliente (IDOR — ADR-006).
 *  - **Cadastro só fecha com o número provado** e com os consentimentos obrigatórios aceitos.
 *  - **18+ é regra de servidor**, com a mensagem exata do fundador.
 *  - **Saúde e texto livre só cifrados** (`sensitive`, `HealthCipherService`), com o
 *    consentimento de saúde **reavaliado a cada etapa** (cobre revogação no meio do funil).
 *    O conteúdo sensível nunca volta ao cliente — a UI só sabe QUAIS etapas foram salvas.
 *  - **PAR-Q é trava, não flag**: avaliado de forma determinística no envio; resposta de
 *    risco vira sinal de segurança, que suspende a autonomia até a equipe avaliar.
 *  - **O envio projeta tudo no Estado do Aluno e grava `OnboardingCompleted` na mesma
 *    transação** — a estratégia e o plano nascem do evento, nunca do formulário.
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
  attributionInputSchema,
  normalizeAttribution,
  type AnamnesisAnswersView,
  type AttributionInput,
  CONSENT_TEXTS,
  MIN_AGE_YEARS,
  ONBOARDING_STEP_SCHEMAS,
  onboardingStep1Schema,
  REQUIRED_ONBOARDING_STEPS,
  UNDER_AGE_MESSAGE,
  type ConsentTypeWithText,
  type OnboardingFlow,
  type OnboardingOutcome,
  type OnboardingStepNumber,
  type ParqState as ParqStateType,
  type StartAnamnesisInput,
} from '@movivo/shared';
import { PinoLogger } from 'nestjs-pino';
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { ZodType } from 'zod';

import { HealthCipherService, TenantDatabase, type TenantTransaction } from '../../core/database';
import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  ANAMNESIS_PHOTO_PATH_PREFIX,
  anamnesisSessionPhotos,
  anamnesisSessions,
  bodyPhotos,
  consents,
  users,
} from '../../core/database/schema';
import { strictSafeParse } from '../../core/validation/strict-input';
import { SafetyService } from '../coaching/safety/safety.service';
import { signalOf } from '../coaching/safety/sentinel-rules';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import {
  OnboardingProjection,
  type OnboardingAnswers,
} from '../student-state/onboarding-projection';
import { BodyPhotoService } from './body-photo.service';
import { ConsentService } from './consent.service';
import { legacyPrefill, withModalityVenues, withSessionsWithinDays } from './legacy-prefill';
import { evaluateParq } from './parq';
import { PhoneVerificationService, type SendCodeResult } from './phone-verification.service';

/** Validade do link do cadastro novo. */
const SESSION_TTL_MS = 72 * 60 * 60 * 1000;
/** Validade do link da anamnese complementar (aluno já ativo, sem pressa de funil). */
const COMPLEMENTARY_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Chave de bloco de cada etapa. */
const ANAMNESIS_STEP_TITLES: Readonly<Record<OnboardingStepNumber, string>> = {
  1: 'Cadastro',
  2: 'Objetivos',
  3: 'Modalidades',
  4: 'Rotina',
  5: 'Preferências de treino e saúde geral',
  6: 'Dores e limitações',
  7: 'Alimentação',
  8: 'Corpo',
  9: 'PAR-Q',
};

const BLOCK_KEY: Readonly<Record<OnboardingStepNumber, string>> = {
  1: 'registration',
  2: 'goals',
  3: 'modalities',
  4: 'routine',
  5: 'preferences',
  6: 'pain',
  7: 'nutrition',
  8: 'body',
  9: 'parq',
};

/** Campos de cada etapa que são sensíveis (saúde ou texto livre) — vão só para o cifrado. */
const SENSITIVE_FIELDS: Readonly<Partial<Record<OnboardingStepNumber, readonly string[] | 'ALL'>>> =
  {
    2: ['motivation'],
    5: [
      'trainingPreferences',
      'dislikedExercises',
      'conditions',
      'medications',
      'professionalGuidance',
    ],
    6: 'ALL',
    7: ['allergies', 'supplementOther', 'likedFoods', 'dislikedFoods'],
    9: 'ALL',
  };

/**
 * Textos opcionais sem pergunta-porta. A parte sensível nunca volta ao navegador, então ao
 * reenviar uma etapa retomada o campo vem vazio: omitido mantém o salvo, `""` apaga.
 */
const KEPT_WHEN_OMITTED: Readonly<Partial<Record<OnboardingStepNumber, readonly string[]>>> = {
  2: ['motivation'],
  7: ['likedFoods', 'dislikedFoods'],
};

export function mergeSensitive(
  step: OnboardingStepNumber,
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...next };
  for (const field of KEPT_WHEN_OMITTED[step] ?? []) {
    if (!(field in merged) && previous?.[field] !== undefined) merged[field] = previous[field];
    if (merged[field] === '') delete merged[field];
  }
  return merged;
}

export interface StartResult {
  token: string;
  expiresAt: Date;
  currentStep: number;
}

/** Item de consentimento que a etapa de cadastro renderiza — texto vem do backend. */
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
  flow: OnboardingFlow;
  currentStep: number;
  completedSteps: number[];
  phoneVerified: boolean;
  primaryGoal: string | null;
  /** Consentimentos a exibir, na ordem definida pelo jurídico. Nunca pré-marcados. */
  consents: ConsentItemView[];
  /**
   * Só na anamnese complementar: os textos vigentes ainda não foram aceitos nesta sessão. O
   * aluno que já existia aceitou versões anteriores; a v2 do serviço exige novo aceite.
   */
  consentsPending: boolean;
  /** Consentimento próprio das fotos do corpo (mostrado só a quem decide enviar fotos). */
  bodyPhotosConsent: ConsentItemView;
  /** O aluno já aceitou o texto vigente do consentimento das fotos nesta sessão. */
  bodyPhotosConsentAccepted: boolean;
  /** Posições que já têm foto enviada (o conteúdo nunca volta ao cliente). */
  photos: string[];
  /** Parte COMUM de cada etapa salva (ou pré-preenchida). Nunca a parte sensível. */
  blocks: Record<string, unknown>;
  outcome: OnboardingOutcome | null;
  expiresAt: Date;
}

export interface SubmitResult {
  status: 'SUBMITTED';
  /** Único sinal clínico que a UI recebe. */
  outcome: OnboardingOutcome;
}

/** Fotos do corpo (etapa do corpo) e ciclo menstrual (WhatsApp) têm consentimento próprio, fora do cadastro. */
const CONSENT_ORDER = (Object.keys(CONSENT_TEXTS) as ConsentTypeWithText[]).filter(
  (type) => type !== 'BODY_PHOTOS' && type !== 'MENSTRUAL_CYCLE',
);

function parseStep(step: OnboardingStepNumber, data: unknown): Record<string, unknown> {
  const schema = ONBOARDING_STEP_SCHEMAS[step] as unknown as ZodType<Record<string, unknown>>;
  const parsed = strictSafeParse(schema, data);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((issue) => issue.message));
  }
  return parsed.data as Record<string, unknown>;
}

/** Separa a etapa em parte comum e parte sensível. */
export function splitStep(step: OnboardingStepNumber, data: Record<string, unknown>) {
  const sensitive = SENSITIVE_FIELDS[step];
  if (sensitive === 'ALL') return { common: null, sensitive: data };
  if (!sensitive) return { common: data, sensitive: null };
  const common: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    (sensitive.includes(key) ? secret : common)[key] = value;
  }
  return { common, sensitive: secret };
}

type SessionRow = typeof anamnesisSessions.$inferSelect;

@Injectable()
export class AnamnesisService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consents: ConsentService,
    private readonly healthConsent: HealthConsentService,
    private readonly queues: QueueManager,
    private readonly phone: PhoneVerificationService,
    private readonly projection: OnboardingProjection,
    private readonly safety: SafetyService,
    private readonly events: DomainEventRecorder,
    private readonly outbox: OutboxRelay,
    private readonly photos: BodyPhotoService,
  ) {
    this.logger.setContext(AnamnesisService.name);
  }

  /** `POST /anamnesis/start`: cria sessão anônima com token CSPRNG. */
  async start(input: StartAnamnesisInput): Promise<StartResult> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const sessionId = await this.db.runAsToken(async (tx) => {
      const [created] = await tx
        .insert(anamnesisSessions)
        .values({
          token,
          primaryGoal: input.primaryGoal ?? null,
          selectedPlan: input.planId,
          expiresAt,
        })
        .returning({ id: anamnesisSessions.id });
      if (!created) throw new Error('Falha ao criar sessão de anamnese.');
      return created.id;
    }, token);
    await this.recordFirstTouch(sessionId, input.attribution);
    return { token, expiresAt, currentStep: 1 };
  }

  /**
   * Anamnese complementar de quem já é aluno: pré-preenche a parte comum a partir da anamnese
   * antiga e devolve o token do link. Chamado pela campanha de corte (sistema), nunca pelo aluno.
   */
  async startComplementary(userId: string): Promise<StartResult> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + COMPLEMENTARY_TTL_MS);
    await this.db.runAsSystem(async (tx) => {
      const [previous] = await tx
        .select({
          dataBlock1: anamnesisSessions.dataBlock1,
          dataBlock3: anamnesisSessions.dataBlock3,
        })
        .from(anamnesisSessions)
        .where(
          and(
            eq(anamnesisSessions.userId, userId),
            eq(anamnesisSessions.status, 'SUBMITTED'),
            // Só a anamnese antiga (3 etapas) tem os blocos legados; uma sessão de 9 etapas
            // enviada depois não serve de base ao pré-preenchimento.
            isNotNull(anamnesisSessions.dataBlock3),
          ),
        )
        .orderBy(desc(anamnesisSessions.submittedAt))
        .limit(1);
      await tx.insert(anamnesisSessions).values({
        token,
        userId,
        flow: 'COMPLEMENTARY',
        blocks: previous ? legacyPrefill(previous.dataBlock1, previous.dataBlock3) : {},
        lastStep: 2,
        expiresAt,
      });
    });
    return { token, expiresAt, currentStep: 2 };
  }

  /** Atribuição de primeiro toque — escrita única, nunca derruba o cadastro. */
  async recordFirstTouch(sessionId: string, input: AttributionInput | undefined): Promise<void> {
    const attribution = normalizeAttribution(attributionInputSchema.parse(input ?? {}));
    try {
      await this.db.runAsTokenScoped(sessionId, async (tx) => {
        await tx
          .update(anamnesisSessions)
          .set({ ...attribution, firstTouchAt: new Date() })
          .where(and(eq(anamnesisSessions.id, sessionId), isNull(anamnesisSessions.firstTouchAt)));
      });
    } catch (err: unknown) {
      this.logger.warn({ err, anamnesisSessionId: sessionId }, 'first touch não registrado');
    }
  }

  /** `GET /anamnesis/session/{token}`: retomada da sessão. */
  async getByToken(token: string): Promise<SessionView> {
    const row = await this.lookup(token);
    if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');
    if (this.isExpired(row.status, row.expiresAt)) {
      await this.expire(row);
      throw new GoneException('Sessão de anamnese expirada. Recomece o formulário.');
    }
    return this.toView(row, {
      consentsPending: await this.consentsPending(row),
      bodyPhotosConsentAccepted: await this.consents.hasValidSessionConsent(row.id, 'BODY_PHOTOS'),
      photos: await this.photos.anglesOf(row.id),
    });
  }

  /** Complementar: faltam aceites obrigatórios, na versão vigente, nesta sessão. */
  private async consentsPending(row: SessionRow): Promise<boolean> {
    if (row.flow !== 'COMPLEMENTARY') return false;
    return (await this.missingRequiredConsents(row)).length > 0;
  }

  private async missingRequiredConsents(row: SessionRow): Promise<ConsentTypeWithText[]> {
    const accepted = [
      ...(await this.consents.acceptedTypesForSession(row.id)),
      ...(row.userId ? await this.consents.acceptedTypesForUser(row.userId) : []),
    ];
    return CONSENT_ORDER.filter((type) => CONSENT_TEXTS[type].required && !accepted.includes(type));
  }

  // --- Verificação do número (cadastro novo) ------------------------------------------------

  async sendPhoneCode(token: string, phoneNumber: string): Promise<SendCodeResult> {
    return this.phone.sendCode(await this.requireActiveSession(token), phoneNumber);
  }

  async verifyPhoneCode(token: string, code: string): Promise<{ phoneVerified: true }> {
    await this.phone.verify(await this.requireActiveSession(token), code);
    return { phoneVerified: true };
  }

  // --- Etapas -------------------------------------------------------------------------------

  /** `PATCH /anamnesis/session/{token}/step/{n}`: valida, separa, cifra e salva a etapa. */
  async patchStep(
    token: string,
    step: OnboardingStepNumber,
    data: unknown,
  ): Promise<{ currentStep: number }> {
    const initial = await this.requireActiveSession(token);
    if (step === 1 && initial.flow === 'COMPLEMENTARY') {
      throw new BadRequestException('O cadastro já existe: comece pela etapa de objetivos.');
    }
    // Consentimento primeiro: sem base legal nem o formato da resposta é avaliado.
    if (step !== 1) await this.assertHealthConsent(initial);
    const payload = parseStep(step, data);
    if (step === 1) await this.assertRegistration(initial, payload);

    return this.inSession(initial, async (tx) => {
      const [row] = await tx
        .select()
        .from(anamnesisSessions)
        .where(and(eq(anamnesisSessions.id, initial.id), eq(anamnesisSessions.token, token)))
        .limit(1)
        .for('update');
      if (!row) throw new ConflictException('Esta sessão de anamnese não está disponível.');
      this.assertActive(row);

      const { common, sensitive } = splitStep(step, payload);
      const key = BLOCK_KEY[step];
      const blocks = { ...row.blocks };
      if (common) blocks[key] = common;
      else delete blocks[key];
      const secret = await this.readSensitive(row.sensitive);
      if (sensitive) {
        secret[key] = mergeSensitive(
          step,
          secret[key] as Record<string, unknown> | undefined,
          sensitive,
        );
      }
      const completedSteps = [...new Set([...row.completedSteps, step])].sort((a, b) => a - b);
      const currentStep = Math.min(Math.max(row.lastStep, step + 1), 9);

      const [updated] = await tx
        .update(anamnesisSessions)
        .set({
          blocks,
          sensitive: sensitive
            ? await this.cipher.encryptHealth(JSON.stringify(secret))
            : row.sensitive,
          completedSteps,
          lastStep: currentStep,
        })
        .where(
          and(
            eq(anamnesisSessions.id, row.id),
            eq(anamnesisSessions.status, 'IN_PROGRESS'),
            sql`${anamnesisSessions.expiresAt} > clock_timestamp()`,
          ),
        )
        .returning({ id: anamnesisSessions.id });
      if (!updated) throw new GoneException('Sessão de anamnese expirada.');
      return { currentStep };
    });
  }

  /** Cadastro: 18+ antes de tudo, consentimentos obrigatórios e número provado. */
  private async assertRegistration(row: SessionRow, payload: Record<string, unknown>) {
    const registration = onboardingStep1Schema.parse(payload);
    if (ageInYears(registration.birthDate) < MIN_AGE_YEARS) {
      throw new UnprocessableEntityException(UNDER_AGE_MESSAGE);
    }
    const missing = await this.missingRequiredConsents(row);
    if (missing.length > 0) {
      throw new ForbiddenException(`Consentimentos obrigatórios pendentes: ${missing.join(', ')}.`);
    }
    if (!row.phoneVerifiedAt || row.phoneE164 !== registration.phoneNumber) {
      throw new ForbiddenException('Confirme o código enviado no WhatsApp antes de continuar.');
    }
  }

  /**
   * `POST /anamnesis/session/{token}/submit`: avalia o PAR-Q, cria o titular (cadastro novo),
   * projeta tudo no Estado do Aluno e grava `OnboardingCompleted` — numa transação só.
   */
  async submit(token: string): Promise<SubmitResult> {
    const initial = await this.requireActiveSession(token);
    await this.assertHealthConsent(initial);
    const flow = initial.flow as OnboardingFlow;
    if (flow === 'COMPLEMENTARY') {
      const missing = await this.missingRequiredConsents(initial);
      if (missing.length > 0) {
        throw new ForbiddenException(
          `Consentimentos obrigatórios pendentes: ${missing.join(', ')}.`,
        );
      }
    }

    const { userId, gate } = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .select()
        .from(anamnesisSessions)
        .where(and(eq(anamnesisSessions.id, initial.id), eq(anamnesisSessions.token, token)))
        .limit(1)
        .for('update');
      if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');
      this.assertActive(row);
      const missing = REQUIRED_ONBOARDING_STEPS[flow].filter(
        (step) => !row.completedSteps.includes(step),
      );
      if (missing.length > 0) {
        throw new BadRequestException(`Complete as etapas ${missing.join(', ')} antes de enviar.`);
      }
      const answers = await this.answersOf(row);
      if (ageInYears(answers.registration.birthDate) < MIN_AGE_YEARS) {
        throw new UnprocessableEntityException(UNDER_AGE_MESSAGE);
      }
      if (flow === 'INITIAL' && !row.phoneVerifiedAt) {
        throw new ForbiddenException('Confirme o código enviado no WhatsApp antes de continuar.');
      }

      const gate = evaluateParq({ parq: answers.parq.parq });
      const userId =
        flow === 'INITIAL'
          ? await this.createUser(tx, answers, gate.requiresProfessionalReview)
          : (row.userId as string);
      const submittedAt = new Date();
      await tx
        .update(anamnesisSessions)
        .set({ userId, status: 'SUBMITTED', parqState: gate.parqState, submittedAt })
        .where(eq(anamnesisSessions.id, row.id));

      const today = submittedAt.toISOString().slice(0, 10);
      await this.projection.project(tx, userId, answers, today);
      await this.adoptPhotos(tx, row.id, userId, today);
      if (gate.requiresProfessionalReview) {
        await this.safety.raiseIn(
          tx,
          userId,
          [signalOf('PARQ_POSITIVE', 'PAR-Q com resposta de risco na anamnese', null)],
          'RULE',
        );
      }
      await this.events.record(tx, {
        userId,
        type: 'OnboardingCompleted',
        payload: { anamnesisSessionId: row.id, flow },
      });
      return { userId, gate };
    });

    await this.consents.linkSessionToUser(initial.id, userId);
    if (flow === 'INITIAL') {
      await this.queues.enqueue(
        QUEUE.whatsappOutbound,
        'confirmation',
        { userId, type: gate.requiresProfessionalReview ? 'CONFIRMATION_CARE' : 'CONFIRMATION' },
        { jobId: `confirmation_${userId}` },
      );
      await this.queues.enqueue(
        QUEUE.conversionSequence,
        'trial-start',
        { userId, plan: initial.selectedPlan },
        { jobId: `trial-start_${userId}` },
      );
    }
    await this.outbox.flushSoon();
    this.logger.info(
      { event: 'form_submitted', anamnesisSessionId: initial.id, flow, parqState: gate.parqState },
      'form_submitted',
    );
    return { status: 'SUBMITTED', outcome: this.toOutcome(gate.parqState) };
  }

  /**
   * As fotos do corpo enviadas na anamnese passam a ser do titular: a linha ganha o `user_id`
   * e entra na galeria de evolução (`body_photos`), presa ao consentimento próprio das fotos.
   */
  private async adoptPhotos(
    tx: TenantTransaction,
    sessionId: string,
    userId: string,
    takenOn: string,
  ): Promise<void> {
    const photos = await tx
      .select({ id: anamnesisSessionPhotos.id, angle: anamnesisSessionPhotos.angle })
      .from(anamnesisSessionPhotos)
      .where(eq(anamnesisSessionPhotos.anamnesisSessionId, sessionId));
    if (photos.length === 0) return;
    const [consent] = await tx
      .select({ id: consents.id })
      .from(consents)
      .where(
        and(
          eq(consents.anamnesisSessionId, sessionId),
          eq(consents.consentType, 'BODY_PHOTOS'),
          eq(consents.accepted, true),
          isNull(consents.revokedAt),
        ),
      )
      .limit(1);
    if (!consent) {
      // Sem consentimento vigente a foto não pode ficar: nunca deveria chegar aqui.
      await tx
        .delete(anamnesisSessionPhotos)
        .where(eq(anamnesisSessionPhotos.anamnesisSessionId, sessionId));
      return;
    }
    await tx
      .update(anamnesisSessionPhotos)
      .set({ userId })
      .where(eq(anamnesisSessionPhotos.anamnesisSessionId, sessionId));
    await tx.insert(bodyPhotos).values(
      photos.map((photo) => ({
        userId,
        angle: photo.angle,
        takenOn,
        storagePath: `${ANAMNESIS_PHOTO_PATH_PREFIX}${photo.id}`,
        consentId: consent.id,
      })),
    );
  }

  /** Expurgo de sessões vencidas sem envio: a parte sensível é descartada. */
  async purgeExpiredSessions(): Promise<number> {
    return this.db.runAsSystem(async (tx) => {
      const purged = (await tx
        .update(anamnesisSessions)
        .set({ status: 'EXPIRED', dataBlock2: null, sensitive: null })
        .where(
          and(
            eq(anamnesisSessions.status, 'IN_PROGRESS'),
            lt(anamnesisSessions.expiresAt, new Date()),
          ),
        )
        .returning({ id: anamnesisSessions.id })) as Array<{ id: string }>;
      if (purged.length > 0) {
        await tx.delete(anamnesisSessionPhotos).where(
          inArray(
            anamnesisSessionPhotos.anamnesisSessionId,
            purged.map((session) => session.id),
          ),
        );
      }
      return purged.length;
    });
  }

  // --- helpers ------------------------------------------------------------------------------

  private toOutcome(parqState: ParqStateType | null): OnboardingOutcome {
    return parqState === 'LIBERADO' ? 'READY' : 'PENDING_REVIEW';
  }

  /**
   * Sessão pelo token. A do cadastro novo é órfã (sem titular) e só aparece sob o GUC do token;
   * a complementar já tem titular e é lida pelo sistema — o token de 256 bits é a credencial.
   */
  private async lookup(token: string): Promise<SessionRow | undefined> {
    const anonymous = await this.db.runAsToken(
      async (tx) =>
        (
          await tx
            .select()
            .from(anamnesisSessions)
            .where(eq(anamnesisSessions.token, token))
            .limit(1)
        )[0],
      token,
    );
    if (anonymous) return anonymous;
    const [complementary] = await this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(anamnesisSessions)
        .where(and(eq(anamnesisSessions.token, token), eq(anamnesisSessions.flow, 'COMPLEMENTARY')))
        .limit(1),
    );
    return complementary;
  }

  private async requireActiveSession(token: string): Promise<SessionRow> {
    const row = await this.lookup(token);
    if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');
    this.assertActive(row);
    return row;
  }

  /** Transação no escopo certo: anônima pelo id da sessão, complementar como o próprio aluno. */
  private inSession<T>(row: SessionRow, cb: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return row.flow === 'COMPLEMENTARY' && row.userId
      ? this.db.runAsUser(row.userId, 'USER', cb)
      : this.db.runAsTokenScoped(row.id, cb);
  }

  /** Consentimento de saúde reavaliado no momento da coleta (cobre revogação no meio). */
  private async assertHealthConsent(row: SessionRow): Promise<void> {
    // Complementar: vale o aceite vigente do titular ou o que acabou de ser dado nesta sessão.
    const valid =
      (row.flow === 'COMPLEMENTARY' &&
        row.userId !== null &&
        (await this.healthConsent.hasActiveForUser(row.userId))) ||
      (await this.consents.hasValidHealthConsent(row.id));
    if (!valid) {
      throw new ForbiddenException('Consentimento de saúde é obrigatório antes desta etapa.');
    }
  }

  private async readSensitive(ciphertext: Buffer | null): Promise<Record<string, unknown>> {
    if (!ciphertext) return {};
    return JSON.parse(await this.cipher.decryptHealth(ciphertext)) as Record<string, unknown>;
  }

  /** Junta parte comum e sensível de cada etapa e revalida contra os contratos. */
  private async answersOf(row: SessionRow): Promise<OnboardingAnswers> {
    const secret = await this.readSensitive(row.sensitive);
    const merged = (step: OnboardingStepNumber) => {
      const key = BLOCK_KEY[step];
      return {
        ...(row.blocks[key] as Record<string, unknown> | undefined),
        ...(secret[key] as Record<string, unknown> | undefined),
      };
    };
    return {
      registration: ONBOARDING_STEP_SCHEMAS[1].parse(merged(1)),
      goals: ONBOARDING_STEP_SCHEMAS[2].parse(merged(2)),
      modalities: ONBOARDING_STEP_SCHEMAS[3].parse(withModalityVenues(merged(3))),
      routine: ONBOARDING_STEP_SCHEMAS[4].parse(withSessionsWithinDays(merged(4))),
      preferences: ONBOARDING_STEP_SCHEMAS[5].parse(merged(5)),
      pain: ONBOARDING_STEP_SCHEMAS[6].parse(merged(6)),
      nutrition: ONBOARDING_STEP_SCHEMAS[7].parse(merged(7)),
      body: row.completedSteps.includes(8) ? ONBOARDING_STEP_SCHEMAS[8].parse(merged(8)) : null,
      parq: ONBOARDING_STEP_SCHEMAS[9].parse(merged(9)),
    };
  }

  /**
   * Respostas da anamnese enviada mais recente do aluno, para o profissional que revisa o
   * protocolo. Etapa que o fluxo não pede (cadastro, na complementar) ou que não passa mais no
   * contrato atual fica de fora em vez de derrubar a tela. A leitura é auditada por quem chama.
   */
  async submittedAnswersOf(userId: string): Promise<AnamnesisAnswersView | null> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(anamnesisSessions)
        .where(and(eq(anamnesisSessions.userId, userId), eq(anamnesisSessions.status, 'SUBMITTED')))
        .orderBy(desc(anamnesisSessions.submittedAt))
        .limit(1),
    );
    if (!row) return null;
    const secret = await this.readSensitive(row.sensitive);
    const steps: AnamnesisAnswersView['steps'] = [];
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      const key = BLOCK_KEY[step];
      const merged = {
        ...(row.blocks[key] as Record<string, unknown> | undefined),
        ...(secret[key] as Record<string, unknown> | undefined),
      };
      if (Object.keys(merged).length === 0) continue;
      const parsed = ONBOARDING_STEP_SCHEMAS[step].safeParse(
        step === 3
          ? withModalityVenues(merged)
          : step === 4
            ? withSessionsWithinDays(merged)
            : merged,
      );
      // Etapa que não passa mais no contrato atual aparece como foi respondida.
      const data = (parsed.success ? parsed.data : merged) as Record<string, unknown>;
      steps.push({ step, title: ANAMNESIS_STEP_TITLES[step], data });
    }
    return {
      submittedAt: row.submittedAt?.toISOString() ?? null,
      flow: row.flow as AnamnesisAnswersView['flow'],
      steps,
    };
  }

  private isExpired(status: string, expiresAt: Date): boolean {
    return status === 'EXPIRED' || expiresAt.getTime() <= Date.now();
  }

  private assertActive(row: SessionRow): void {
    if (this.isExpired(row.status, row.expiresAt)) {
      // Expira em background (best-effort): a resposta ao cliente é o 410.
      this.expire(row).catch((err: unknown) => {
        this.logger.warn({ err, anamnesisSessionId: row.id }, 'expire best-effort falhou');
      });
      throw new GoneException('Sessão de anamnese expirada. Recomece o formulário.');
    }
    if (row.status !== 'IN_PROGRESS') {
      throw new ConflictException('Esta sessão de anamnese já foi enviada.');
    }
  }

  private async expire(row: SessionRow): Promise<void> {
    // As fotos do corpo vão junto com a sessão vencida (o contexto anônimo não apaga).
    await this.db.runAsSystem((tx) =>
      tx
        .delete(anamnesisSessionPhotos)
        .where(eq(anamnesisSessionPhotos.anamnesisSessionId, row.id)),
    );
    await this.inSession(row, async (tx) => {
      await tx
        .update(anamnesisSessions)
        .set({ status: 'EXPIRED', dataBlock2: null, sensitive: null })
        .where(
          and(
            eq(anamnesisSessions.id, row.id),
            eq(anamnesisSessions.status, 'IN_PROGRESS'),
            sql`${anamnesisSessions.expiresAt} <= clock_timestamp()`,
          ),
        );
    });
  }

  private async createUser(
    tx: TenantTransaction,
    answers: OnboardingAnswers,
    requiresProfessionalReview: boolean,
  ): Promise<string> {
    const { registration } = answers;
    try {
      const [created] = await tx
        .insert(users)
        .values({
          name: registration.name,
          phoneNumber: registration.phoneNumber,
          email: registration.email ?? null,
          // Decide qual persona publicada atende o titular (`AgentPersonaService`).
          biologicalSex: registration.biologicalSex,
          status: 'ONBOARDING',
          requiresProfessionalReview,
        })
        .returning({ id: users.id });
      if (!created) throw new Error('Falha ao criar usuário no envio da anamnese.');
      return created.id;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Já existe um cadastro com este telefone ou e-mail.');
      }
      throw error;
    }
  }

  private toView(
    row: SessionRow,
    extra: { consentsPending: boolean; bodyPhotosConsentAccepted: boolean; photos: string[] } = {
      consentsPending: false,
      bodyPhotosConsentAccepted: false,
      photos: [],
    },
  ): SessionView {
    const consentItem = (type: ConsentTypeWithText): ConsentItemView => ({
      type,
      version: CONSENT_TEXTS[type].version,
      title: CONSENT_TEXTS[type].title,
      body: CONSENT_TEXTS[type].body,
      label: CONSENT_TEXTS[type].label,
      required: CONSENT_TEXTS[type].required,
    });
    return {
      status: row.status,
      flow: row.flow as OnboardingFlow,
      currentStep: row.lastStep,
      completedSteps: row.completedSteps,
      phoneVerified: row.phoneVerifiedAt != null,
      primaryGoal: row.primaryGoal,
      consents: CONSENT_ORDER.map(consentItem),
      consentsPending: extra.consentsPending,
      bodyPhotosConsent: consentItem('BODY_PHOTOS'),
      bodyPhotosConsentAccepted: extra.bodyPhotosConsentAccepted,
      photos: extra.photos,
      blocks: row.blocks,
      outcome: row.parqState ? this.toOutcome(row.parqState as ParqStateType) : null,
      expiresAt: row.expiresAt,
    };
  }
}

/** Violação de unicidade (23505) em qualquer profundidade de `.cause` (o drizzle embrulha). */
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (depth > 5 || typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return 'cause' in error ? isUniqueViolation(error.cause, depth + 1) : false;
}
