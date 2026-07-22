/**
 * Namespacing de chaves do Redis — TASK-0.3.4.
 *
 * # Por que isto existe
 * Sato (`11-relatorio-sato.md` §4.3) exige **isolamento por titular** também no
 * cache/fila, não só no Postgres via RLS. O Redis não tem RLS: a única barreira é a
 * disciplina de nomenclatura. Se um dia uma chave de contexto de conversa for montada
 * como `context:latest` em vez de `movivo:u:<uuid>:context:latest`, dois usuários
 * passam a compartilhar o mesmo contexto de conversa — e na MOVIVO esse contexto
 * contém dado de saúde (LGPD Art. 11). Por isso o construtor de chave é a **única**
 * forma suportada de montar chave, e não uma convenção documentada em prosa.
 *
 * # Formato
 *   `<prefixo>:u:<userId>:<segmento>[:<segmento>…]`   → escopo de um titular
 *   `<prefixo>:g:<segmento>[:<segmento>…]`            → escopo global (sem PII)
 *
 * `u`/`g` tornam trivial auditar por `SCAN movivo:u:*` quem tem dado de titular, e
 * permitem apagar tudo de um usuário no pedido de exclusão da LGPD (Art. 18 VI).
 *
 * # Invariantes
 *  - `userId` deve ser um **UUID**. Telefone, e-mail ou CPF nunca entram numa chave:
 *    o Redis não é cifrado em repouso no MVP e nomes de chave aparecem em `MONITOR`,
 *    em `SLOWLOG` e em métricas de keyspace.
 *  - Segmentos não podem conter `:`, espaço ou caractere de controle — senão um
 *    segmento controlado pelo usuário poderia forjar um nível de namespace e alcançar
 *    a chave de outro titular.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export class RedisKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedisKeyError';
  }
}

function assertSegments(segments: readonly string[]): void {
  if (segments.length === 0) {
    throw new RedisKeyError('a chave precisa de ao menos um segmento.');
  }
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new RedisKeyError(
        `segmento de chave inválido: "${segment}". ` +
          'Use apenas [A-Za-z0-9._-] (1-64 chars); ":" é reservado ao separador de namespace.',
      );
    }
  }
}

/**
 * Construtor de chaves com escopo. Instanciado uma vez por app com o prefixo raiz
 * (`REDIS_KEY_PREFIX`) e injetado onde for preciso.
 */
export class RedisKeyBuilder {
  constructor(private readonly prefix: string) {
    if (!SEGMENT_PATTERN.test(prefix)) {
      throw new RedisKeyError(`prefixo raiz inválido: "${prefix}".`);
    }
  }

  /** Chave com escopo de um titular. `userId` **precisa** ser UUID. */
  forUser(userId: string, ...segments: string[]): string {
    if (!UUID_PATTERN.test(userId)) {
      throw new RedisKeyError(
        'userId precisa ser um UUID. Nunca use telefone, e-mail ou CPF em nome de chave ' +
          '(aparece em MONITOR/SLOWLOG e o Redis não é cifrado em repouso no MVP).',
      );
    }
    assertSegments(segments);
    return [this.prefix, 'u', userId.toLowerCase(), ...segments].join(':');
  }

  /** Chave global — só para dado que **não** pertence a um titular (feature flags, locks). */
  global(...segments: string[]): string {
    assertSegments(segments);
    return [this.prefix, 'g', ...segments].join(':');
  }

  /**
   * Padrão de `SCAN` para todas as chaves de um titular.
   * Usado na exclusão de dados (LGPD Art. 18 VI) e em testes de isolamento (US-0.8).
   * Nunca use `KEYS` em produção — só `SCAN`.
   */
  userScanPattern(userId: string): string {
    if (!UUID_PATTERN.test(userId)) {
      throw new RedisKeyError('userId precisa ser um UUID.');
    }
    return `${this.prefix}:u:${userId.toLowerCase()}:*`;
  }
}

/** Token de DI do `RedisKeyBuilder`. */
export const REDIS_KEY_BUILDER = Symbol('MOVIVO_REDIS_KEY_BUILDER');
