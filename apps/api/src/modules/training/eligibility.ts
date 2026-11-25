/** Alunos elegíveis ao link diário e utilidades de fuso local. */
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { CONSENT_TEXTS } from '@movivo/shared';

import { consents, subscriptions, trainingPlans, users } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';

export interface EligibleStudent {
  userId: string;
  name: string | null;
  timezone: string;
}

/** Plano de treino ativo, assinatura ativa/em trial e consentimento de saúde vigente. */
export function loadEligibleStudents(db: TenantDatabase): Promise<EligibleStudent[]> {
  return db.runAsSystem((tx) =>
    tx
      .selectDistinct({ userId: trainingPlans.userId, name: users.name, timezone: users.timezone })
      .from(trainingPlans)
      .innerJoin(users, eq(users.id, trainingPlans.userId))
      .innerJoin(subscriptions, eq(subscriptions.userId, trainingPlans.userId))
      .innerJoin(
        consents,
        and(
          eq(consents.userId, trainingPlans.userId),
          eq(consents.consentType, 'HEALTH_DATA'),
          eq(consents.version, CONSENT_TEXTS.HEALTH_DATA.version),
          eq(consents.accepted, true),
          isNull(consents.revokedAt),
        ),
      )
      .where(
        and(
          eq(trainingPlans.status, 'ACTIVE'),
          inArray(subscriptions.status, ['ACTIVE', 'TRIALING']),
        ),
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

export function firstNameOf(name: string | null): string {
  return name?.trim().split(/\s+/)[0] || 'atleta';
}
