/**
 * `ExerciseCatalogProvider` — fonte de runtime da base de exercícios (achado 2026-09-02).
 *
 * Mesmo papel que `MethodologyProvider` tem para a metodologia: o array `const` de
 * `exercise-catalog.ts` (`BOOTSTRAP_EXERCISE_CATALOG`) só participa do bootstrap inicial —
 * depois disso, todo consumidor (gerador, validador, substituição de exercício) lê
 * exclusivamente o que está `PUBLISHED` em `exercise_catalog_entries`.
 *
 * ## Por que cache SÍNCRONO, e não `async current()` como a metodologia
 * `ValidationService.validate()` e as funções puras de `exercise-substitution.ts` são
 * chamadas de forma síncrona em código quente (dentro do planner, sem `await`) e por
 * dezenas de testes que instanciam essas classes/funções diretamente, sem harness do Nest.
 * Trocar a assinatura para `async` propagaria `Promise` por toda a cadeia de validação só
 * para ler uma lista que muda raramente (edição administrativa, não por titular). Em vez
 * disso, o snapshot em memória nasce **preenchido de forma síncrona** a partir do bootstrap
 * (nunca vazio) e é substituído em background por `refresh()` — que roda no boot
 * (`onModuleInit`) e sempre que o admin publica/retira uma entrada (`invalidate()`).
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { exerciseCatalogEntries, exerciseCatalogFavorites } from '../../core/database/schema';
import {
  CATALOG_VERSION,
  EXERCISE_CATALOG as BOOTSTRAP_EXERCISE_CATALOG,
  type CatalogExercise,
} from './exercise-catalog';

const REFRESH_MS = 5 * 60_000;

/**
 * Campos de log de uma falha de banco (validação 2026-09-29, int-spec dos favoritos). O
 * Drizzle embrulha o erro do driver: `String(error)` vira só `"Failed query: select ...
 * params: "` e o motivo real (`permission denied for table ...`, SQLSTATE `42501`) fica em
 * `error.cause` — sem isto o warn em produção diria QUE falhou, nunca POR QUE.
 */
