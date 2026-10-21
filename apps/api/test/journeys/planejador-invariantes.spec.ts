/**
 * Invariantes do planejador da agenda flexível sob cadeias ALEATÓRIAS de pedidos (teste de
 * propriedade, semente fixa para reprodução). Os specs do planejador provam casos escolhidos;
 * aqui milhares de semanas e sequências de pedidos verificam as regras do fundador que nenhum
 * pedido pode quebrar:
 *
 *  - um treino por dia e a semana nunca passa da cota contratada;
 *  - dia treinado (travado) nunca muda;
 *  - dia passado só muda para soltar um treino sem registro que foi trazido para hoje em diante;
 *  - TREINAR/DESCANSAR nunca duplicam uma sessão nem somem com uma (exceto o que o aluno deixou
 *    de fora);
 *  - o mesmo pedido sobre a mesma semana dá sempre o mesmo arranjo (a IA não decide nada).
 *
 * Unitário puro (roda no `vitest run` do app).
 */
import type { ProtocolStructure, Weekday } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  type AdjustmentRequest,
  buildWeekSlots,
  type PlanResult,
  planScheduleChange,
  type WeekSlot,
  weekDates,
} from '../../src/modules/workout/schedule-planner';

const WEEK = weekDates('2026-10-19');
const WEEKDAYS: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** PRNG determinístico (mulberry32): a mesma semente reproduz a mesma falha. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Scenario {
  structure: ProtocolStructure;
  quota: number;
  keys: string[];
  today: string;
  slots: WeekSlot[];
}

function scenario(random: () => number): Scenario {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;
  const frequency = 1 + Math.floor(random() * 6);
  const days = [...WEEKDAYS].sort(() => random() - 0.5).slice(0, frequency);
  const keys = days.map((_, index) => `S${index + 1}`);
  const structure = {
    weeklyFrequency: frequency,
    sessions: days.map((weekday, index) => ({
      dayLabel: keys[index],
      weekday,
      focus: keys[index],
    })),
  } as unknown as ProtocolStructure;
  const today = pick(WEEK);
  // Parte dos dias passados de treino foi feita (travada); o resto ficou sem registro.
  const sessionsByDate = new Map<
    string,
    { status: 'COMPLETED' | 'IN_PROGRESS'; sessionKey: string }
  >();
  const initial = buildWeekSlots({
    today,
    firstProtocolDate: '2026-09-01',
    structure,
    sessionsByDate,
  });
  for (const slot of initial) {
    if (slot.sessionKey && slot.date < today && random() < 0.5) {
      sessionsByDate.set(slot.date, { status: 'COMPLETED', sessionKey: slot.sessionKey });
    }
    if (slot.sessionKey && slot.date === today && random() < 0.15) {
      sessionsByDate.set(slot.date, { status: 'IN_PROGRESS', sessionKey: slot.sessionKey });
    }
  }
  return {
    structure,
    quota: frequency,
    keys,
    today,
    slots: buildWeekSlots({ today, firstProtocolDate: '2026-09-01', structure, sessionsByDate }),
  };
}

function randomRequest(random: () => number, world: Scenario): AdjustmentRequest {
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;
  const date = pick(WEEK);
  if (random() < 0.5) {
    const withKey = random() < 0.7;
    return {
      kind: 'TRAIN_ON',
      date,
      ...(withKey ? { sessionKey: random() < 0.95 ? pick(world.keys) : 'X' } : {}),
    };
  }
  return { kind: 'REST_ON', date };
}

const ALLOWED_REFUSALS = new Set([
  'PAST_DATE',
  'OUT_OF_WEEK',
  'DAY_LOCKED',
  'UNKNOWN_SESSION',
  'ALREADY_DONE',
  'QUOTA_REACHED',
  'NOTHING_PENDING',
  'FULL_WEEK',
]);

function keysOf(slots: readonly WeekSlot[]): string[] {
  return slots.flatMap((slot) => (slot.sessionKey ? [slot.sessionKey] : [])).sort();
}

