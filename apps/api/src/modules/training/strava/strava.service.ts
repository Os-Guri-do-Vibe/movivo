/**
 * Strava: o aluno pede "conectar Strava" no WhatsApp, autoriza no navegador (OAuth) e, a cada
 * atividade nova, o Strava avisa o webhook; buscamos a atividade com o token do PRÓPRIO atleta
 * (o webhook não é assinado: serve só de gatilho), registramos o treino e confirmamos no WhatsApp.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { AppConfigService } from '../../../core/config';
import { HealthCipherService } from '../../../core/database/health-cipher.service';
import { wearableConnections } from '../../../core/database/schema';
import { TenantDatabase } from '../../../core/database/tenant-database.service';
import { WEARABLE_INBOUND_EVENT, type InboundTextEvent } from '../../../core/event-bus/events';
import { DomainEventBus } from '../../../core/event-bus/event-bus.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../../core/redis';
import { QUEUE } from '../../jobs/jobs.config';
import { QueueManager } from '../../jobs/queue-manager.service';
import { WorkerFactory } from '../../jobs/worker.factory';
import { ExecutionService } from '../execution.service';
import {
  activityImport,
  CONNECTED_MESSAGE,
  connectMessage,
  DISCONNECTED_MESSAGE,
  importedMessage,
  parseStravaCommand,
  stravaActivitySchema,
  stravaEventSchema,
} from './strava';

const STRAVA = 'https://www.strava.com';
const STATE_TTL_SECONDS = 3_600;
const TIMEOUT_MS = 10_000;
/** Renova o token um pouco antes de vencer. */
const REFRESH_MARGIN_MS = 60_000;

export interface StravaJob {
  athleteId: string;
  objectId: number;
  objectType: 'activity' | 'athlete';
  aspectType: 'create' | 'update' | 'delete';
  deauthorized: boolean;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int(),
  athlete: z.object({ id: z.number().int().positive() }).optional(),
});

const sha = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 48);

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Página mínima de retorno do OAuth (texto fixo, nada vindo da requisição). */
function page(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MOVIVO</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1.5rem;color:#14201C;background:#F4F7F3"><h1 style="color:#06302A;font-size:1.5rem">${title}</h1><p>${body}</p></body></html>`;
}

export const STRAVA_PAGES = {
  connected: page('Strava conectado', 'Pode fechar esta página e voltar ao WhatsApp.'),
  expired: page(
    'Link vencido',
    'Este link já foi usado ou venceu. Peça um novo no WhatsApp: "conectar Strava".',
  ),
  denied: page(
    'Não conectamos o Strava',
    'Para registrar os treinos, autorize a leitura das atividades. Peça um novo link no WhatsApp quando quiser.',
  ),
  failed: page('Não deu certo agora', 'Tente de novo daqui a pouco pelo WhatsApp.'),
} as const;

