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
  // Liberação automática de protocolo LEGADO fora da revisão (some junto do painel antigo, M10).
  protocolAutoRelease: 'protocol-auto-release',
  // Achado 2026-09-02: liberação da proposta de substituição de exercício via IA, após a
  // janela de cortesia de 30 min (`AI_SUBSTITUTION_REVIEW_WINDOW_MS`) — fila própria, e não
  // um branch dentro de `protocolAutoRelease`, porque o job carrega o id da PROPOSTA
  // (`protocol_substitution_requests.id`), não o do protocolo — o mesmo protocolo pode ter
  // várias propostas ao longo do tempo, cada uma com seu próprio job/estado.
  protocolSubstitutionRelease: 'protocol-substitution-release',
  aiResponse: 'ai-response',
  whatsappOutbound: 'whatsapp-outbound',
  // Espelho da aba "Conversas": baixa a mídia (áudio/imagem) de cada mensagem e confirma a que
  // foi digitada no celular. Fila própria — nunca atrasa nem derruba o pipeline da IA.
  whatsappMirror: 'whatsapp-mirror',
  checkinWeekly: 'checkin-weekly',
  workoutDaily: 'workout-daily',
  // Link diário e fechamento do dia no modelo v2 (qualquer modalidade); `workoutDaily` é o legado.
  trainingDaily: 'training-daily',
  // Check-in adaptativo semanal (v2); `checkinWeekly` é o legado.
  checkIn: 'check-in',
  // Comentário do Coach sobre o treino que o aluno acabou de registrar no diário
  // (`WorkoutJournalService.finish()`) — fila própria (não um branch de `whatsappOutbound`)
  // porque quem enfileira (`workout`) não pode falar com `LlmRouter`/`ValidationService`
  // diretamente (fronteira §12.5); o worker que fala com a IA mora no `CoachModule`.
  workoutFeedback: 'workout-feedback',
  // O protocolo ganhou uma versão nova (troca de exercício, emenda do profissional): o treino de
  // hoje, se ainda não começou, é atualizado e o aluno é perguntado se quer um link novo. Fila
  // própria porque quem publica o protocolo (`protocol`, `admin`) não importa o domínio `workout`.
  workoutProtocolChanged: 'workout-protocol-changed',
  // Comentário do Coach sobre o check-in semanal (achado 2026-09-13) — mesmo racional de
  // `workoutFeedback`: quem enfileira (`checkin`) não pode falar com `LlmRouter`/
  // `ValidationService` diretamente (fronteira §12.5); o worker mora no `CoachModule`.
  checkinWeeklyFeedback: 'checkin-weekly-feedback',
  conversionSequence: 'conversion-sequence',
  paymentReconciliation: 'payment-reconciliation',
  // Fim do período pago: cron horário que leva ACTIVE → EXPIRED quando não houve renovação
  // (parcelado no cartão e Pix à vista não renovam sozinhos).
  subscriptionPeriodScan: 'subscription-period-scan',
  // Outbox de eventos de domínio: o relé publica eventos gravados em `domain_events` e o
  // dispatcher entrega cada evento aos consumidores registrados (idempotentes por recibo).
  outboxRelay: 'outbox-relay',
  domainEvents: 'domain-events',
  // Geração do plano integrado (estratégia + treino + nutrição) depois do onboarding.
  planGeneration: 'plan-generation',
  knowledgeProcessing: 'knowledge-processing',
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
  // Liberação automática após a janela de cortesia de 1h (fila do profissional,
  // categoria "Disponível para Revisão"). Baixo volume, sem urgência de latência.
  [QUEUE.protocolAutoRelease]: {
    attempts: 3,
    backoffMs: [5_000, 15_000, 45_000],
    concurrency: 3,
  },
  // Mesmo perfil de `protocolAutoRelease`: baixo volume, sem urgência de latência.
  [QUEUE.protocolSubstitutionRelease]: {
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
  // Best-effort: a mensagem já está no histórico; a mídia que não baixa vira "indisponível".
  [QUEUE.whatsappMirror]: { attempts: 3, backoffMs: [3_000, 9_000, 27_000], concurrency: 5 },
  [QUEUE.checkinWeekly]: { attempts: 3, backoffMs: [5_000, 15_000, 45_000], concurrency: 10 },
  // Quick reply diário de treino (US-8.1). Mesmo perfil do check-in: um scan por dia,
  // sem urgência de latência, retry curto — o envio real acontece em `whatsappOutbound`.
  [QUEUE.workoutDaily]: { attempts: 3, backoffMs: [5_000, 15_000, 45_000], concurrency: 10 },
  [QUEUE.trainingDaily]: { attempts: 3, backoffMs: [5_000, 15_000, 45_000], concurrency: 10 },
  [QUEUE.checkIn]: { attempts: 3, backoffMs: [5_000, 15_000, 45_000], concurrency: 10 },
  // Best-effort (mesmo espírito do resumo de entrega do protocolo): poucas tentativas,
  // nunca trava o diário do aluno por causa de um comentário que não saiu.
  [QUEUE.workoutFeedback]: { attempts: 2, backoffMs: [5_000], concurrency: 5 },
  // Best-effort: a atualização do treino de hoje nunca pode travar a publicação do protocolo.
  [QUEUE.workoutProtocolChanged]: { attempts: 2, backoffMs: [5_000], concurrency: 5 },
  // Mesmo perfil de `workoutFeedback`: best-effort, poucas tentativas.
  [QUEUE.checkinWeeklyFeedback]: { attempts: 2, backoffMs: [5_000], concurrency: 5 },
  [QUEUE.conversionSequence]: {
    attempts: 3,
    backoffMs: [5_000, 30_000],
    concurrency: 5,
  },
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
  // Mesmo perfil de `protocolRenewalScan`: varredura idempotente, sem urgência de latência.
  [QUEUE.subscriptionPeriodScan]: {
    attempts: 3,
    backoffMs: [5_000, 15_000, 45_000],
    concurrency: 1,
  },
  // Parsing/indexação de documentos: idempotente, fora da requisição e com retry.
  [QUEUE.knowledgeProcessing]: {
    attempts: 4,
    backoffMs: [2_000, 10_000, 30_000, 120_000],
    concurrency: 2,
    lockMs: 120_000,
  },
  // Relé: uma execução por vez basta (o SELECT usa SKIP LOCKED); retry rápido.
  [QUEUE.outboxRelay]: { attempts: 3, backoffMs: [1_000, 5_000, 15_000], concurrency: 1 },
  // Dispatcher: consumidores podem chamar IA, por isso lock longo e retry espaçado.
  [QUEUE.domainEvents]: {
    attempts: 5,
    backoffMs: [2_000, 10_000, 30_000, 120_000, 600_000],
    concurrency: 10,
    lockMs: 180_000,
  },
  // Vários agentes em sequência (estratégia, blocos, reconciliação, nutrição): lock longo e poucas
  // tentativas — falha de validação abre caso para a equipe em vez de repetir indefinidamente.
  [QUEUE.planGeneration]: {
    attempts: 3,
    backoffMs: [10_000, 60_000, 300_000],
    concurrency: 3,
    lockMs: 600_000,
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
