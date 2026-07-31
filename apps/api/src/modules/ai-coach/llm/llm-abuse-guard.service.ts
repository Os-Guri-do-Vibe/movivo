/**
 * Anti-abuso de LLM (US-2.2 / TASK-2.2.4 · LLM10 Unbounded Consumption · Sato §9.4).
 *
 * Counter Redis por usuário/dia (namespaced pelo `RedisKeyBuilder` da Sprint 0) + budget
 * alert quando o custo/usuário/dia passa do baseline (sinal de conta comprometida). No
 * fluxo de geração (batch) o vetor é pequeno, mas o teto já nasce aqui para a Sprint 3
 * (Coach) herdar. Chaves de API ficam em secret (nunca aqui).
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../../core/config';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../../core/redis/redis-key.util';

/** Estourou o teto diário de chamadas do usuário (LLM10). */
export class LLMAbuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMAbuseError';
  }
}

const TWO_DAYS_SECONDS = 172_800;

@Injectable()
export class LlmAbuseGuard {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LlmAbuseGuard.name);
  }

  private day(): string {
    return new Date().toISOString().slice(0, 10); // '2026-07-29' — passa no SEGMENT_PATTERN
  }

  /**
   * Peek SEM incrementar: o usuário já bateu o teto diário? (US-3.5, teto operacional).
   * Lê o mesmo counter do `check()`. Usado pelo `AIResponseWorker` para responder o limite
   * gentil ANTES de qualquer custo (embedding/contexto/LLM). `>=` porque o 51º já estourou.
   */
  async isOverDailyLimit(userId: string): Promise<boolean> {
    const count = await this.redis.get(this.keys.forUser(userId, 'llm-usage', this.day()));
    return Number(count ?? 0) >= this.config.llm.userDailyMessageLimit;
  }

  /** Incrementa o counter do dia e barra acima do teto. Chamar antes de cada chamada real. */
  async check(userId: string): Promise<void> {
    const key = this.keys.forUser(userId, 'llm-usage', this.day());
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, TWO_DAYS_SECONDS);
    const limit = this.config.llm.userDailyMessageLimit;
    if (count > limit) {
      throw new LLMAbuseError(`teto diário de LLM excedido (${count}/${limit})`);
    }
  }

  /** Acumula o custo do dia e dispara budget alert acima do baseline. */
  async recordCost(userId: string, costBrl: number): Promise<void> {
    const key = this.keys.forUser(userId, 'llm-cost-brl', this.day());
    const total = await this.redis.incrbyfloat(key, costBrl);
    await this.redis.expire(key, TWO_DAYS_SECONDS);
    const baseline = this.config.llm.dailyCostAlertBrl;
    if (Number(total) > baseline) {
      this.logger.warn(
        { userId, totalBrl: Number(total), baselineBrl: baseline },
        'budget alert: custo de LLM do usuário acima do baseline diário (LLM10)',
      );
    }
  }
}
