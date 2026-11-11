/**
 * Acompanhamento do ciclo menstrual pelo WhatsApp: a aluna pede para começar ("quero acompanhar
 * meu ciclo") ou conta que menstruou, autoriza (`AUTORIZO CICLO`), registra cada início
 * ("menstruei hoje") e para quando quiser, com apagamento (`REVOGAR CICLO`). Tudo determinístico:
 * nenhuma dessas mensagens passa pelo modelo. Datas cifradas em `student_health_records`. Os
 * lembretes de autocuidado ao longo do ciclo saem do `CycleCareService`.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { CONSENT_TEXTS, healthRecordPayloadSchema } from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { consents, studentHealthRecords, users } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { CYCLE_INBOUND_EVENT, type InboundTextEvent } from '../../core/event-bus/events';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappJobType } from '../jobs/whatsapp-outbound.contract';
import {
  CYCLE_AUTHORIZE_PHRASE,
  CYCLE_REVOKE_PHRASE,
  SAME_PERIOD_DAYS,
  daysBetween,
  parseCycleMessage,
} from './menstrual-cycle';

const PENDING_TTL_SECONDS = 86_400;
const CONSENT = CONSENT_TEXTS.MENSTRUAL_CYCLE;

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Datas de início registradas (decifradas). Quem chama garante o consentimento. */
export async function loadCycleStarts(
  tx: TenantTransaction,
  cipher: HealthCipherService,
  userId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ payload: studentHealthRecords.payload })
    .from(studentHealthRecords)
    .where(
      and(
        eq(studentHealthRecords.userId, userId),
        eq(studentHealthRecords.kind, 'MENSTRUAL_CYCLE'),
        eq(studentHealthRecords.status, 'ACTIVE'),
      ),
    );
  const starts: string[] = [];
  for (const row of rows) {
    const payload = healthRecordPayloadSchema.safeParse(
      JSON.parse(await cipher.decryptHealth(row.payload)),
    );
    if (payload.success && payload.data.onDate) starts.push(payload.data.onDate);
  }
  return starts;
}

/** Autorização do ciclo vigente (texto atual, aceita e não revogada). */
export async function hasCycleConsent(tx: TenantTransaction, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: consents.id })
    .from(consents)
    .where(
      and(
        eq(consents.userId, userId),
        eq(consents.consentType, 'MENSTRUAL_CYCLE'),
        eq(consents.version, CONSENT.version),
        eq(consents.accepted, true),
        isNull(consents.revokedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

@Injectable()
export class MenstrualCycleService implements OnModuleInit, OnModuleDestroy {
  private unregister?: () => void;

  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly health: HealthConsentService,
    private readonly events: DomainEventBus,
    private readonly queues: QueueManager,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MenstrualCycleService.name);
  }

  onModuleInit(): void {
    this.unregister = this.events.register<InboundTextEvent, boolean>(
      CYCLE_INBOUND_EVENT,
      ({ userId, text, messageKey }) => this.handleInbound(userId, text, messageKey),
    );
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  /** `true` = tratada aqui (a IA não responde). Pergunta junto do registro segue para a conversa. */
  async handleInbound(
    userId: string,
    text: string,
    messageKey: string,
    now = new Date(),
  ): Promise<boolean> {
    const today = await this.todayOf(userId, now);
    const command = parseCycleMessage(text, today);
    if (!command) return false;
    const pendingKey = this.keys.forUser(userId, 'cycle', 'pending');

    if (command.kind === 'REVOKE') {
      await this.revoke(userId);
      await this.redis.del(pendingKey);
      await this.reply(userId, messageKey, 'CONSENT_STATUS', REVOKED_MESSAGE);
      return true;
    }
    // Sem consentimento de saúde não há registro: o gate do WhatsApp responde depois.
    if (!(await this.health.hasActiveForUser(userId))) return false;

    if (command.kind === 'STOP_HINT') {
      // Parar apaga dados: só a frase exata faz isso. Aqui a aluna aprende qual é.
      const active = await this.db.runAsUser(userId, 'USER', (tx) => hasCycleConsent(tx, userId));
      await this.reply(
        userId,
        messageKey,
        'CONSENT_STATUS',
        active ? STOP_HINT_MESSAGE : NOT_ACTIVE_MESSAGE,
      );
      return true;
    }
    if (command.kind === 'START') {
      const active = await this.db.runAsUser(userId, 'USER', (tx) => hasCycleConsent(tx, userId));
      await this.reply(
        userId,
        messageKey,
        'CONSENT_STATUS',
        active ? ALREADY_ACTIVE_MESSAGE : CONSENT_REQUEST_MESSAGE,
      );
      return true;
    }

    if (command.kind === 'AUTHORIZE') {
      await this.db.runAsUser(userId, 'USER', (tx) =>
        tx.execute(
          sql`SELECT public.record_user_consent(${userId}::uuid, 'MENSTRUAL_CYCLE'::consent_type, ${CONSENT.version}, 'whatsapp')`,
        ),
      );
      const pending = await this.redis.get(pendingKey);
      await this.redis.del(pendingKey);
      const logged = pending ? await this.logStart(userId, pending) : null;
      await this.reply(userId, messageKey, 'CONSENT_STATUS', authorizedMessage(logged));
      this.logger.info({ event: 'cycle_consent_granted', userId }, 'registro do ciclo autorizado');
      return true;
    }

    const consented = await this.db.runAsUser(userId, 'USER', (tx) => hasCycleConsent(tx, userId));
    if (!consented) {
      if (command.question) return false;
      await this.redis.set(pendingKey, command.onDate, 'EX', PENDING_TTL_SECONDS);
      await this.reply(userId, messageKey, 'CONSENT_STATUS', CONSENT_REQUEST_MESSAGE);
      return true;
    }
    const logged = await this.logStart(userId, command.onDate);
    if (command.question) return false;
    await this.reply(
      userId,
      messageKey,
      'CONVERSATION_MESSAGE',
      logged ? loggedMessage(logged) : duplicateMessage(command.onDate),
    );
    return true;
  }

  /** Grava o início; `null` quando já existe um início da mesma menstruação. */
  async logStart(userId: string, onDate: string): Promise<string | null> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const starts = await loadCycleStarts(tx, this.cipher, userId);
      if (starts.some((d) => Math.abs(daysBetween(d, onDate)) < SAME_PERIOD_DAYS)) return null;
      await tx.insert(studentHealthRecords).values({
        userId,
        kind: 'MENSTRUAL_CYCLE',
        payload: await this.cipher.encryptHealth(
          JSON.stringify({ summary: 'Início da menstruação', onDate }),
        ),
        origin: 'DECLARED',
      });
      return onDate;
    });
  }

  /** Revoga e apaga as datas (o texto do consentimento promete o apagamento). */
  async revoke(userId: string): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.execute(
        sql`SELECT public.revoke_non_health_consent(${userId}::uuid, 'MENSTRUAL_CYCLE'::consent_type)`,
      ),
    );
    await this.db.runAsSystem((tx) =>
      tx
        .delete(studentHealthRecords)
        .where(
          and(
            eq(studentHealthRecords.userId, userId),
            eq(studentHealthRecords.kind, 'MENSTRUAL_CYCLE'),
          ),
        ),
    );
    this.logger.info({ event: 'cycle_consent_revoked', userId }, 'registro do ciclo revogado');
  }

  private async todayOf(userId: string, now: Date): Promise<string> {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)),
    );
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: row?.timezone ?? 'America/Sao_Paulo',
    }).format(now);
  }

  private async reply(
    userId: string,
    messageKey: string,
    type: WhatsappJobType,
    text: string,
  ): Promise<void> {
    const dedupeId = `cycle-${messageKey}`;
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'cycle',
      { userId, type, dedupeId, text },
      { jobId: dedupeId },
    );
  }
}

