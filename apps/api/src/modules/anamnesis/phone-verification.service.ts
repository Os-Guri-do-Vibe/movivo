/**
 * Verificação de posse do WhatsApp por código (US-6.5).
 *
 * Por que existe: hoje o produto **não prova** que o número informado pertence a quem
 * preencheu o formulário. Um número errado (ou de terceiro) receberia um protocolo de
 * treino montado a partir de dados de saúde de outra pessoa.
 *
 * Decisão já tomada com o fundador (D4): o código vai **pelo próprio WhatsApp**,
 * reusando o AraraHQ e a fila `whatsapp-outbound` que já existem. Não é SMS e nenhum
 * provedor novo é contratado.
 *
 * ## Decisões de segurança tomadas aqui (documentadas para a revisão de Sato)
 *  - **Entropia:** 6 dígitos por `randomInt` (CSPRNG do Node, sem viés de módulo).
 *    10^6 é fraco por si só; o que o torna seguro é o par TTL curto + teto de tentativas.
 *  - **TTL 10 min** — recomendação de UX de Sofia §4.5, dentro da faixa que ela declarou
 *    aceitável para Sato (5-10). Abaixo de 5 min expira no meio do uso real; acima de 15
 *    não melhora conclusão e só amplia a janela de ataque.
 *  - **Teto de tentativas: 5 por código.** Com 5 tentativas em 10^6, a chance de acerto
 *    cego é 1 em 200 mil por código. Estourado o teto, o código é **invalidado** (não só
 *    recusado) — senão o atacante somaria tentativas de códigos sucessivos.
 *  - **Cooldown de reenvio: 60s** (o contador que Sofia especificou) e **teto de 5 envios
 *    por sessão**. Reenvio dentro do cooldown é **idempotente**: não dispara mensagem
 *    nova, não invalida o código vigente e não é erro — a UI já está mostrando o contador.
 *  - **Teto por NÚMERO: 10 envios/hora**, somando todas as sessões. Sem isso, criar
 *    sessões novas contornaria o teto por sessão e o AraraHQ viraria canal de abuso.
 *  - **Sem enumeração:** o resultado não diz se o número existe no sistema. Sucesso e
 *    falha têm a mesma superfície de resposta.
 *  - **Nunca em claro:** só o SHA-256 de `<sessionId>:<código>` é persistido; o código
 *    em claro existe em memória e no corpo da mensagem enfileirada, e some do processo
 *    logo em seguida. Nunca vai para log (o `LoggerModule` redige, e nada aqui loga o valor).
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { PHONE_CODE_LENGTH } from '@movivo/shared';

import { TenantDatabase } from '../../core/database';
import { anamnesisSessions } from '../../core/database/schema';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';

export const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
export const PHONE_CODE_RESEND_COOLDOWN_MS = 60 * 1000;
export const PHONE_CODE_MAX_ATTEMPTS = 5;
export const PHONE_CODE_MAX_SENDS_PER_SESSION = 5;
export const PHONE_CODE_MAX_SENDS_PER_NUMBER = 10;
export const PHONE_CODE_NUMBER_WINDOW_MS = 60 * 60 * 1000;

export interface SendCodeResult {
  /** `false` quando o pedido caiu no cooldown — nenhuma mensagem nova foi enviada. */
  sent: boolean;
  /** Quando o cliente pode pedir de novo (o contador de 60s da UI — Sofia §4.3). */
  resendAvailableAt: Date;
  expiresAt: Date;
}

/** Sessão como o serviço de verificação precisa vê-la. */
export interface VerifiableSession {
  id: string;
  phoneE164: string | null;
  phoneVerifiedAt: Date | null;
  phoneCodeHash: string | null;
  phoneCodeExpiresAt: Date | null;
  phoneCodeAttempts: number;
  phoneCodeSentAt: Date | null;
  phoneCodeSendCount: number;
}

/** SHA-256 de `<sessionId>:<código>`. O id da sessão é o sal. */
export function hashPhoneCode(sessionId: string, code: string): string {
  return createHash('sha256').update(`${sessionId}:${code}`).digest('hex');
}

/** Código numérico de 6 dígitos por CSPRNG, com zeros à esquerda preservados. */
function generateCode(): string {
  const max = 10 ** PHONE_CODE_LENGTH;
  return String(randomInt(0, max)).padStart(PHONE_CODE_LENGTH, '0');
}

