import { BadRequestException, Injectable } from '@nestjs/common';
import { importTacoSchema, type TacoCatalogResponse, type TacoFoodsResponse } from '@movivo/shared';
import { eq, sql } from 'drizzle-orm';

import { foodItems } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { strictSafeParse } from '../../core/validation/strict-input';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { FoodCatalogService } from '../catalog/foods/food-catalog.service';
import { parseTacoCsv, tacoImplausibility } from '../catalog/foods/taco-csv';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;
/** Quantos problemas listar na recusa: o bastante para achar a coluna errada, sem despejar o arquivo. */
const MAX_REPORTED_PROBLEMS = 5;

/** Importação e consulta da TACO pelo painel (Base de Conhecimento → TACO). */
@Injectable()
export class TacoAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly foods: FoodCatalogService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<TacoCatalogResponse> {
    return this.envelope(await this.summary(null));
  }

  /**
   * Todos os alimentos ativos da base: os da TACO e os complementos (`origin`), na ordem da
   * planilha (pelo número). São ~600 linhas, então a tela ordena, filtra e pagina no navegador,
   * sem uma consulta por clique.
   */
  async listFoods(): Promise<TacoFoodsResponse> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: foodItems.id,
          source: foodItems.source,
          sourceCode: foodItems.sourceCode,
          name: foodItems.name,
          category: foodItems.category,
          per100g: foodItems.per100g,
        })
        .from(foodItems)
        .where(eq(foodItems.active, true)),
    );
    const foods = rows
      .flatMap(({ source, sourceCode, ...food }) => {
        if (!sourceCode) return [];
        // Complemento: o código vem prefixado pela fonte (`USDA-458`).
        const dash = source === 'TACO' ? -1 : sourceCode.indexOf('-');
        return [
          dash > 0
            ? { ...food, origin: sourceCode.slice(0, dash), code: sourceCode.slice(dash + 1) }
            : { ...food, origin: source === 'TACO' ? null : 'Equipe', code: sourceCode },
        ];
      })
      .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric: true }));
    return {
      data: { foods },
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }

  async importCsv(actor: AuthenticatedUser, body: unknown): Promise<TacoCatalogResponse> {
    const result = strictSafeParse(importTacoSchema, body);
    if (!result.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
    }
    const { csv, fileName } = result.data;

    let parsed: ReturnType<typeof parseTacoCsv>;
    try {
      parsed = parseTacoCsv(csv);
    } catch (error) {
      throw new BadRequestException({
        code: 'INVALID_TACO_CSV',
        message: error instanceof Error ? error.message : 'CSV da TACO ilegível.',
      });
    }
    if (parsed.foods.length === 0) {
      throw new BadRequestException({
        code: 'INVALID_TACO_CSV',
        message: 'Nenhum alimento com energia e macronutrientes foi encontrado no arquivo.',
      });
    }
    const problems = parsed.foods.flatMap((food) => {
      const problem = tacoImplausibility(food);
      return problem ? [`${food.sourceCode} ${food.name}: ${problem}`] : [];
    });
    if (problems.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_TACO_CSV',
        message: `Valores fora do esperado (${problems.length} alimento(s)); nada foi importado. Ex.: ${problems
          .slice(0, MAX_REPORTED_PROBLEMS)
          .join('; ')}.`,
      });
    }

    const imported = await this.foods.importTaco(parsed.foods);
    await this.db.runAsSystem((tx) =>
      this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'taco.import',
        entityType: 'food_catalog',
        entityId: actor.userId,
        changes: { imported, skipped: parsed.skipped, fileName: fileName ?? null },
      }),
    );
    return this.envelope(await this.summary({ imported, skipped: parsed.skipped }));
  }

  private async summary(lastImport: { imported: number; skipped: number } | null) {
    return this.db.runAsSystem(async (tx) => {
      const counts = await tx
        .select({ source: foodItems.source, total: sql<number>`count(*)::int` })
        .from(foodItems)
        .where(eq(foodItems.active, true))
        .groupBy(foodItems.source);
      const categories = await tx
        .select({ name: foodItems.category, count: sql<number>`count(*)::int` })
        .from(foodItems)
        .where(sql`${foodItems.source} = 'TACO' and ${foodItems.active}`)
        .groupBy(foodItems.category)
        .orderBy(foodItems.category);
      const [latest] = await tx
        .select({ at: sql<Date | null>`max(${foodItems.updatedAt})` })
        .from(foodItems)
        .where(eq(foodItems.source, 'TACO'));
      const total = (source: string) => counts.find((row) => row.source === source)?.total ?? 0;
      return {
        tacoCount: total('TACO'),
        otherCount: counts.reduce((sum, row) => sum + row.total, 0) - total('TACO'),
        lastImportedAt: latest?.at ? new Date(latest.at).toISOString() : null,
        categories,
        lastImport,
      };
    });
  }

  private envelope(data: TacoCatalogResponse['data']): TacoCatalogResponse {
    return {
      data,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }
}