@Injectable()
export class StravaService implements OnModuleInit, OnModuleDestroy {
  private unregister?: () => void;

  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly config: AppConfigService,
    private readonly events: DomainEventBus,
    private readonly queues: QueueManager,
    private readonly workers: WorkerFactory,
    private readonly executions: ExecutionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StravaService.name);
  }

  onModuleInit(): void {
    this.unregister = this.events.register<InboundTextEvent, boolean>(
      WEARABLE_INBOUND_EVENT,
      ({ userId, text, messageKey }) => this.handleInbound(userId, text, messageKey),
    );
    this.workers.create<StravaJob>(QUEUE.wearableSync, (job) => this.process(job));
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  /** "conectar Strava" / "DESCONECTAR STRAVA". `false` = não é comando (ou integração desligada). */
  async handleInbound(userId: string, text: string, messageKey: string): Promise<boolean> {
    const command = parseStravaCommand(text);
    if (!command || !this.config.strava) return false;
    if (command === 'DISCONNECT') {
      await this.disconnect(userId);
      await this.reply(userId, `strava-${messageKey}`, DISCONNECTED_MESSAGE);
      return true;
    }
    const state = randomBytes(32).toString('base64url');
    await this.redis.set(this.stateKey(state), userId, 'EX', STATE_TTL_SECONDS);
    const link = `${this.config.apiPublicUrl}/${this.config.globalPrefix}/wearables/strava/connect/${state}`;
    await this.reply(userId, `strava-${messageKey}`, connectMessage(link));
    return true;
  }

  /** URL de autorização do Strava; `null` = link vencido. Não consome o link (pré-visualização). */
  async authorizeUrl(state: string): Promise<string | null> {
    const strava = this.config.strava;
    if (!strava || !(await this.redis.get(this.stateKey(state)))) return null;
    const params = new URLSearchParams({
      client_id: strava.clientId,
      response_type: 'code',
      redirect_uri: `${this.config.apiPublicUrl}/${this.config.globalPrefix}/wearables/strava/callback`,
      approval_prompt: 'auto',
      scope: 'activity:read_all',
      state,
    });
    return `${STRAVA}/oauth/authorize?${params.toString()}`;
  }

  /** Volta do OAuth: troca o código pelos tokens e guarda cifrado. Devolve a página a mostrar. */
  async callback(query: {
    state: string;
    code?: string;
    scope?: string;
    error?: string;
  }): Promise<keyof typeof STRAVA_PAGES> {
    const strava = this.config.strava;
    const userId = strava ? await this.redis.getdel(this.stateKey(query.state)) : null;
    if (!strava || !userId) return 'expired';
    const scopes = query.scope?.split(',') ?? [];
    if (
      query.error ||
      !query.code ||
      !(scopes.includes('activity:read_all') || scopes.includes('activity:read'))
    ) {
      return 'denied';
    }
    try {
      const token = tokenSchema.parse(
        await this.post('/oauth/token', {
          client_id: strava.clientId,
          client_secret: strava.clientSecret,
          code: query.code,
          grant_type: 'authorization_code',
        }),
      );
      if (!token.athlete) throw new Error('resposta sem atleta');
      const values = {
        athleteId: String(token.athlete.id),
        accessToken: await this.cipher.encryptText(token.access_token),
        refreshToken: await this.cipher.encryptText(token.refresh_token),
        expiresAt: new Date(token.expires_at * 1000),
      };
      await this.db.runAsUser(userId, 'USER', (tx) =>
        tx
          .insert(wearableConnections)
          .values({ userId, provider: 'STRAVA', ...values })
          .onConflictDoUpdate({
            target: [wearableConnections.userId, wearableConnections.provider],
            set: values,
          }),
      );
    } catch (error) {
      this.logger.warn(
        {
          event: 'strava_connect_failed',
          userId,
          err: error instanceof Error ? error.message : 'erro desconhecido',
        },
        'conexão com o Strava falhou',
      );
      return 'failed';
    }
    await this.reply(
      userId,
      `strava-connected-${sha(query.state).slice(0, 32)}`,
      CONNECTED_MESSAGE,
    );
    this.logger.info({ event: 'strava_connected', userId }, 'Strava conectado');
    return 'connected';
  }

  /** Verificação da assinatura do webhook (`hub.challenge`). `null` = recusa. */
  challenge(mode: unknown, token: unknown, challenge: unknown): string | null {
    const strava = this.config.strava;
    return strava &&
      mode === 'subscribe' &&
      typeof token === 'string' &&
      typeof challenge === 'string' &&
      challenge.length <= 200 &&
      sameSecret(token, strava.webhookVerifyToken)
      ? challenge
      : null;
  }

  /** Evento do webhook: só enfileira (responder em até 2 s é exigência do Strava). */
  async receive(body: unknown): Promise<void> {
    const parsed = stravaEventSchema.safeParse(body);
    if (!parsed.success || !this.config.strava) return;
    const event = parsed.data;
    const job: StravaJob = {
      athleteId: String(event.owner_id),
      objectId: event.object_id,
      objectType: event.object_type,
      aspectType: event.aspect_type,
      deauthorized: event.updates?.authorized === 'false',
    };
    await this.queues.enqueue(QUEUE.wearableSync, 'strava-event', job, {
      jobId: `strava-${event.object_type}-${event.object_id}-${event.aspect_type}`,
    });
  }

  async process(job: Job<StravaJob>): Promise<string> {
    const { athleteId, objectId, objectType, aspectType, deauthorized } = job.data;
    const [connection] = await this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(wearableConnections)
        .where(
          and(
            eq(wearableConnections.provider, 'STRAVA'),
            eq(wearableConnections.athleteId, athleteId),
          ),
        ),
    );
    if (!connection) return 'UNKNOWN_ATHLETE';
    if (objectType === 'athlete' && deauthorized) {
      await this.remove(connection.userId);
      await this.reply(connection.userId, `strava-deauth-${connection.id}`, DISCONNECTED_MESSAGE);
      return 'DEAUTHORIZED';
    }
    if (objectType !== 'activity' || aspectType !== 'create') return 'IGNORED';

    const accessToken = await this.validToken(connection);
    const activity = stravaActivitySchema.parse(
      await this.request(`/api/v3/activities/${objectId}`, {
        authorization: `Bearer ${accessToken}`,
      }),
    );
    const imported = activityImport(activity);
    const result = await this.executions.importActivity(connection.userId, imported);
    if (!result) return 'DUPLICATE';
    await this.reply(
      connection.userId,
      `strava-activity-${objectId}`,
      importedMessage(imported, result.planned),
    );
    return 'IMPORTED';
  }

  private async validToken(connection: typeof wearableConnections.$inferSelect): Promise<string> {
    const strava = this.config.strava;
    if (connection.expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now() || !strava) {
      return this.cipher.decryptText(connection.accessToken);
    }
    const token = tokenSchema.parse(
      await this.post('/oauth/token', {
        client_id: strava.clientId,
        client_secret: strava.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: await this.cipher.decryptText(connection.refreshToken),
      }),
    );
    const values = {
      accessToken: await this.cipher.encryptText(token.access_token),
      refreshToken: await this.cipher.encryptText(token.refresh_token),
      expiresAt: new Date(token.expires_at * 1000),
    };
    await this.db.runAsSystem((tx) =>
      tx.update(wearableConnections).set(values).where(eq(wearableConnections.id, connection.id)),
    );
    return token.access_token;
  }

  /** Desconecta a pedido do aluno: revoga no Strava (melhor esforço) e apaga os tokens. */
  private async disconnect(userId: string): Promise<void> {
    const [connection] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.select().from(wearableConnections).where(eq(wearableConnections.userId, userId)),
    );
    if (!connection) return;
    try {
      await this.post(
        '/oauth/deauthorize',
        {},
        { authorization: `Bearer ${await this.cipher.decryptText(connection.accessToken)}` },
      );
    } catch {
      // Token já inválido no Strava: apagar aqui basta.
    }
    await this.remove(userId);
  }

  private async remove(userId: string): Promise<void> {
    await this.db.runAsSystem((tx) =>
      tx.delete(wearableConnections).where(eq(wearableConnections.userId, userId)),
    );
    this.logger.info({ event: 'strava_disconnected', userId }, 'Strava desconectado');
  }

  private stateKey(state: string): string {
    return this.keys.global('strava-state', sha(state));
  }

  private post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return this.request(path, { 'content-type': 'application/json', ...headers }, body);
  }

  private async request(
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    const response = await fetch(`${STRAVA}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Strava ${path}: HTTP ${response.status}`);
    return response.json();
  }

  private async reply(userId: string, dedupeId: string, text: string): Promise<void> {
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'strava',
      { userId, type: 'CONVERSATION_MESSAGE', dedupeId, text },
      { jobId: dedupeId },
    );
  }
}