function dbErrorFields(error: unknown): { err: string; cause?: string; code?: string } {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return {
    err: String(error),
    ...(cause !== undefined ? { cause: String(cause) } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

/* v8 ignore start -- ramo sintético do `emitDecoratorMetadata` (design:paramtypes), não
 * lógica de aplicação: mesmo achado de `validation.service.ts`, independe de argumento
 * passado ao construtor. */
@Injectable()
/* v8 ignore stop */
export class ExerciseCatalogProvider implements OnModuleInit, OnModuleDestroy {
  /**
   * `Logger` do Nest (roteado ao pino por `app.useLogger` em `main.ts`), e não `PinoLogger`
   * injetado: injetar mudaria a assinatura do construtor usada pelos ~10 `new
   * ValidationService()`/`new ExerciseCatalogProvider()` sem harness do Nest (ver `db` abaixo).
   */
  private readonly logger = new Logger(ExerciseCatalogProvider.name);
  private snapshot: readonly CatalogExercise[] = BOOTSTRAP_EXERCISE_CATALOG;
  private byId: ReadonlyMap<string, CatalogExercise> = new Map(
    BOOTSTRAP_EXERCISE_CATALOG.map((e) => [e.id, e]),
  );
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * `db` é opcional de propósito: os ~10 call sites que hoje fazem `new ValidationService()`
   * (testes unitários sem harness do Nest) continuam funcionando sem tocar banco nenhum —
   * servem o bootstrap pra sempre, o mesmo dado estático de antes desta mudança. Só a
   * instância real, injetada pelo `ProtocolModule`, liga a atualização a partir do banco.
   */
  constructor(private readonly db?: TenantDatabase) {}

  async onModuleInit(): Promise<void> {
    if (!this.db) return;
    await this.ensureBootstrap();
    await this.refresh();
    // Validação 2026-09-29: era `() => void this.refresh()` — uma queda momentânea do banco
    // no tick virava rejeição NÃO tratada, e o Node (>=15) derruba o processo inteiro da API
    // (worker de geração incluso). No timer a falha só é logada: o snapshot anterior segue
    // valendo e o próximo tick (ou um `invalidate()`) tenta de novo.
    this.refreshTimer = setInterval(() => {
      this.refresh().catch((error: unknown) => {
        this.logger.warn(
          { event: 'exercise_catalog_refresh_failed', ...dbErrorFields(error) },
          'refresh periódico do catálogo falhou — mantendo o snapshot anterior',
        );
      });
    }, REFRESH_MS);
    this.refreshTimer.unref?.();
  }

  /** Sem isto o timer sobrevive ao `app.close()` e bate num pool já encerrado. */
  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  getAll(): readonly CatalogExercise[] {
    return this.snapshot;
  }

  getById(id: string): CatalogExercise | undefined {
    return this.byId.get(id);
  }

  isKnown(id: string): boolean {
    return this.byId.has(id);
  }

  /** Chamado pelo admin service depois de publicar/retirar — não espera o timer de 5min. */
  async invalidate(): Promise<void> {
    if (!this.db) return;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.db) return;
    const rows = await this.db.runAsSystem(async (tx) => {
      return tx
        .select()
        .from(exerciseCatalogEntries)
        .orderBy(desc(exerciseCatalogEntries.exerciseKey), desc(exerciseCatalogEntries.version));
    });

    const favoritedKeys = await this.readFavoritedKeys(this.db);

    const latestByKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestByKey.has(row.exerciseKey)) latestByKey.set(row.exerciseKey, row);
    }

    const published: CatalogExercise[] = [];
    for (const row of latestByKey.values()) {
      if (row.status !== 'PUBLISHED') continue;
      published.push({
        id: row.exerciseKey,
        name: row.name,
        pattern: row.pattern,
        muscleGroups: row.muscleGroups,
        equipment: row.equipment,
        locations: row.locations,
        minLevel: row.minLevel,
        contraindicatedFor: row.contraindicatedFor,
        substitutes: row.substitutes,
        ...(row.measurement ? { measurement: row.measurement } : {}),
        ...(row.durationSecondsRange ? { durationSecondsRange: row.durationSecondsRange } : {}),
        ...(row.minRestSeconds != null ? { minRestSeconds: row.minRestSeconds } : {}),
        ...(row.videoUrl ? { videoUrl: row.videoUrl } : {}),
        isFavorite: favoritedKeys.has(row.exerciseKey),
      });
    }

    if (published.length === 0) return; // nunca esvazia o snapshot por uma leitura ruim.
    this.snapshot = published;
    this.byId = new Map(published.map((e) => [e.id, e]));
  }

  /**
   * Chaves favoritadas pelo RT CREF (achado 2026-09-26). Favorito é preferência de
   * prescrição, não conteúdo clínico: uma falha aqui NUNCA pode impedir o snapshot de
   * exercícios de atualizar — degrada para "nenhum favorito" e só avisa no log.
   *
   * Transação própria (não a mesma da leitura do catálogo) de propósito: no Postgres, um
   * erro dentro de uma transação a deixa abortada por inteiro, então um try/catch em volta
   * de uma segunda query na MESMA transação não isolaria de verdade a falha.
   */
  private async readFavoritedKeys(db: TenantDatabase): Promise<ReadonlySet<string>> {
    try {
      const rows = await db.runAsSystem(async (tx) =>
        tx
          .select({ exerciseKey: exerciseCatalogFavorites.exerciseKey })
          .from(exerciseCatalogFavorites),
      );
      return new Set(rows.map((row) => row.exerciseKey));
    } catch (error) {
      this.logger.warn(
        { event: 'exercise_catalog_favorites_read_failed', ...dbErrorFields(error) },
        'leitura de favoritos do catálogo falhou — snapshot segue atualizado, sem favoritos',
      );
      return new Set();
    }
  }

  /**
   * Migração idempotente do array legado pro banco — roda uma vez (advisory lock + `ON
   * CONFLICT DO NOTHING` pela chave natural `(exercise_key, version)`), no mesmo molde do
   * `MethodologyProvider.ensureBootstrap()`. `created_by: NULL` marca a origem como
   * migração automática, não um ator humano.
   */
  private async ensureBootstrap(): Promise<void> {
    if (!this.db) return;
    await this.db.runAsSystem(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('movivo.exercise_catalog.bootstrap'))`,
      );
      const rows = (await tx.execute(
        sql`SELECT count(*)::int AS count FROM exercise_catalog_entries`,
      )) as unknown as Array<{ count: number }>;
      if (Number(rows[0]?.count ?? 0) > 0) return;

      for (const exercise of BOOTSTRAP_EXERCISE_CATALOG) {
        await tx.insert(exerciseCatalogEntries).values({
          exerciseKey: exercise.id,
          name: exercise.name,
          pattern: exercise.pattern,
          muscleGroups: [...exercise.muscleGroups],
          equipment: [...exercise.equipment],
          locations: [...exercise.locations],
          minLevel: exercise.minLevel,
          contraindicatedFor: [...exercise.contraindicatedFor],
          substitutes: [...exercise.substitutes],
          measurement: exercise.measurement ?? null,
          durationSecondsRange: exercise.durationSecondsRange ?? null,
          minRestSeconds: exercise.minRestSeconds ?? null,
          videoUrl: exercise.videoUrl ?? null,
          version: 1,
          status: 'PUBLISHED',
          changeNote: `Migração automática do catálogo legado (${CATALOG_VERSION}).`,
          createdBy: null,
        });
      }
    });
  }
}