const REVOKED_MESSAGE =
  'Acompanhamento do ciclo desativado. As datas que você tinha registrado foram apagadas, os lembretes pararam e não registramos mais nada sobre o seu ciclo. Se quiser voltar, é só me dizer "quero acompanhar meu ciclo".';

const CONSENT_REQUEST_MESSAGE = [
  `Posso acompanhar o seu ciclo menstrual: você me conta quando a menstruação começa, eu adapto intensidade, recuperação e alimentação ao que você sentir e te mando lembretes de autocuidado ao longo do ciclo. Antes, preciso da sua autorização.\n\n*${CONSENT.title}*\n\n${CONSENT.body.map((p) => p.replaceAll('**', '*')).join('\n\n')}`,
  `${CONSENT.label}\n\nSe estiver de acordo, responda exatamente: *${CYCLE_AUTHORIZE_PHRASE}*`,
].join('\n---\n');

const ALREADY_ACTIVE_MESSAGE = `O acompanhamento do seu ciclo já está ativo. Sempre que a menstruação começar, é só me contar (por exemplo: "menstruei hoje"). Para parar e apagar os registros, envie *${CYCLE_REVOKE_PHRASE}*.`;

const STOP_HINT_MESSAGE = `Para parar o acompanhamento do ciclo, envie exatamente *${CYCLE_REVOKE_PHRASE}*. Isso apaga as datas registradas e interrompe os lembretes. Se preferir manter, não precisa fazer nada.`;

const NOT_ACTIVE_MESSAGE =
  'O acompanhamento do ciclo não está ativo na sua conta, então não há lembretes nem registros para parar.';

function authorizedMessage(logged: string | null): string {
  return [
    'Acompanhamento do ciclo ativado. 💚',
    logged
      ? `Já anotei o início da menstruação em ${ddmm(logged)}.`
      : 'Para eu começar, me conta quando veio a sua última menstruação (por exemplo: "menstruei dia 28" ou "menstruei hoje").',
    'Sempre que a menstruação começar, é só me contar. Com as datas, eu te aviso quando ela estiver perto de chegar, da fase em que a TPM é mais comum e da janela fértil estimada, sempre com dicas de autocuidado. Se sentir cólica, cansaço ou outro desconforto, me conta que a gente adapta o treino do dia.',
    `Para parar e apagar os registros, envie *${CYCLE_REVOKE_PHRASE}*.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const loggedMessage = (onDate: string) =>
  `Anotado: início da menstruação em ${ddmm(onDate)}. Como você está se sentindo? Se precisar, a gente adapta a intensidade do treino de hoje.`;

const duplicateMessage = (onDate: string) =>
  `Esse início já estava anotado (perto de ${ddmm(onDate)}). Se quiser, me conta como você está que a gente adapta o treino.`;
