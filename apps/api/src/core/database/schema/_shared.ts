/**
 * Blocos reutilizáveis do schema Drizzle (TASK-0.4.1).
 *
 * Tudo que é transversal às 9 tabelas-base vive aqui para que uma decisão
 * (tipo da PK, semântica de `updated_at`, regra de `user_id`) tenha **um** lugar
 * onde mudar. Nenhuma tabela é definida neste arquivo.
 *
 * ## Por que `gen_random_uuid()` e não `uuid_generate_v4()`
 * O DDL de referência de Rafael (`10-relatorio-rafael.md` §7.1) usa
 * `uuid_generate_v4()`, da extensão `uuid-ossp`. Desde o PostgreSQL 13,
 * `gen_random_uuid()` é função **do core** — não depende de extensão nenhuma e
 * produz o mesmo UUID v4. Usamos a função do core porque isso remove uma
 * dependência de extensão do caminho de escrita de toda tabela: se um dia o
 * banco for provisionado sem `uuid-ossp` (RDS, staging, testcontainers da
 * US-0.8), o INSERT continua funcionando. A extensão `uuid-ossp` segue
 * garantida pela migração `0000_init` porque o schema lógico de Lucas a
 * referencia e nada impede seu uso pontual futuro.
 *
 * ## Por que `timestamp with time zone` em tudo
 * O produto tem uma janela operacional em fuso explícito (check-in seg 08–10h
 * BRT — `ARQUITETURA.md` §8). `timestamp` sem fuso perderia o offset e a janela
 * viraria uma fonte silenciosa de bug em horário de verão / servidor em UTC.
 */
import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** PK UUID v4 gerada pelo banco. Nunca sequencial: IDs não devem ser enumeráveis. */
export const primaryKeyColumn = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

/**
 * `created_at` / `updated_at` de toda tabela.
 *
 * `updated_at` tem **os dois** mecanismos de propósito:
 *  - `defaultNow()` → garante o valor inicial no INSERT, inclusive em INSERTs que
 *    não passam pelo Drizzle (migração de dados, script de suporte, seed SQL);
 *  - `$onUpdate()` → o Drizzle preenche o valor a cada UPDATE emitido pela aplicação.
 *
 * Não há trigger de banco nesta sprint. Isso é uma escolha consciente e tem um
 * limite conhecido: um UPDATE feito fora do Drizzle não move o `updated_at`. A
 * trigger canônica entra junto com a trilha de auditoria append-only
 * (`ARQUITETURA.md` §8), que é escopo de sprint futura — ver README.
 */
export const timestampColumns = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Timestamp opcional com fuso — atalho para as dezenas de colunas de evento. */
export const eventTimestamp = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Coluna `user_id` — a âncora do tenant isolation.
 *
 * A FK propriamente dita é declarada em cada tabela (`.references(...)`), porque
 * a regra de `ON DELETE` **não** é uniforme e essa diferença é deliberada:
 *  - `CASCADE` só onde o registro é lixo sem o titular (sessão de anamnese
 *    abandonada);
 *  - `RESTRICT` em tudo que compõe prova documental — protocolo assinado por
 *    profissional CREF, consentimento LGPD, assinatura/cobrança, trilha de job
 *    de IA. Um `DELETE FROM users` não pode apagar essas linhas por acidente: o
 *    direito ao esquecimento é atendido por **anonimização** (`users.anonymized_at`),
 *    não por remoção física (`ARQUITETURA.md` §8).
 */
export const userIdColumn = () => uuid('user_id');
