/**
 * Alimentos que o cardápio (plano alimentar e sugestões do WhatsApp) pode usar para um aluno:
 * a base TACO filtrada por restrição alimentar, alergia e o que ele evita, com o que gosta
 * primeiro. As leituras são da base de alimentos (sem dado de titular) e da fatia de segurança
 * do Estado do Aluno (alergias e gostos, só com consentimento de saúde).
 */
import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';

import { foodItems } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import {
  cleanFoodName,
  selectFoodCandidates,
  type FoodCandidate,
  type FoodRow,
} from '../planning/calc/menu';
import { fold, healthRecords } from '../planning/tasks/common';

const LIKED = /alimentos que gosta:\s*([^|]+)/i;
const DISLIKED = /alimentos que evita:\s*([^|]+)/i;

export interface StudentFoodPreferences {
  allergenTerms: string[];
  likedFoods: string | null;
  dislikedFoods: string | null;
}

@Injectable()
export class FoodCandidatesService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly state: StudentStateReader,
  ) {}

  /** Alergias e gostos do aluno, lidos do Estado (vazio sem consentimento de saúde). */
  async preferencesOf(userId: string): Promise<StudentFoodPreferences> {
    const read = await this.state.read(userId, ['safety']);
    const records = healthRecords(read.slices as Record<string, unknown>);
    const notes = records.filter((r) => r.kind === 'NOTES').map((r) => r.summary);
    const find = (pattern: RegExp) =>
      notes.map((note) => pattern.exec(note)?.[1]?.trim()).find((value) => Boolean(value)) ?? null;
    return {
      allergenTerms: records
        .filter((r) => r.kind === 'FOOD_ALLERGY')
        .map((r) => fold(r.summary.replace(/\s*\(.*\)\s*$/, '').trim()))
        .filter((term) => term.length >= 3),
      likedFoods: find(LIKED),
      dislikedFoods: find(DISLIKED),
    };
  }

  private async rows(ids?: readonly string[]): Promise<FoodRow[]> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: foodItems.id,
          name: foodItems.name,
          category: foodItems.category,
          per100g: foodItems.per100g,
        })
        .from(foodItems)
        .where(ids ? inArray(foodItems.id, [...ids]) : eq(foodItems.active, true)),
    );
    return rows;
  }

  /** Lista de alimentos permitidos para o aluno, já ordenada e com teto por categoria. */
  async forStudent(
    userId: string,
    dietaryRestrictions: readonly string[],
  ): Promise<FoodCandidate[]> {
    const [rows, preferences] = await Promise.all([this.rows(), this.preferencesOf(userId)]);
    return selectFoodCandidates(rows, { dietaryRestrictions, ...preferences });
  }

  /** Alimentos pelo id (edição do profissional): sem filtro, com os nutrientes por 100 g. */
  async byIds(ids: readonly string[]): Promise<FoodCandidate[]> {
    if (ids.length === 0) return [];
    return (await this.rows([...new Set(ids)])).map((row) => ({
      id: row.id,
      name: cleanFoodName(row.name),
      category: row.category,
      energyKcal: Math.round(row.per100g.energyKcal),
      proteinG: Math.round(row.per100g.proteinG * 10) / 10,
      carbsG: Math.round(row.per100g.carbsG * 10) / 10,
      fatG: Math.round(row.per100g.fatG * 10) / 10,
      fiberG: Math.round((row.per100g.fiberG ?? 0) * 10) / 10,
    }));
  }
}
