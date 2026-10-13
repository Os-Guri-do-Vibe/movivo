/**
 * Alunos elegíveis às mensagens proativas de treino e utilidades de fuso local, usadas pela
 * varredura por minuto do link diário (`WorkoutScheduler`, 04:00) e pela política que decide se
 * ele leva a pergunta sobre o treino sem registro (`MissedWorkoutAskPolicy`).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { CONSENT_TEXTS } from '@movivo/shared';

import { consents, protocols, subscriptions, users } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';

export interface EligibleStudent {
  userId: string;
  name: string | null;
  timezone: string;
}

/** Protocolo ativo, assinatura ativa/em trial e consentimento de saúde vigente. */
export function loadEligibleStudents(db: TenantDatabase): Promise<EligibleStudent[]> {
  return db.runAsSystem((tx) =>
    tx
      .selectDistinct({
        userId: protocols.userId,
        name: users.name,
        timezone: users.timezone,
      })
      .from(protocols)
      .innerJoin(users, eq(users.id, protocols.userId))
      .innerJoin(subscriptions, eq(subscriptions.userId, protocols.userId))
      .innerJoin(
        consents,
        and(
          eq(consents.userId, protocols.userId),
          eq(consents.consentType, 'HEALTH_DATA'),
          eq(consents.version, CONSENT_TEXTS.HEALTH_DATA.version),
          eq(consents.accepted, true),
          isNull(consents.revokedAt),
        ),
      )
      .where(
        and(eq(protocols.status, 'ACTIVE'), inArray(subscriptions.status, ['ACTIVE', 'TRIALING'])),
      ),
  );
}

/** Data (`YYYY-MM-DD`) e hora (`HH:mm`) locais; `null` se o fuso do aluno for inválido. */
export function localParts(now: Date, timezone: string): { date: string; time: string } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${value.year}-${value.month}-${value.day}`,
      time: `${value.hour}:${value.minute}`,
    };
  } catch {
    return null;
  }
}

/** Dia civil anterior a `date` (`YYYY-MM-DD`). Meio-dia UTC evita virada por horário de verão. */
export function previousDay(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

export function firstNameOf(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'atleta';
}

/** Instante (UTC) em que o dia civil `date` começa no fuso `timezone` (meia-noite local). */
export function localMidnightUtc(date: string, timezone: string): Date {
  const guess = new Date(`${date}T00:00:00.000Z`);
  const parts = localParts(guess, timezone);
  if (!parts) return guess;
  const wallClock = Date.parse(`${parts.date}T${parts.time}:00.000Z`);
  return new Date(guess.getTime() - (wallClock - guess.getTime()));
}

/** Dia da semana curto em pt-BR para `YYYY-MM-DD` ("sexta", "sábado"), sem "-feira". */
export function shortWeekdayName(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00.000Z`))
    .replace('-feira', '');
}
