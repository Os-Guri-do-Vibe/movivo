/**
 * `ConsentService` — registro e prova de consentimento LGPD (US-1.2).
 *
 * Fonte jurídica: `docs/juridico/consentimento-e-parq.md` (Alexandre).
 * Os textos e as versões vêm de `@movivo/shared` para que o que a UI exibe e o
 * que o banco registra sejam, por construção, a mesma versão.
 *
 * Três invariantes que este serviço protege:
 *  1. **Independência das finalidades** — `HEALTH_DATA`, `MARKETING` e
 *     `TERMS_OF_SERVICE` são linhas separadas. Um aceite nunca implica o outro
 *     (vedação de consentimento genérico, Alexandre §1).
 *  2. **Prova, não anotação** — toda linha carrega `version` + `ip` + `user_agent`
 *     + `accepted_at`. Recusa (`accepted=false`) também é registrada.
 *  3. **Append-only** — revogar é `UPDATE revoked_at`, nunca DELETE (a policy de
 *     RLS da US-1.1 já não concede DELETE em `consents` a ninguém).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CONSENT_TEXTS, type ConsentTypeWithText, type RecordConsentInput } from '@movivo/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { TenantDatabase, type TenantTransaction } from '../../core/database';
import { anamnesisSessions, consents } from '../../core/database/schema';

/** Origem da requisição — a prova de onde o aceite partiu. Nunca vem do cliente. */
export interface ConsentOrigin {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

@Injectable()
export class ConsentService {
  constructor(private readonly db: TenantDatabase) {}

  /**
   * Registra os consentimentos de uma sessão de anamnese ainda anônima.
   *
   * Roda em `runAsToken` (contexto `ANONYMOUS` da US-1.1): a linha nasce sem
   * `user_id`, ancorada na sessão. O acesso é **token-scoped** — o serviço
   * resolve a sessão pelo token e nunca aceita `user_id`/`sessionId` do cliente
   * (mitigação de IDOR, Sato §8.1).
   */
  async recordForSessionToken(
    token: string,
    inputs: readonly RecordConsentInput[],
    origin: ConsentOrigin,
  ): Promise<void> {
    this.assertVersionsAreCurrent(inputs);

    await this.db.runAsToken(async (tx) => {
      const sessionId = await this.resolveActiveSessionId(tx, token);
      for (const input of inputs) {
        await this.upsert(tx, { anamnesisSessionId: sessionId, userId: null }, input, origin);
      }
    });
  }

  /**
   * Token → sessão ativa. Sessão inexistente, expirada ou já submetida não
   * aceita novo consentimento — e a mensagem é a mesma nos três casos, para não
   * transformar o endpoint num oráculo de tokens válidos.
   */
  private async resolveActiveSessionId(tx: TenantTransaction, token: string): Promise<string> {
    const [session] = await tx
      .select({ id: anamnesisSessions.id })
      .from(anamnesisSessions)
      .where(
        and(
          eq(anamnesisSessions.token, token),
          eq(anamnesisSessions.status, 'IN_PROGRESS'),
          gt(anamnesisSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!session) {
      throw new NotFoundException('Sessão de anamnese não encontrada ou expirada.');
    }
    return session.id;
  }

  /**
   * Vincula ao titular os consentimentos coletados na fase anônima (chamado no
   * submit da anamnese — US-1.3). Preserva `accepted_at`/`ip`/`user_agent`
   * originais: a prova é do momento do aceite, não do momento do vínculo.
   */
  async linkSessionToUser(sessionId: string, userId: string): Promise<void> {
    await this.db.runAsSystem(async (tx) => {
      await tx
        .update(consents)
        .set({ userId })
        .where(and(eq(consents.anamnesisSessionId, sessionId), isNull(consents.userId)));
    });
  }

  /**
   * O gate que a US-1.3 chama antes de gravar o Bloco 2.
   *
   * `true` só quando existe consentimento de saúde **aceito e não revogado** na
   * versão vigente. É esta função que torna o BLOQUEADOR 3 de Alexandre uma
   * trava real: sem ela, dado de saúde entraria no banco sem base legal.
   */
  async hasValidHealthConsent(sessionId: string): Promise<boolean> {
    const rows = await this.db.runAsToken((tx) =>
      tx
        .select({ id: consents.id })
        .from(consents)
        .where(
          and(
            eq(consents.anamnesisSessionId, sessionId),
            eq(consents.consentType, 'HEALTH_DATA'),
            eq(consents.version, CONSENT_TEXTS.HEALTH_DATA.version),
            eq(consents.accepted, true),
            isNull(consents.revokedAt),
          ),
        )
        .limit(1),
    );

    return rows.length > 0;
  }

  /** Revogação (LGPD art. 8º, §5º): carimba `revoked_at`, jamais apaga a linha. */
  async revoke(userId: string, type: ConsentTypeWithText): Promise<void> {
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx
        .update(consents)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(consents.userId, userId),
            eq(consents.consentType, type),
            isNull(consents.revokedAt),
          ),
        );
    });
  }

  /**
   * Recusa a versão divergente em vez de aceitá-la.
   *
   * Se a UI enviar uma versão que não é a vigente, o usuário viu um texto
   * diferente do que seria registrado — e o registro deixaria de ser prova.
   * Falhar aqui é o comportamento correto (Alexandre §3.1).
   */
  private assertVersionsAreCurrent(inputs: readonly RecordConsentInput[]): void {
    for (const input of inputs) {
      const current = CONSENT_TEXTS[input.type].version;
      if (input.version !== current) {
        throw new BadRequestException(
          `Versão de consentimento desatualizada para ${input.type}: recarregue a página.`,
        );
      }
    }
  }

  /**
   * Idempotência pelo índice único (âncora, finalidade, versão): reaceitar a
   * mesma versão não duplica a prova, apenas atualiza a decisão e a origem.
   */
  private async upsert(
    tx: TenantTransaction,
    subject: { anamnesisSessionId: string | null; userId: string | null },
    input: RecordConsentInput,
    origin: ConsentOrigin,
  ): Promise<void> {
    await tx
      .insert(consents)
      .values({
        ...subject,
        consentType: input.type,
        version: input.version,
        accepted: input.accepted,
        ipAddress: origin.ip,
        userAgent: origin.userAgent,
        acceptedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [consents.anamnesisSessionId, consents.consentType, consents.version],
        set: {
          accepted: input.accepted,
          ipAddress: origin.ip,
          userAgent: origin.userAgent,
          acceptedAt: sql`now()`,
        },
      });
  }
}
