/**
 * `TenantDatabase` — execução tenant-scoped por transação (US-1.1 / TASK-1.1.1 — Sato §4.4).
 *
 * # O problema que resolve
 * Sob PgBouncer em **transaction mode** (ADR-003), a conexão de servidor é devolvida
 * ao pool no fim de cada transação e reusada por outro cliente. Um `SET app.current_user_id`
 * (de sessão) **vazaria** o contexto do titular A para a próxima transação do titular B
 * na mesma conexão física — quebra clássica de isolamento multi-tenant (Sato §4.4).
 *
 * # A regra
 * Todo acesso com escopo de titular passa por aqui. O contexto é emitido com
 * `set_config(name, value, is_local := true)` — o equivalente parametrizável de
 * `SET LOCAL` — **dentro** de uma transação explícita. `is_local = true` reverte o
 * valor no COMMIT/ROLLBACK; como no transaction mode a transação inteira roda numa
 * única conexão de backend, o isolamento é garantido e nada persiste entre requests.
 *
 * **Nunca** se usa `SET`/`SET SESSION` (sem LOCAL): vazaria na conexão do pooler.
 * Usamos `set_config` (e não `SET LOCAL <name> = <literal>`) porque `SET` não aceita
 * parâmetro de bind — `set_config` aceita, eliminando qualquer risco de injeção pelo
 * `userId`/`role` e evitando interpolação de string em statement.
 *
 * # Três contextos
 *  - `runAsUser(userId, role, cb)` — titular autenticado (RLS por `user_id`).
 *  - `runAsSystem(cb)` — operações de bootstrap SEM titular ainda: criar `users` no
 *    submit da anamnese, buscar usuário por credencial no login, migrar consentimentos.
 *    `app.current_role = 'SYSTEM'`, sem `current_user_id`. É um contexto privilegiado:
 *    use-o só em métodos de serviço explícitos e revisados, nunca sobre dado do cliente.
 *  - `runAsToken(cb)` — fase **anônima** da anamnese (`user_id IS NULL`, TASK-1.1.4).
 *    `app.current_role = 'ANONYMOUS'`. A RLS libera apenas linhas sem titular; o
 *    isolamento entre sessões anônimas vem do token opaco (122 bits) + `WHERE token=$1`
 *    na aplicação, que **nunca** aceita `user_id` do cliente (IDOR — Sato §8.1).
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DRIZZLE } from './database.constants';
import { type DrizzleClient } from './database.module';

/** Papéis de usuário aceitos em `runAsUser` (os que a coluna `users.role` guarda). */
export type TenantRole = 'USER' | 'PROFESSIONAL' | 'ADMIN';

const ALLOWED_ROLES: ReadonlySet<string> = new Set<TenantRole>(['USER', 'PROFESSIONAL', 'ADMIN']);

/** Tipo do handle transacional que o callback recebe (o `tx` do Drizzle). */
export type TenantTransaction = Parameters<Parameters<DrizzleClient['transaction']>[0]>[0];

/**
 * UUID canônico (v1-v8). Validar o `userId` é defesa em profundidade: o valor já vai
 * parametrizado (sem injeção), mas um valor malformado só falharia no cast `::uuid`
 * dentro da policy, com erro obscuro. Falhar cedo e claro é melhor.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantDatabase {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleClient) {}

  /**
   * Executa `cb` numa transação com o contexto do titular (`user_id` + `role`),
   * de modo que a RLS `FORCE` filtre toda query pelo `user_id`.
   */
  async runAsUser<T>(
    userId: string,
    role: TenantRole,
    cb: (tx: TenantTransaction) => Promise<T>,
  ): Promise<T> {
    if (!UUID_RE.test(userId)) {
      throw new TypeError('runAsUser: userId inválido — esperado UUID.');
    }
    if (!ALLOWED_ROLES.has(role)) {
      throw new TypeError(`runAsUser: role inválida "${role}".`);
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_role', ${role}, true)`);
      return cb(tx);
    });
  }

  /**
   * Contexto de **sistema** (bootstrap sem titular). Privilegiado — a RLS libera
   * as linhas via `app.current_role = 'SYSTEM'`. Restrinja a métodos de serviço
   * bem delimitados (criação de usuário, login, migração de consentimento).
   */
  async runAsSystem<T>(cb: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      // NULL (e não '') para que `current_user_id IS NULL` seja verdadeiro nas policies.
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${null}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_role', 'SYSTEM', true)`);
      return cb(tx);
    });
  }

  /**
   * Contexto **anônimo** da anamnese (fase `user_id IS NULL`). A RLS só permite
   * linhas sem titular; a aplicação DEVE filtrar por `token` (TASK-1.1.4).
   */
  async runAsToken<T>(cb: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${null}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_role', 'ANONYMOUS', true)`);
      return cb(tx);
    });
  }
}
