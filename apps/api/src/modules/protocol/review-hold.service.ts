import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE, type QueueName } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';

/**
 * Validade da trava. A tela de revisão renova a cada ~30 s; o dobro de folga cobre aba em
 * segundo plano (o navegador estrangula timers) sem deixar uma aba esquecida travar o envio
 * por muito tempo depois de fechada de um jeito que nem o `pagehide` pegou (queda, crash).
 */
export const REVIEW_HOLD_TTL_SECONDS = 120;
/** De quanto em quanto o job volta a olhar a trava enquanto ela segura o envio. */
export const REVIEW_RECHECK_MS = 15_000;
/** Quanto tempo se lembra de que um envio venceu e foi adiado (só precisa durar a tela aberta). */
const DEFERRED_TTL_SECONDS = 24 * 60 * 60;

/** O que tem envio automático e, por isso, pode ser segurado pela tela de revisão. */
export type ReviewHoldKind = 'PROTOCOL' | 'SUBSTITUTION';

/** `id` é o do protocolo (`PROTOCOL`) ou o da proposta de troca (`SUBSTITUTION`). */
export interface ReviewHoldTarget {
  kind: ReviewHoldKind;
  userId: string;
  id: string;
}

/** Cada tipo tem a sua fila, o seu formato de job e o seu prefixo de id — exatamente os que o
 * produtor original usa, para o job reagendado cair no mesmo worker e caber no mesmo contrato. */
const RELEASE_JOBS: Record<
  ReviewHoldKind,
  { queue: QueueName; name: string; idPrefix: string; payload: (t: ReviewHoldTarget) => object }
> = {
  PROTOCOL: {
    queue: QUEUE.protocolAutoRelease,
    name: 'auto-release',
    idPrefix: 'auto-release',
    payload: ({ userId, id }) => ({ userId, protocolId: id }),
  },
  SUBSTITUTION: {
    queue: QUEUE.protocolSubstitutionRelease,
    name: 'substitution-release',
    idPrefix: 'substitution-auto-release',
    payload: ({ userId, id }) => ({ userId, requestId: id }),
  },
};

/**
 * Trava da auto-liberação enquanto o profissional está com o item aberto na tela de
 * revisão/edição (protocolo ou troca de exercício proposta pela IA).
 *
 * A auto-liberação sai depois do prazo (24h protocolo, 30 min troca) se ninguém agir. Se o
 * prazo vence com o item aberto, mandar o treino ao aluno por baixo do profissional — no meio
 * de uma edição — é errado. Então: a tela renova a trava (`hold`) enquanto está aberta; o
 * worker, ao encontrar a trava, adia e marca que há um envio vencido esperando; ao fechar a
 * tela (`release`) esse envio é disparado na hora. Estado todo em Redis (efêmero de
 * propósito): se a tela morrer sem avisar, a trava expira sozinha e o próprio worker retoma.
 */
/** Janela em que um protocolo legado opcional ainda aguarda revisão no painel (legado até o M10). */
export const PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ReviewHoldService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly queues: QueueManager,
  ) {}

  private key(name: string, { kind, userId, id }: ReviewHoldTarget): string {
    return this.keys.forUser(userId, name, kind.toLowerCase(), id);
  }

  /** A tela está aberta: renova a trava. */
  async hold(target: ReviewHoldTarget): Promise<void> {
    await this.redis.set(this.key('review-hold', target), '1', 'EX', REVIEW_HOLD_TTL_SECONDS);
  }

  async isHeld(target: ReviewHoldTarget): Promise<boolean> {
    return (await this.redis.exists(this.key('review-hold', target))) === 1;
  }

  /**
   * Chamado pelo worker quando o prazo venceu mas a tela está aberta: lembra que há um envio
   * esperando e agenda UMA nova olhada (a marca `NX` impede jobs paralelos de multiplicar a
   * corrente de rechecagens).
   */
  async deferRelease(target: ReviewHoldTarget): Promise<void> {
    await this.redis.set(this.key('release-deferred', target), '1', 'EX', DEFERRED_TTL_SECONDS);
    const first = await this.redis.set(
      this.key('release-recheck', target),
      '1',
      'PX',
      REVIEW_RECHECK_MS,
      'NX',
    );
    if (first !== 'OK') return;
    const job = RELEASE_JOBS[target.kind];
    await this.queues.enqueue(job.queue, job.name, job.payload(target), {
      delay: REVIEW_RECHECK_MS,
      jobId: `${job.idPrefix}-${target.id}-hold-${Date.now()}`,
    });
  }

  /**
   * A tela fechou: solta a trava e, se um envio venceu enquanto ela estava aberta, dispara
   * agora. Devolve `true` quando disparou. O job é idempotente pelo estado do item — se o
   * profissional já decidiu (assinou, aprovou, recusou, editou), vira no-op.
   */
  async release(target: ReviewHoldTarget): Promise<boolean> {
    await this.redis.del(this.key('review-hold', target));
    const deferred = await this.redis.getdel(this.key('release-deferred', target));
    if (deferred === null) return false;
    const job = RELEASE_JOBS[target.kind];
    await this.queues.enqueue(job.queue, job.name, job.payload(target), {
      jobId: `${job.idPrefix}-${target.id}-leave-${Date.now()}`,
    });
    return true;
  }
}
