import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { auditLogs } from '../../core/database/schema';

export interface AuditEvent {
  actorId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  async append(tx: TenantTransaction, event: AuditEvent): Promise<void> {
    // O trigger BEFORE INSERT substitui o placeholder pelo hash encadeado real.
    await tx.insert(auditLogs).values({ ...event, rowHash: '0'.repeat(64) });
  }
}
