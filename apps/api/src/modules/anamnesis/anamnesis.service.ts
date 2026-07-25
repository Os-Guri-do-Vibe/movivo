/**
 * `AnamnesisService` (FormSessionService — US-1.3).
 *
 * Sessão de anamnese em 3 blocos, anônima e acessada por token opaco até o submit.
 * Invariantes que este serviço protege:
 *  - **Token é credencial de dado de saúde**: CSPRNG de 256 bits, 72h de validade,
 *    nunca aceita `user_id`/`sessionId` do cliente (IDOR — Sato §8.1).
 *  - **Bloco 2 é dado sensível** (LGPD Art. 11): cifrado em repouso (`bytea`) e
 *    **barrado sem consentimento de saúde** (BLOQUEADOR 3 de Alexandre).
 *  - **Gate PAR-Q é trava, não flag**: avaliação determinística no submit (`evaluateParq`).
 *  - **Escrita escopada por sessão** (Sato — achado 1): mutações rodam em
 *    `runAsTokenScoped`, a RLS isola a linha órfã por sessão.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import {
  anamnesisBlock1Schema,
  anamnesisBlock2Schema,
  anamnesisBlock3Schema,
  type AnamnesisBlock1,
  type AnamnesisBlock2,
  type ParqState as ParqStateType,
  type StartAnamnesisInput,
} from '@movivo/shared';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { and, eq, lt, sql } from 'drizzle-orm';

import { HealthCipherService, TenantDatabase, type TenantTransaction } from '../../core/database';
import { anamnesisSessions, users } from '../../core/database/schema';
import { ConsentService } from './consent.service';
import { evaluateParq } from './parq';

/** Janela de validade do link de retomada (Rafael §5 / Sofia §8.3). */
const SESSION_TTL_MS = 72 * 60 * 60 * 1000;

/** Blocos aceitos pelo PATCH. */
export type BlockNumber = 1 | 2 | 3;

export interface StartResult {
  token: string;
  expiresAt: Date;
  lastBlock: number;
}

export interface SessionView {
  status: string;
  lastBlock: number;
  primaryGoal: string | null;
  parqState: ParqStateType | null;
  block1: unknown;
  /** Bloco 2 é saúde: não retorna o conteúdo (minimização), só se foi preenchido. */
  block2Completed: boolean;
  block3: unknown;
  expiresAt: Date;
}

export interface SubmitResult {
  status: 'SUBMITTED';
  parqState: ParqStateType;
  requiresProfessionalReview: boolean;
}

@Injectable()
export class AnamnesisService {
  constructor(
    @InjectPinoLogger(AnamnesisService.name) private readonly logger: PinoLogger,
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consents: ConsentService,
  ) {}

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