@Injectable()
export class PhoneVerificationService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PhoneVerificationService.name);
  }

  /**
   * Gera e envia o código. Trocar de número invalida a verificação anterior
   * (Sofia §4.6): o selo "verificado" cai junto com o número antigo.
   */
  async sendCode(
    session: VerifiableSession,
    phoneNumber: string,
    now: Date = new Date(),
  ): Promise<SendCodeResult> {
    const sameNumber = session.phoneE164 === phoneNumber;

    // Reenvio idempotente: dentro do cooldown, nada é enviado e o código vigente
    // continua válido. Clique duplo não dispara duas mensagens (Sofia §4.3).
    if (
      sameNumber &&
      session.phoneCodeSentAt &&
      now.getTime() - session.phoneCodeSentAt.getTime() < PHONE_CODE_RESEND_COOLDOWN_MS &&
      session.phoneCodeExpiresAt &&
      session.phoneCodeExpiresAt.getTime() > now.getTime()
    ) {
      return {
        sent: false,
        resendAvailableAt: new Date(
          session.phoneCodeSentAt.getTime() + PHONE_CODE_RESEND_COOLDOWN_MS,
        ),
        expiresAt: session.phoneCodeExpiresAt,
      };
    }

    const sendCount = sameNumber ? session.phoneCodeSendCount : 0;
    if (sendCount >= PHONE_CODE_MAX_SENDS_PER_SESSION) {
      throw new ForbiddenException(
        'Muitas tentativas seguidas. Espere alguns minutos antes de pedir um novo código.',
      );
    }
    await this.assertNumberQuota(phoneNumber, now);

    const code = generateCode();
    const expiresAt = new Date(now.getTime() + PHONE_CODE_TTL_MS);

    await this.db.runAsTokenScoped(session.id, async (tx) => {
      await tx
        .update(anamnesisSessions)
        .set({
          phoneE164: phoneNumber,
          // Trocar o número derruba a verificação: o selo é do número, não da sessão.
          phoneVerifiedAt: sameNumber ? session.phoneVerifiedAt : null,
          phoneCodeHash: hashPhoneCode(session.id, code),
          phoneCodeExpiresAt: expiresAt,
          phoneCodeAttempts: 0,
          phoneCodeSentAt: now,
          phoneCodeSendCount: sendCount + 1,
        })
        .where(eq(anamnesisSessions.id, session.id));
    });

    // O job carrega o telefone e o código porque, nesta fase, **não existe `users`**
    // para o worker resolver sob RLS — o número é justamente o dado sendo provado.
    // `jobId` idempotente por sessão+envio: um retry de fila não vira segunda mensagem.
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'phone-verification',
      { type: 'PHONE_VERIFICATION', phoneNumber, code, userId: null },
      { jobId: `phone-verification_${session.id}_${sendCount + 1}` },
    );

    // Métrica sem PII e sem o código (Henrique — TASK-6.5.2).
    this.logger.info(
      { event: 'otp_sent', anamnesisSessionId: session.id, attempt: sendCount + 1 },
      'otp_sent',
    );

    return {
      sent: true,
      resendAvailableAt: new Date(now.getTime() + PHONE_CODE_RESEND_COOLDOWN_MS),
      expiresAt,
    };
  }

  /**
   * Confere o código. Mensagem de erro **igual** para código errado e sessão sem
   * código pendente — a diferença viraria oráculo. Expirado é o único caso distinto,
   * porque o usuário precisa saber que deve pedir outro (Sofia, estado E).
   */
  async verify(session: VerifiableSession, code: string, now: Date = new Date()): Promise<void> {
    if (!session.phoneCodeHash || !session.phoneCodeExpiresAt) {
      throw new BadRequestException('Esse código não confere. Peça um novo código.');
    }
    if (session.phoneCodeExpiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException('Esse código expirou. Pede um novo, leva um segundo.');
    }
    if (session.phoneCodeAttempts >= PHONE_CODE_MAX_ATTEMPTS) {
      throw new ForbiddenException(
        'Muitas tentativas seguidas. Por segurança, espere alguns minutos antes de tentar de novo.',
      );
    }

    if (hashPhoneCode(session.id, code) !== session.phoneCodeHash) {
      const attempts = session.phoneCodeAttempts + 1;
      const exhausted = attempts >= PHONE_CODE_MAX_ATTEMPTS;
      await this.db.runAsTokenScoped(session.id, async (tx) => {
        await tx
          .update(anamnesisSessions)
          .set({
            phoneCodeAttempts: attempts,
            // Teto estourado invalida o código: senão o atacante somaria tentativas
            // ao longo de códigos sucessivos, e o teto por código não valeria nada.
            ...(exhausted ? { phoneCodeHash: null, phoneCodeExpiresAt: null } : {}),
          })
          .where(eq(anamnesisSessions.id, session.id));
      });
      this.logger.info(
        { event: 'otp_failed', anamnesisSessionId: session.id, reason: 'MISMATCH' },
        'otp_failed',
      );
      throw new BadRequestException('Esse código não confere. Confira os 6 dígitos e tenta de novo.');
    }

    await this.db.runAsTokenScoped(session.id, async (tx) => {
      await tx
        .update(anamnesisSessions)
        .set({
          phoneVerifiedAt: now,
          phoneCodeHash: null,
          phoneCodeExpiresAt: null,
          phoneCodeAttempts: 0,
        })
        .where(eq(anamnesisSessions.id, session.id));
    });
    this.logger.info({ event: 'otp_verified', anamnesisSessionId: session.id }, 'otp_verified');
  }

  /**
   * Teto por número, somando todas as sessões da última hora.
   *
   * Roda como SYSTEM porque a varredura cruza sessões de outros tokens — nenhum dado
   * é devolvido, só a contagem. É a única leitura desta classe fora do escopo da sessão.
   */
  private async assertNumberQuota(phoneNumber: string, now: Date): Promise<void> {
    const since = new Date(now.getTime() - PHONE_CODE_NUMBER_WINDOW_MS);
    const total = await this.db.runAsSystem(async (tx) => {
      const rows = (await tx
        .select({ sends: sql<number>`coalesce(sum(${anamnesisSessions.phoneCodeSendCount}), 0)` })
        .from(anamnesisSessions)
        .where(
          and(
            eq(anamnesisSessions.phoneE164, phoneNumber),
            gte(anamnesisSessions.phoneCodeSentAt, since),
          ),
        )) as Array<{ sends: number | string }>;
      return Number(rows[0]?.sends ?? 0);
    });

    if (total >= PHONE_CODE_MAX_SENDS_PER_NUMBER) {
      throw new ForbiddenException(
        'Muitas tentativas seguidas. Espere alguns minutos antes de pedir um novo código.',
      );
    }
  }
}
