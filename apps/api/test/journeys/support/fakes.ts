/**
 * Fakes das BORDAS do sistema para os testes de jornada: Redis em memória, fila/WhatsApp,
 * LLM roteirizado, cifra reversível e logger. Tudo o que fica entre essas bordas é real.
 *
 * Os fakes imitam o contrato que o código usa, não a implementação: TTL do Redis pelo relógio
 * (que os testes controlam), `jobId` repetido ignorado como no BullMQ, mensagens do WhatsApp na
 * ordem em que foram enfileiradas.
 */
import { vi } from 'vitest';

import { RedisKeyBuilder } from '../../../src/core/redis/redis-key.util';
import type { WhatsappOutboundJob } from '../../../src/modules/jobs/whatsapp-outbound.contract';

/** Subconjunto do ioredis usado pelos serviços da agenda flexível e pela varredura das 04:00. */
export class FakeRedis {
  private readonly store = new Map<string, { value: string; expiresAt: number | null }>();
  /** Liga uma falha em todos os comandos (Redis fora do ar). */
  down = false;

  private guard(): void {
    if (this.down) throw new Error('ECONNREFUSED (Redis fake fora do ar)');
  }

  private live(key: string): { value: string; expiresAt: number | null } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    this.guard();
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    this.guard();
    let expiresAt: number | null = null;
    let onlyIfAbsent = false;
    for (let index = 0; index < args.length; index += 1) {
      const flag = String(args[index]).toUpperCase();
      if (flag === 'EX') expiresAt = Date.now() + Number(args[++index]) * 1000;
      else if (flag === 'PX') expiresAt = Date.now() + Number(args[++index]);
      else if (flag === 'NX') onlyIfAbsent = true;
    }
    if (onlyIfAbsent && this.live(key)) return null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async exists(...keys: string[]): Promise<number> {
    this.guard();
    return keys.filter((key) => this.live(key)).length;
  }

  async del(...keys: string[]): Promise<number> {
    this.guard();
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  keysFor(userId: string): string[] {
    return [...this.store.keys()].filter((key) => key.includes(userId) && this.live(key));
  }
}

export const KEYS = new RedisKeyBuilder('movivo-test');

export interface EnqueuedJob {
  queue: string;
  name: string;
  data: unknown;
  opts: { jobId?: string; delay?: number };
}

/** Fila: guarda o que foi enfileirado; `jobId` repetido é ignorado, como no BullMQ. */
export class FakeQueues {
  readonly jobs: EnqueuedJob[] = [];
  private readonly seen = new Set<string>();
  failOn: ReadonlySet<string> = new Set();

  async enqueue(
    queue: string,
    name: string,
    data: unknown,
    opts: { jobId?: string; delay?: number } = {},
  ): Promise<string> {
    if (this.failOn.has(queue)) throw new Error(`fila ${queue} indisponível (fake)`);
    const id = opts.jobId ?? `${queue}-${this.jobs.length + 1}`;
    if (this.seen.has(id)) return id;
    this.seen.add(id);
    this.jobs.push({ queue, name, data, opts });
    return id;
  }

  of(queue: string): EnqueuedJob[] {
    return this.jobs.filter((job) => job.queue === queue);
  }

  /** O que saiu para o WhatsApp de um aluno, na ordem de envio. */
  whatsapp(userId: string): WhatsappOutboundJob[] {
    return this.of('whatsapp-outbound')
      .map((job) => job.data as WhatsappOutboundJob)
      .filter((job) => job.userId === userId);
  }
}

/** Cifra reversível e legível: o teste enxerga o que foi cifrado, o código não percebe a troca. */
export const fakeCipher = {
  async encryptHealth(plaintext: string): Promise<Buffer> {
    return Buffer.from(`enc:${plaintext}`, 'utf8');
  },
  async decryptHealth(ciphertext: Buffer): Promise<string> {
    return ciphertext.toString('utf8').replace(/^enc:/, '');
  },
  async encryptText(plaintext: string): Promise<string> {
    return `enc:${plaintext}`;
  },
  async decryptText(value: string): Promise<string> {
    return value.replace(/^enc:/, '');
  },
};

export function fakeLogger() {
  return {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
}

export interface LlmCall {
  intent?: string;
  system: string;
  messages: Array<{ role: string; content: string }>;
  dataClass?: string;
}

/**
 * LLM roteirizado por `intent` da chamada (`schedule_request_parse`, `workout_feedback`). Cada
 * chamada fica registrada para o teste conferir o que foi enviado ao modelo.
 */
export class FakeLlm {
  readonly calls: LlmCall[] = [];
  private readonly scripts = new Map<string, Array<string | Error>>();

  /** Próximas respostas para um propósito (fila; a última se repete). */
  script(intent: string, ...responses: Array<string | object | Error>): void {
    this.scripts.set(
      intent,
      responses.map((item) =>
        item instanceof Error || typeof item === 'string' ? item : JSON.stringify(item),
      ),
    );
  }

  async complete(request: LlmCall): Promise<{ text: string }> {
    this.calls.push(request);
    const queue = this.scripts.get(request.intent ?? '') ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) throw new Error(`LLM fake sem roteiro para "${request.intent}"`);
    if (next instanceof Error) throw next;
    return { text: next };
  }

  callsFor(intent: string): LlmCall[] {
    return this.calls.filter((call) => call.intent === intent);
  }
}
