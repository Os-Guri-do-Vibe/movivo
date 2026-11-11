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

/** Gostos e aversões de comida que o aluno declarou depois da anamnese (pelo WhatsApp). */
export function declaredFoodPreferences(slice: unknown): { liked: string[]; disliked: string[] } {
  const rows = Array.isArray(slice)
    ? (slice as { domain?: string; key?: string; value?: unknown }[])
    : [];
  const foods = (value: 'LIKES' | 'DISLIKES') =>
    rows
      .filter((row) => row.domain === 'FOOD' && row.value === value && row.key?.startsWith('food:'))
      .map((row) => (row.key as string).slice('food:'.length).replaceAll('_', ' '));
  return { liked: foods('LIKES'), disliked: foods('DISLIKES') };
}

/**
 * Junta a anamnese com o que o aluno declarou depois. O mais recente vence: se ele disse na
 * anamnese que evita peixe e depois contou que passou a gostar, o peixe sai da lista do que evita
 * (e o contrário).
 */
export function mergeFoodPreferences(
  anamnesis: { liked: string | null; disliked: string | null },
  declared: { liked: readonly string[]; disliked: readonly string[] },
): { likedFoods: string | null; dislikedFoods: string | null } {
  const pieces = (text: string | null) =>
    (text ?? '')
      .split(/[,;/]|\s+e\s+/i)
      .map((piece) => piece.trim())
      .filter(Boolean);
  const without = (list: string[], overridden: readonly string[]) =>
    list.filter((piece) => !overridden.some((food) => fold(piece).includes(fold(food))));
  const liked = [...without(pieces(anamnesis.liked), declared.disliked), ...declared.liked];
  const disliked = [...without(pieces(anamnesis.disliked), declared.liked), ...declared.disliked];
  return {
    likedFoods: liked.length > 0 ? liked.join(', ') : null,
    dislikedFoods: disliked.length > 0 ? disliked.join(', ') : null,
  };
}

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
    const read = await this.state.read(userId, ['safety', 'preferences']);
    const records = healthRecords(read.slices as Record<string, unknown>);
    const notes = records.filter((r) => r.kind === 'NOTES').map((r) => r.summary);
    const find = (pattern: RegExp) =>
      notes.map((note) => pattern.exec(note)?.[1]?.trim()).find((value) => Boolean(value)) ?? null;
    const declared = declaredFoodPreferences(read.slices.preferences);
    return {
      allergenTerms: records
        .filter((r) => r.kind === 'FOOD_ALLERGY')
        .map((r) => fold(r.summary.replace(/\s*\(.*\)\s*$/, '').trim()))
        .filter((term) => term.length >= 3),
      ...mergeFoodPreferences({ liked: find(LIKED), disliked: find(DISLIKED) }, declared),
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
