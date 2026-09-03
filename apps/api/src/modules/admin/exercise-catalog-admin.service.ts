import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  publishExerciseCatalogEntrySchema,
  retireExerciseCatalogEntrySchema,
  type CatalogExerciseCandidate,
  type ExerciseCatalogResponse,
} from '@movivo/shared';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';

import { exerciseCatalogEntries, users } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;

/**
 * Admin do catálogo de exercícios (achado 2026-09-02) — mesmo molde do `FaqAdminService`:
 * `PUBLISHED`/`RETIRED` diretos (sem estágio de aprovação separado). A garantia de segurança
 * clínica é do `ValidationService`, que lê a mesma base publicada como gabarito — publicar
 * uma entrada aqui não abre exceção nenhuma pra ela: se ficar contraindicada por alguma tag,
 * o validador continua vetando exatamente como faria com qualquer outra entrada do catálogo.
 */
@Injectable()
export class ExerciseCatalogAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly catalog: ExerciseCatalogProvider,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<ExerciseCatalogResponse> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: exerciseCatalogEntries.id,
          exerciseKey: exerciseCatalogEntries.exerciseKey,
          name: exerciseCatalogEntries.name,
          pattern: exerciseCatalogEntries.pattern,
          muscleGroups: exerciseCatalogEntries.muscleGroups,
          equipment: exerciseCatalogEntries.equipment,
          locations: exerciseCatalogEntries.locations,
          minLevel: exerciseCatalogEntries.minLevel,
          contraindicatedFor: exerciseCatalogEntries.contraindicatedFor,
          substitutes: exerciseCatalogEntries.substitutes,
          measurement: exerciseCatalogEntries.measurement,
          durationSecondsRange: exerciseCatalogEntries.durationSecondsRange,
          minRestSeconds: exerciseCatalogEntries.minRestSeconds,
          videoUrl: exerciseCatalogEntries.videoUrl,
          version: exerciseCatalogEntries.version,
          status: exerciseCatalogEntries.status,
          changeNote: exerciseCatalogEntries.changeNote,
          createdAt: exerciseCatalogEntries.createdAt,
          createdBy: users.name,
        })
        .from(exerciseCatalogEntries)
        .leftJoin(users, eq(users.id, exerciseCatalogEntries.createdBy))
        .orderBy(desc(exerciseCatalogEntries.exerciseKey), desc(exerciseCatalogEntries.version)),
    );

    const currentKeys = new Set<string>();
    const versions = rows.map((row) => {
      const current = !currentKeys.has(row.exerciseKey);
      currentKeys.add(row.exerciseKey);
      return {
        ...row,
        measurement: row.measurement ?? undefined,
        durationSecondsRange: row.durationSecondsRange ?? undefined,
        minRestSeconds: row.minRestSeconds ?? undefined,
        videoUrl: row.videoUrl ?? undefined,
        createdAt: row.createdAt.toISOString(),
        current,
      };
    });
    return this.envelope({
      versions,
      totalPublished: versions.filter((v) => v.current && v.status === 'PUBLISHED').length,
    });
  }

  async publish(actor: AuthenticatedUser, body: unknown): Promise<ExerciseCatalogResponse> {
    const input = this.parse(publishExerciseCatalogEntrySchema, body);
    await this.validateSubstitutes(input.exerciseKey, input.substitutes);
    await this.insertVersion(
      actor,
      input.exerciseKey,
      input,
      input.changeNote,
      'PUBLISHED',
      'exercise_catalog.publish',
    );
    return this.list();
  }

  async retire(actor: AuthenticatedUser, body: unknown): Promise<ExerciseCatalogResponse> {
    const input = this.parse(retireExerciseCatalogEntrySchema, body);
    const [current] = await this.db.runAsSystem((tx) =>
      tx
        .select()
        .from(exerciseCatalogEntries)
        .where(eq(exerciseCatalogEntries.exerciseKey, input.exerciseKey))
        .orderBy(desc(exerciseCatalogEntries.version))
        .limit(1),
    );
    if (!current) throw new NotFoundException('Exercício inexistente.');
    if (current.status === 'RETIRED') {
      throw new BadRequestException('O exercício já está retirado.');
    }
    const candidate: CatalogExerciseCandidate = {
      name: current.name,
      pattern: current.pattern,
      muscleGroups: current.muscleGroups,
      equipment: current.equipment,
      locations: current.locations,
      minLevel: current.minLevel,
      contraindicatedFor: current.contraindicatedFor,
      substitutes: current.substitutes,
      ...(current.measurement ? { measurement: current.measurement } : {}),
      ...(current.durationSecondsRange
        ? { durationSecondsRange: current.durationSecondsRange }
        : {}),
      ...(current.minRestSeconds != null ? { minRestSeconds: current.minRestSeconds } : {}),
      ...(current.videoUrl ? { videoUrl: current.videoUrl } : {}),
    };
    await this.insertVersion(
      actor,
      input.exerciseKey,
      candidate,
      input.changeNote,
      'RETIRED',
      'exercise_catalog.retire',
    );
    return this.list();
  }

  /**
   * Substituto tem que ser um exercício conhecido (publicado ou não — evita corrida entre
   * duas propostas relacionadas) e nunca o próprio exercício. Preferência curada errada é
   * cosmético; `ValidationService`/`findSafeSubstitute` continuam sendo o veto real, mas um
   * id inexistente aqui já nasceria morto (a IA nunca o encontraria como substituto).
   */
  private async validateSubstitutes(exerciseKey: string, substitutes: string[]): Promise<void> {
    if (substitutes.includes(exerciseKey)) {
      throw new BadRequestException('Um exercício não pode ser substituto de si mesmo.');
    }
    if (substitutes.length === 0) return;
    const known = await this.db.runAsSystem((tx) =>
      tx
        .selectDistinct({ exerciseKey: exerciseCatalogEntries.exerciseKey })
        .from(exerciseCatalogEntries)
        .where(inArray(exerciseCatalogEntries.exerciseKey, substitutes)),
    );
    const knownKeys = new Set(known.map((k) => k.exerciseKey));
    const missing = substitutes.filter((s) => !knownKeys.has(s));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Substituto(s) inexistente(s) no catálogo: ${missing.join(', ')}`,
      );
    }
  }

  private async insertVersion(
    actor: AuthenticatedUser,
    exerciseKey: string,
    candidate: CatalogExerciseCandidate,
    changeNote: string,
    status: 'PUBLISHED' | 'RETIRED',
    action: string,
  ): Promise<void> {
    await this.db.runAsSystem(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`exercise-catalog:${exerciseKey}`}, 0))`,
      );
      const version = await this.nextVersion(tx, exerciseKey);
      const [inserted] = await tx
        .insert(exerciseCatalogEntries)
        .values({
          exerciseKey,
          name: candidate.name,
          pattern: candidate.pattern,
          muscleGroups: candidate.muscleGroups,
          equipment: candidate.equipment,
          locations: candidate.locations,
          minLevel: candidate.minLevel,
          contraindicatedFor: candidate.contraindicatedFor,
          substitutes: candidate.substitutes,
          measurement: candidate.measurement ?? null,
          durationSecondsRange: candidate.durationSecondsRange ?? null,
          minRestSeconds: candidate.minRestSeconds ?? null,
          videoUrl: candidate.videoUrl ?? null,
          version,
          status,
          changeNote,
          createdBy: actor.userId,
        })
        .returning({ id: exerciseCatalogEntries.id });
      if (!inserted) throw new BadRequestException('Não foi possível publicar o exercício.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action,
        entityType: 'exercise_catalog_entry',
        entityId: inserted.id,
        changes: { exerciseKey, version, status, changeNote },
      });
    });
    await this.catalog.invalidate();
  }

  private async nextVersion(tx: TenantTransaction, exerciseKey: string): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${exerciseCatalogEntries.version}), 0)::int` })
      .from(exerciseCatalogEntries)
      .where(eq(exerciseCatalogEntries.exerciseKey, exerciseKey));
    return Number(row?.max ?? 0) + 1;
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
    }
    return result.data;
  }

  private envelope<T>(data: T) {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }
}