/** Verifica as regras do fundador para um plano aplicado sobre `before`. */
function checkInvariants(world: Scenario, before: WeekSlot[], result: PlanResult): void {
  if (!result.ok) {
    expect(ALLOWED_REFUSALS.has(result.reason)).toBe(true);
    if (result.reason === 'FULL_WEEK') {
      for (const candidate of result.candidates) {
        const slot = before.find((item) => item.date === candidate.date);
        expect(slot?.locked).toBe(false);
        expect(slot?.sessionKey).toBe(candidate.sessionKey);
      }
    }
    return;
  }
  const after = result.slots;
  expect(after.map((slot) => slot.date)).toEqual(before.map((slot) => slot.date));
  expect(result.noop).toBe(result.changes.length === 0);

  // Cota: a semana nunca passa dos treinos contratados (nem do que já tinha, se já passava).
  const beforeKeys = keysOf(before);
  const afterKeys = keysOf(after);
  expect(afterKeys.length).toBeLessThanOrEqual(Math.max(world.quota, beforeKeys.length));

  // Sem duplicar sessão: cada chave aparece no máximo uma vez a mais do que já aparecia.
  for (const key of new Set(afterKeys)) {
    const count = (list: string[]) => list.filter((item) => item === key).length;
    expect(count(afterKeys)).toBeLessThanOrEqual(Math.max(1, count(beforeKeys)));
  }
  // Nada some sem o aluno pedir: o que estava na semana segue lá, salvo o que ficou de fora.
  for (const key of beforeKeys) {
    if (result.dropped.includes(key)) continue;
    expect(afterKeys).toContain(key);
  }

  after.forEach((slot, index) => {
    const previous = before[index] as WeekSlot;
    if (previous.locked) expect(slot).toEqual(previous);
    if (slot.date < world.today && slot.sessionKey !== previous.sessionKey) {
      // Dia passado só solta um treino sem registro que foi trazido para hoje em diante.
      expect(slot.sessionKey).toBeNull();
      const moved = after.find(
        (other) => other.date >= world.today && other.sessionKey === previous.sessionKey,
      );
      expect(moved).toBeDefined();
    }
  });
}

describe('planejador: invariantes sob cadeias aleatórias de pedidos', () => {
  it('2.000 semanas, até 5 pedidos encadeados cada, sem quebrar nenhuma regra', () => {
    let applied = 0;
    let refused = 0;
    let leftOut = 0;
    for (let seed = 1; seed <= 2_000; seed += 1) {
      const random = rng(seed);
      const world = scenario(random);
      let slots = world.slots;
      const steps = 1 + Math.floor(random() * 5);
      for (let step = 0; step < steps; step += 1) {
        const request = randomRequest(random, world);
        const input = {
          today: world.today,
          slots,
          quota: world.quota,
          sessionKeys: world.keys,
          request,
        };
        let result = planScheduleChange(input);
        // Determinismo: a mesma entrada dá o mesmo arranjo.
        expect(planScheduleChange(input)).toEqual(result);
        checkInvariants(world, slots, result);

        // Semana cheia: o aluno escolhe um dos candidatos e o pedido é refeito.
        if (!result.ok && result.reason === 'FULL_WEEK' && result.candidates.length > 0) {
          const choice = result.candidates[Math.floor(random() * result.candidates.length)];
          if (request.kind !== 'REORGANIZE' && choice) {
            result = planScheduleChange({ ...input, request: { ...request, leaveOut: [choice] } });
            checkInvariants(world, slots, result);
            if (result.ok) leftOut += 1;
          }
        }
        if (result.ok) {
          applied += 1;
          // Como o banco devolve a semana: o que já estava travado continua travado.
          slots = result.slots;
        } else {
          refused += 1;
        }
      }
    }
    // A amostra precisa exercitar os três caminhos, senão o teste não prova nada.
    expect(applied).toBeGreaterThan(1_000);
    expect(refused).toBeGreaterThan(200);
    expect(leftOut).toBeGreaterThan(20);
  });
});
