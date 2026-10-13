import { Injectable } from '@nestjs/common';
import { and, eq, gte, or } from 'drizzle-orm';

import { handoffAlerts } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import {
  ATTENDANCE_COOLDOWN_DAYS,
  ATTENDANCE_RATE_REASON,
  ATTENDANCE_STREAK_REASON,
  ATTENDANCE_WINDOW_DAYS,
  type AttendanceFinding,
  deterministicUuid,
  evaluateAttendance,
} from './attendance-alert';
import { previousDay } from './workout-eligibility';
import { WorkoutJournalService } from './workout-journal.service';

const DAY_MS = 86_400_000;

/** Origem do alerta no painel (`handoff_alerts.source_type`, máx. 30 caracteres). */
const SOURCE_TYPE = {
  [ATTENDANCE_STREAK_REASON]: 'ATTENDANCE_STREAK',
  [ATTENDANCE_RATE_REASON]: 'ATTENDANCE_RATE',
} as const;

/**
 * Abre, no painel do profissional CREF, o alerta de frequência do aluno. Roda uma vez por dia
 * na varredura das 04:00, depois de os dias anteriores já terem fechado.
 *
 * Idempotência em duas camadas: a chave única da origem (`uq_handoff_alerts_source`) protege
 * um retry da varredura; o período de espera por motivo impede que a mesma ausência, que
 * continua dentro da janela nos dias seguintes, reabra o alerta a cada manhã.
 */
@Injectable()
export class AttendanceAlertService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly journal: WorkoutJournalService,
    private readonly queueEvents: DashboardQueueEventsService,
  ) {}

  /** O achado que abriu um alerta novo nesta chamada, ou `null`. */
  async check(userId: string, today: string, now: Date): Promise<AttendanceFinding | null> {
    const window = await this.journal.attendanceWindow(userId, today, now, ATTENDANCE_WINDOW_DAYS);
    const finding = evaluateAttendance(window);
    if (!finding) return null;
    if (await this.hasRecentAlert(userId, finding.reason, now)) return null;

    const sourceKey =
      finding.reason === ATTENDANCE_STREAK_REASON
        ? `${userId}|${finding.reason}|${finding.streakStart}`
        : `${userId}|${finding.reason}|${previousDay(today)}`;
    const inserted = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(handoffAlerts)
        .values({
          userId,
          level: 'ALERT',
          reason: finding.reason,
          sourceType: SOURCE_TYPE[finding.reason],
          sourceId: deterministicUuid(sourceKey),
        })
        .onConflictDoNothing()
        .returning({ id: handoffAlerts.id }),
    );
    if (inserted.length === 0) return null;
    this.queueEvents.emit('handoff');
    return finding;
  }

  private async hasRecentAlert(
    userId: string,
    reason: AttendanceFinding['reason'],
    now: Date,
  ): Promise<boolean> {
    const since = new Date(now.getTime() - ATTENDANCE_COOLDOWN_DAYS[reason] * DAY_MS);
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ id: handoffAlerts.id })
        .from(handoffAlerts)
        .where(
          and(
            eq(handoffAlerts.userId, userId),
            eq(handoffAlerts.reason, reason),
            or(eq(handoffAlerts.status, 'OPEN'), gte(handoffAlerts.createdAt, since)),
          ),
        )
        .limit(1),
    );
    return rows.length > 0;
  }
}
