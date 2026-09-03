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
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { exerciseCatalogEntries } from '../../core/database/schema';
import {
  CATALOG_VERSION,
  EXERCISE_CATALOG as BOOTSTRAP_EXERCISE_CATALOG,
  type CatalogExercise,
} from './exercise-catalog';

const REFRESH_MS = 5 * 60_000;

/* v8 ignore start -- ramo sintético do `emitDecoratorMetadata` (design:paramtypes), não
 * lógica de aplicação: mesmo achado de `validation.service.ts`, independe de argumento
 * passado ao construtor. */
@Injectable()
/* v8 ignore stop */
export class ExerciseCatalogProvider implements OnModuleInit {
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
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.refreshTimer.unref?.();
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
      });
    }

    if (published.length === 0) return; // nunca esvazia o snapshot por uma leitura ruim.
    this.snapshot = published;
    this.byId = new Map(published.map((e) => [e.id, e]));
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