    return { token, expiresAt, lastBlock: 1 };
  }

  /** `GET /anamnesis/session/{token}`: retoma no `last_block`. Expira em voo se preciso. */
  async getByToken(token: string): Promise<SessionView> {
    const row = await this.db.runAsToken((tx) => this.selectByToken(tx, token));
    if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');

    if (this.isExpired(row.status, row.expiresAt)) {
      await this.expire(row.id);
      return this.toView({ ...row, status: 'EXPIRED', dataBlock2: null });
    }
    return this.toView(row);
  }

  /**
   * `PATCH /anamnesis/session/{token}/block/{n}`: salva o bloco imediatamente e
   * avança `last_block`. Bloco 2 é cifrado e exige consentimento de saúde.
   */
  async patchBlock(
    token: string,
    n: BlockNumber,
    data: AnamnesisBlock1 | AnamnesisBlock2 | Record<string, unknown>,
  ): Promise<{ lastBlock: number }> {
    const row = await this.db.runAsToken((tx) => this.selectByToken(tx, token));
    if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');
    this.assertActive(row.id, row.status, row.expiresAt);

    // Coluna e valor por bloco. Bloco 2 (saúde) é cifrado; barrado sem consentimento.
    let column: 'data_block_1' | 'data_block_2' | 'data_block_3';
    let value: unknown;
    if (n === 2) {
      if (!(await this.consents.hasValidHealthConsent(row.id))) {
        // BLOQUEADOR 3 (Alexandre): sem consentimento de saúde, nada é persistido.
        throw new ForbiddenException('Consentimento de saúde é obrigatório antes deste bloco.');
      }
      column = 'data_block_2';
      value = await this.cipher.encryptHealth(JSON.stringify(data)); // bytea
    } else {
      column = n === 1 ? 'data_block_1' : 'data_block_3';
      value = sql`${JSON.stringify(data)}::jsonb`;
    }

    const nextBlock = Math.max(row.lastBlock, n);
    await this.db.runAsTokenScoped(row.id, async (tx) => {
      await tx.execute(
        sql`UPDATE anamnesis_sessions
            SET ${sql.identifier(column)} = ${value},
                last_block = ${nextBlock},
                updated_at = now()
            WHERE id = ${row.id}`,
      );
    });

    return { lastBlock: nextBlock };
  }

  /**
   * `POST /anamnesis/session/{token}/submit`: valida os 3 blocos, avalia o PAR-Q,
   * cria o `users` (ONBOARDING), vincula a sessão e migra os consentimentos.
   * NÃO dispara AraraHQ/WhatsApp (Sprint 2).
   */
  async submit(token: string): Promise<SubmitResult> {
    const row = await this.db.runAsToken((tx) => this.selectByToken(tx, token));
    if (!row) throw new NotFoundException('Sessão de anamnese não encontrada.');
    this.assertActive(row.id, row.status, row.expiresAt);

    if (!row.dataBlock1 || !row.dataBlock2 || !row.dataBlock3) {
      throw new BadRequestException('Complete os três blocos antes de enviar.');
    }

    // Revalida contra os contratos: dado veio do banco, mas validar é barato e
    // protege de linha corrompida/migração parcial.
    const block1 = anamnesisBlock1Schema.parse(row.dataBlock1);
    anamnesisBlock3Schema.parse(row.dataBlock3);
    const block2Json = await this.cipher.decryptHealth(row.dataBlock2);
    const block2 = anamnesisBlock2Schema.parse(JSON.parse(block2Json));

    const gate = evaluateParq(block2);

    const userId = await this.db.runAsSystem(async (tx) => {
      const created = await this.createUser(tx, block1, gate.requiresProfessionalReview);
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

    // `form_submitted` — evento de funil. Sem PII: só o id da sessão (UUID) e o estado.
    // ponytail: emissão via log estruturado; o SDK server do PostHog não existe no
    // backend nesta sprint (o funil de UI é instrumentado por Felipe — US-1.6).
    this.logger.info(
      { event: 'form_submitted', anamnesisSessionId: row.id, parqState: gate.parqState },
      'form_submitted',
    );

    return {
      status: 'SUBMITTED',
      parqState: gate.parqState,
      requiresProfessionalReview: gate.requiresProfessionalReview,
    };
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
      void this.expire(id);
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
    block1: AnamnesisBlock1,
    requiresProfessionalReview: boolean,
  ): Promise<string> {
    try {
      const [created] = await tx
        .insert(users)
        .values({
          name: block1.name,
          phoneNumber: block1.phoneNumber,
          email: block1.email ?? null,
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

  private toView(row: typeof anamnesisSessions.$inferSelect): SessionView {
    return {
      status: row.status,
      lastBlock: row.lastBlock,
      primaryGoal: row.primaryGoal,
      parqState: (row.parqState as ParqStateType | null) ?? null,
      block1: row.dataBlock1 ?? null,
      block2Completed: row.dataBlock2 != null,
      block3: row.dataBlock3 ?? null,
      expiresAt: row.expiresAt,
    };
  }
}
