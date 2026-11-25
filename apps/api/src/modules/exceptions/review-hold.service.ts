import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
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

/** Payload e nome do job que libera um caso de revisão opcional. */
export interface ProtocolAutoReleaseJob {
  userId: string;
  exceptionCaseId: string;
}

/**
 * Trava da liberação automática enquanto o profissional está com o protocolo aberto na tela de
 * revisão/edição.
 *
 * A liberação sai quando a janela de revisão opcional termina e ninguém agiu. Se o prazo vence
 * com a tela aberta, mandar o protocolo ao aluno por baixo de quem está editando é errado. Então:
 * a tela renova a trava (`hold`) enquanto está aberta; o worker, ao encontrar a trava, adia e
 * marca que há um envio vencido esperando; ao fechar a tela (`release`) esse envio é disparado na
 * hora. Estado todo em Redis (efêmero de propósito): se a tela morrer sem avisar, a trava expira
 * sozinha e o próprio worker retoma.
 */
@Injectable()
export class ReviewHoldService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly queues: QueueManager,
  ) {}

  private key(name: string, { userId, exceptionCaseId }: ProtocolAutoReleaseJob): string {
    return this.keys.forUser(userId, name, 'case', exceptionCaseId);
  }

  /** A tela está aberta: renova a trava. */
  async hold(target: ProtocolAutoReleaseJob): Promise<void> {
    await this.redis.set(this.key('review-hold', target), '1', 'EX', REVIEW_HOLD_TTL_SECONDS);
  }

  async isHeld(target: ProtocolAutoReleaseJob): Promise<boolean> {
    return (await this.redis.exists(this.key('review-hold', target))) === 1;
  }

  /**
   * Chamado pelo worker quando o prazo venceu mas a tela está aberta: lembra que há um envio
   * esperando e agenda UMA nova olhada (a marca `NX` impede jobs paralelos de multiplicar a
   * corrente de rechecagens).
   */
  async deferRelease(target: ProtocolAutoReleaseJob): Promise<void> {
    await this.redis.set(this.key('release-deferred', target), '1', 'EX', DEFERRED_TTL_SECONDS);
    const first = await this.redis.set(
      this.key('release-recheck', target),
      '1',
      'PX',
      REVIEW_RECHECK_MS,
      'NX',
    );
    if (first !== 'OK') return;
    await this.queues.enqueue(QUEUE.protocolAutoRelease, 'auto-release', target, {
      delay: REVIEW_RECHECK_MS,
      jobId: `auto-release_${target.exceptionCaseId}_hold_${Date.now()}`,
    });
  }

  /**
   * A tela fechou: solta a trava e, se um envio venceu enquanto ela estava aberta, dispara
   * agora. Devolve `true` quando disparou. O job é idempotente pelo estado do caso: se o
   * profissional já decidiu (aprovou, recusou, pediu ajuste), vira no-op.
   */
  async release(target: ProtocolAutoReleaseJob): Promise<boolean> {
    await this.redis.del(this.key('review-hold', target));
    const deferred = await this.redis.getdel(this.key('release-deferred', target));
    if (deferred === null) return false;
    await this.queues.enqueue(QUEUE.protocolAutoRelease, 'auto-release', target, {
      jobId: `auto-release_${target.exceptionCaseId}_leave_${Date.now()}`,
    });
    return true;
  }
}
