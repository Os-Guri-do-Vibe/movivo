/** Grava o check-in do dia (uma linha por aluno e dia); respostas novas completam as anteriores. */
import { and, eq } from 'drizzle-orm';

import type { DailyCheckIn } from '@movivo/shared';

import { dailyCheckIns } from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';

export type CheckInSource = 'SESSION' | 'DAILY';

export function hasAnswers(checkIn: DailyCheckIn | undefined): checkIn is DailyCheckIn {
  return (
    checkIn !== undefined &&
    [
      checkIn.energy,
      checkIn.sleep,
      checkIn.soreness,
      checkIn.mood,
      checkIn.stress,
      checkIn.nutrition,
    ].some((value) => value !== null && value !== undefined)
  );
}

export async function saveDailyCheckIn(
  tx: TenantTransaction,
  userId: string,
  onDate: string,
  checkIn: DailyCheckIn | undefined,
  source: CheckInSource,
): Promise<void> {
  if (!hasAnswers(checkIn)) return;
  const [existing] = await tx
    .select()
    .from(dailyCheckIns)
    .where(and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.onDate, onDate)));
  // Resposta nova completa a anterior: o que já foi dito no dia não se perde.
  const merged = {
    energy: checkIn.energy ?? existing?.energy ?? null,
    sleep: checkIn.sleep ?? existing?.sleep ?? null,
    soreness: checkIn.soreness ?? existing?.soreness ?? null,
    mood: checkIn.mood ?? existing?.mood ?? null,
    stress: checkIn.stress ?? existing?.stress ?? null,
    nutrition: checkIn.nutrition ?? existing?.nutrition ?? null,
  };
  await tx
    .insert(dailyCheckIns)
    .values({ userId, onDate, source, ...merged })
    .onConflictDoUpdate({
      target: [dailyCheckIns.userId, dailyCheckIns.onDate],
      set: { ...merged, updatedAt: new Date() },
    });
}

/** Soma `ml` à água do dia (registro pelo WhatsApp); devolve o total do dia. */
export async function addWaterToDay(
  tx: TenantTransaction,
  userId: string,
  onDate: string,
  ml: number,
): Promise<number> {
  const [existing] = await tx
    .select({ waterMl: dailyCheckIns.waterMl })
    .from(dailyCheckIns)
    .where(and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.onDate, onDate)));
  const total = Math.min(15_000, (existing?.waterMl ?? 0) + ml);
  await tx
    .insert(dailyCheckIns)
    .values({ userId, onDate, source: 'DAILY', waterMl: total })
    .onConflictDoUpdate({
      target: [dailyCheckIns.userId, dailyCheckIns.onDate],
      set: { waterMl: total, updatedAt: new Date() },
    });
  return total;
}
