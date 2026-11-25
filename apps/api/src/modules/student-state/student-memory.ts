/**
 * Regras da memória do aluno, sem banco: o que entra, o que só reforça o que já existe e o que
 * sai para a lista não crescer sem fim. Funções puras (o serviço lê e grava).
 */
import type { MemoryKind, MemoryOrigin } from '../../core/database/schema';

export interface MemoryItem {
  kind: MemoryKind;
  text: string;
  importance: 1 | 2 | 3;
  origin: MemoryOrigin;
}

export interface ActiveMemory {
  id: string;
  kind: MemoryKind;
  text: string;
  importance: number;
}

export interface MemoryPlan {
  insert: MemoryItem[];
  bump: Array<{ id: string; importance: number }>;
  retire: string[];
}

/** Fatos ativos por tipo; acima disso os de menor importância (e mais antigos) saem. */
export const MAX_PER_KIND = 10;
/** Teto de fatos novos por chamada: um trecho de conversa não reescreve a memória inteira. */
export const MAX_NEW_PER_CALL = 4;

export function normalizeMemory(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `active` vem do mais novo ao mais antigo. `retireIds` são fatos que o curador marcou como
 * superados (só valem se forem do próprio aluno, o que o serviço garante pelo filtro de `user_id`).
 */
export function planMemoryWrites(
  active: readonly ActiveMemory[],
  incoming: readonly MemoryItem[],
  retireIds: readonly string[] = [],
): MemoryPlan {
  const known = new Set(active.map((a) => a.id));
  const retire = new Set(retireIds.filter((id) => known.has(id)));
  const byText = new Map(active.map((a) => [normalizeMemory(a.text), a]));
  const plan: MemoryPlan = { insert: [], bump: [], retire: [] };
  const seen = new Set<string>();

  for (const item of incoming) {
    if (plan.insert.length >= MAX_NEW_PER_CALL) break;
    const key = normalizeMemory(item.text);
    if (key.length < 5 || seen.has(key)) continue;
    seen.add(key);
    const existing = byText.get(key);
    if (existing) {
      if (item.importance > existing.importance) {
        plan.bump.push({ id: existing.id, importance: item.importance });
      }
      continue;
    }
    plan.insert.push(item);
  }

  // Cabe no teto por tipo: entra o novo, sai o menos importante (e mais antigo) do mesmo tipo.
  for (const kind of new Set(plan.insert.map((i) => i.kind))) {
    const keep = active.filter((a) => a.kind === kind && !retire.has(a.id));
    const room = MAX_PER_KIND - plan.insert.filter((i) => i.kind === kind).length;
    const overflow = keep.length - Math.max(room, 0);
    if (overflow <= 0) continue;
    const victims = [...keep]
      .reverse()
      .sort((a, b) => a.importance - b.importance)
      .slice(0, overflow);
    victims.forEach((v) => retire.add(v.id));
  }
  plan.retire = [...retire];
  return plan;
}
