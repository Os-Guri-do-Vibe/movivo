/**
 * Sinais de segurança no banco: gravar, consultar os ativos e resolver.
 *
 * Um sinal ativo suspende as ações automáticas do seu escopo (motor de políticas). Sinal
 * URGENTE ou de EMERGÊNCIA abre caso prioritário na fila da equipe na mesma transação, com o
 * evento de domínio correspondente. O mesmo tipo de sinal já ativo não é duplicado.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { safetyDomainOf } from '@movivo/shared';
import type { SafetyScope, SafetySeverity, SafetySignal } from '@movivo/shared';

import { exceptionCases, safetyEvents } from '../../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../../core/database/tenant-database.service';
import { DomainEventRecorder } from '../../domain-events/domain-event-recorder';
import { OutboxRelay } from '../../domain-events/outbox-relay';

export type SignalSource = 'RULE' | 'DETECTOR' | 'STAFF';

export interface ActiveSignal {
  id: string;
  kind: string;
  severity: SafetySeverity;
  scope: SafetyScope;
}

const PRIORITY: Readonly<Record<SafetySeverity, 'NORMAL' | 'HIGH' | 'URGENT'>> = {
  ATTENTION: 'NORMAL',
  URGENT: 'HIGH',
  EMERGENCY: 'URGENT',
};

@Injectable()
export class SafetyService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly events: DomainEventRecorder,
    private readonly outbox: OutboxRelay,
  ) {}

  async activeSignals(userId: string): Promise<ActiveSignal[]> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: safetyEvents.id,
          kind: safetyEvents.kind,
          severity: safetyEvents.severity,
          scope: safetyEvents.scope,
        })
        .from(safetyEvents)
        .where(and(eq(safetyEvents.userId, userId), eq(safetyEvents.status, 'ACTIVE'))),
    );
    return rows.map((row) => ({
      ...row,
      severity: row.severity as SafetySeverity,
      scope: row.scope as SafetyScope,
    }));
  }

  /** Grava os sinais (numa transação própria) e publica os eventos. Devolve os ids criados. */
  async raise(
    userId: string,
    signals: readonly SafetySignal[],
    source: SignalSource,
  ): Promise<string[]> {
    if (signals.length === 0) return [];
    const ids = await this.db.runAsSystem((tx) => this.raiseIn(tx, userId, signals, source));
    if (ids.length > 0) await this.outbox.flushSoon();
    return ids;
  }

  /** Versão transacional, para quem grava o sinal junto de outra mudança de estado. */
  async raiseIn(
    tx: TenantTransaction,
    userId: string,
    signals: readonly SafetySignal[],
    source: SignalSource,
  ): Promise<string[]> {
    const active = await tx
      .select({ kind: safetyEvents.kind })
      .from(safetyEvents)
      .where(and(eq(safetyEvents.userId, userId), eq(safetyEvents.status, 'ACTIVE')));
    const activeKinds = new Set(active.map((row) => row.kind));
    const created: string[] = [];
    for (const signal of signals) {
      if (activeKinds.has(signal.kind)) continue;
      const [row] = await tx
        .insert(safetyEvents)
        .values({
          userId,
          kind: signal.kind,
          severity: signal.severity,
          scope: signal.scope,
          detectedBy: source,
          evidence: signal.evidence,
        })
        .returning({ id: safetyEvents.id });
      if (!row) throw new Error('falha ao gravar sinal de segurança');
      created.push(row.id);
      activeKinds.add(signal.kind);
      await this.events.record(tx, {
        userId,
        type: 'SafetySignalRaised',
        payload: { safetyEventId: row.id, kind: signal.kind, severity: signal.severity },
      });
      if (signal.severity !== 'ATTENTION') {
        const [exception] = await tx
          .insert(exceptionCases)
          .values({
            userId,
            kind: 'SAFETY',
            priority: PRIORITY[signal.severity],
            domain: safetyDomainOf(signal.kind, signal.scope),
            subject: { safetyEventId: row.id },
            summary: `Sinal de segurança: ${signal.kind} (${signal.severity}). ${signal.evidence}`,
          })
          .returning({ id: exceptionCases.id });
        if (!exception) throw new Error('falha ao abrir caso de segurança');
        await this.events.record(tx, {
          userId,
          type: 'ExceptionOpened',
          payload: { exceptionCaseId: exception.id, kind: 'SAFETY' },
        });
      }
    }
    return created;
  }

  async resolve(safetyEventId: string, staffId: string, note: string): Promise<void> {
    await this.db.runAsSystem(async (tx) => {
      const [event] = await tx
        .select({ status: safetyEvents.status })
        .from(safetyEvents)
        .where(eq(safetyEvents.id, safetyEventId));
      if (!event) throw new NotFoundException('sinal de segurança não encontrado');
      if (event.status !== 'ACTIVE') throw new ConflictException('sinal já resolvido');
      await tx
        .update(safetyEvents)
        .set({
          status: 'RESOLVED',
          resolvedBy: staffId,
          resolutionNote: note,
          resolvedAt: new Date(),
        })
        .where(and(eq(safetyEvents.id, safetyEventId), eq(safetyEvents.status, 'ACTIVE')));
    });
  }
}
