/**
 * Registro e leitura das observações do aluno. Roda sob a sessão RLS do próprio aluno; o texto
 * curto do relato é cifrado e só aparece para os agentes com consentimento de saúde ativo.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import {
  studentReports,
  type ObservationKind,
  type ObservationPhase,
  type ObservationSource,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { ObservationView } from './observations';

export interface NewObservation {
  kind: ObservationKind;
  score?: number | null;
  valueNum?: number | null;
  phase?: ObservationPhase;
  /** Trecho do que o aluno disse, curto. Descartado sem consentimento de saúde. */
  note?: string | null;
}

const NOTE_MAX = 160;

@Injectable()
export class ObservationService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly consent: HealthConsentService,
  ) {}

  async record(
    userId: string,
    onDate: string,
    items: readonly NewObservation[],
    source: ObservationSource,
  ): Promise<number> {
    if (items.length === 0) return 0;
    const consented = await this.consent.hasActiveForUser(userId);
    const rows = await Promise.all(
      items.map(async (item) => ({
        userId,
        onDate,
        kind: item.kind,
        score: item.score ?? null,
        valueNum: item.valueNum ?? null,
        phase: item.phase ?? ('NONE' as const),
        source,
        note:
          consented && item.note?.trim()
            ? await this.cipher.encryptHealth(item.note.trim().slice(0, NOTE_MAX))
            : null,
      })),
    );
    await this.db.runAsUser(userId, 'USER', (tx) => tx.insert(studentReports).values(rows));
    return rows.length;
  }

  /** Relatos entre duas datas (inclusive), do mais antigo ao mais novo. */
  async between(userId: string, from: string, to: string): Promise<ObservationView[]> {
    const consented = await this.consent.hasActiveForUser(userId);
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(studentReports)
        .where(
          and(
            eq(studentReports.userId, userId),
            gte(studentReports.onDate, from),
            lte(studentReports.onDate, to),
          ),
        )
        .orderBy(asc(studentReports.recordedAt)),
    );
    const out: ObservationView[] = [];
    for (const row of rows) {
      out.push({
        date: row.onDate,
        kind: row.kind as ObservationKind,
        score: row.score,
        valueNum: row.valueNum,
        phase: row.phase as ObservationPhase,
        source: row.source as ObservationView['source'],
        note: consented && row.note ? await this.cipher.decryptHealth(row.note) : null,
        recordedAt: row.recordedAt.toISOString(),
      });
    }
    return out;
  }
}
