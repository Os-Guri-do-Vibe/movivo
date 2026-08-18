/**
 * Configuração central das filas BullMQ (US-1.7 / ARQUITETURA §6).
 *
 * Ponto ÚNICO de defaults e parâmetros de fila — nenhuma opção de retry/backoff ou
 * limpeza de job é definida dentro de um processor. Aqui vive:
 *   · o registro das 5 filas de negócio com os parâmetros fixos de §6 (definições, sem
 *     processadores — estes nascem nas Sprints 2-5);
 *   · a fila `sanity`, que prova o pipeline enqueue→process→retry→DLQ nesta sprint;
 *   · a fila `dead-letter`, destino de jobs que estouram os retries.
 *
 * A conexão é derivada de `buildRedisOptions` do RedisModule (ADR-004: descoberta de
 * master via Sentinel). NÃO há uma segunda descoberta de master aqui — reusa-se a
 * mesma fonte de verdade, apenas com `maxRetriesPerRequest: null`, exigência do BullMQ
 * para conexões de worker (comandos bloqueantes tipo BRPOPLPUSH).
 */
import { type RedisOptions } from 'ioredis';

import { type AppConfigService } from '../../core/config';
import { buildRedisOptions } from '../../core/redis';

export const QUEUE = {
  protocolGeneration: 'protocol-generation',
  protocolAutoRelease: 'protocol-auto-release',
  aiResponse: 'ai-response',
  whatsappOutbound: 'whatsapp-outbound',
  checkinWeekly: 'checkin-weekly',
  workoutDaily: 'workout-daily',
  conversionSequence: 'conversion-sequence',
  paymentReconciliation: 'payment-reconciliation',
  sanity: 'sanity',
  deadLetter: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

/**
 * Parâmetros por fila (§6). `attempts`/`backoffMs` alimentam as opções default de job;
 * `concurrency`/`lockMs`/`rateLimit` são para os workers das sprints futuras — ficam
 * registrados aqui como fonte única, mesmo antes de haver processor.
 */
export interface QueueSpec {
  readonly attempts: number;
  /** Atrasos de backoff em ms, um por tentativa restante (backoff customizado). */
  readonly backoffMs: readonly number[];
  readonly concurrency: number;
  readonly lockMs?: number;
  readonly rateLimit?: { readonly max: number; readonly durationMs: number };
}

export const QUEUE_REGISTRY: Readonly<Record<QueueName, QueueSpec>> = {
  [QUEUE.protocolGeneration]: {
    attempts: 3,
    backoffMs: [2_000, 8_000, 32_000],
    concurrency: 5,
    lockMs: 120_000,
  },
  // Liberação automática após a janela de cortesia de 1h (fila do profissional,
  // categoria "Disponível para Revisão"). Baixo volume, sem urgência de latência.
  [QUEUE.protocolAutoRelease]: {
    attempts: 3,
    backoffMs: [5_000, 15_000, 45_000],
    concurrency: 3,
  },
  [QUEUE.aiResponse]: {
    attempts: 2,
    backoffMs: [3_000, 9_000],
    concurrency: 20,
    lockMs: 45_000,
    rateLimit: { max: 80, durationMs: 1_000 },
  },
  [QUEUE.whatsappOutbound]: {
    attempts: 5,
    backoffMs: [3_000, 9_000, 27_000, 81_000, 243_000],
    concurrency: 10,
    lockMs: 30_000,
    rateLimit: { max: 80, durationMs: 1_000 },
  },
  [QUEUE.checkinWeekly]: { attempts: 3, backoffMs: [5_000, 15_000, 45_000], concurrency: 10 },
  // Quick reply diário de treino (US-8.1). Mesmo perfil do check-in: um scan por dia,
  // sem urgência de latência, retry curto — o envio real acontece em `whatsappOutbound`.
  [QUEUE.workoutDaily]: { attempts: 3, backoffMs: [5_000, 15_000, 45_000], concurrency: 10 },
  [QUEUE.conversionSequence]: { attempts: 1, backoffMs: [], concurrency: 5 },
  // Conciliação de liquidação (US-8.5). Retenta bastante e por bastante tempo: é fato
  // financeiro que já foi autenticado no webhook — perdê-lo por um blip do banco seria
  // perder receita da apuração. A idempotência é a UNIQUE de `payments`, então retry
  // repetido nunca duplica linha, o que torna seguro insistir.
  [QUEUE.paymentReconciliation]: {
    attempts: 5,
    backoffMs: [2_000, 10_000, 60_000, 300_000, 900_000],
    concurrency: 5,
    lockMs: 30_000,
  },
  [QUEUE.sanity]: { attempts: 3, backoffMs: [50, 100, 200], concurrency: 2 },
  // DLQ é destino final: não retenta, não é reprocessada automaticamente.
  [QUEUE.deadLetter]: { attempts: 1, backoffMs: [], concurrency: 1 },
} as const;

/**
 * Opções default de job derivadas do spec da fila. Backoff `type: 'custom'` porque §6
 * pede progressões não-exponenciais-puras (ex: 2/8/32 = fator 4, não fator 2).
 * `removeOnComplete`/`removeOnFail` limitam o crescimento do keyspace centralmente.
 */
export function resolveJobOptions(queue: QueueName): {
  attempts: number;
  backoff: { type: 'custom' };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number; count: number };
} {
  return {
    attempts: QUEUE_REGISTRY[queue].attempts,
    backoff: { type: 'custom' },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 3_600, count: 5_000 },
  };
}

/** Backoff customizado por fila: atraso da tentativa `attemptsMade` (1-based). */
export function backoffDelay(queue: QueueName, attemptsMade: number): number {
  const delays = QUEUE_REGISTRY[queue].backoffMs;
  return delays[attemptsMade - 1] ?? delays[delays.length - 1] ?? 0;
}

/** Conexão BullMQ a partir da MESMA descoberta via Sentinel do RedisModule. */
export function buildBullConnection(config: AppConfigService): RedisOptions {
  return { ...buildRedisOptions(config), maxRetriesPerRequest: null };
}

/**
 * Prefixo de keyspace das filas, namespaced pelo `REDIS_KEY_PREFIX`. Mantém as chaves
 * de fila sob o mesmo namespace do resto do app (isolamento por ambiente/contexto).
 */
export function bullPrefix(config: AppConfigService): string {
  return `${config.redis.keyPrefix}:bull`;
}
