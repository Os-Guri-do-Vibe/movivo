import { Injectable, type MessageEvent, type OnModuleDestroy } from '@nestjs/common';
import { defer, finalize, interval, map, merge, Observable, Subject, takeUntil, timer } from 'rxjs';

export type DashboardQueueReason = 'protocol' | 'parq' | 'handoff' | 'checkin' | 'consent';

/** Invalidação SSE sem identificadores nem conteúdo de saúde. */
@Injectable()
export class DashboardQueueEventsService implements OnModuleDestroy {
  private readonly invalidations = new Subject<DashboardQueueReason>();
  private connections = 0;

  emit(reason: DashboardQueueReason): void {
    this.invalidations.next(reason);
  }

  stream(): Observable<MessageEvent> {
    return defer(() => {
      this.connections += 1;
      const updates = this.invalidations.pipe(
        map(() => ({
          type: 'queue.updated',
          data: { invalidate: true },
        })),
      );
      const heartbeat = interval(25_000).pipe(
        map(() => ({
          type: 'heartbeat',
          data: {},
        })),
      );
      // ponytail: barramento in-process cobre o MVP single-replica; Redis Pub/Sub
      // substitui a origem ao escalar horizontalmente, sem alterar o contrato SSE.
      return merge(updates, heartbeat).pipe(
        takeUntil(timer(5 * 60_000)),
        finalize(() => (this.connections -= 1)),
      );
    });
  }

  activeConnections(): number {
    return this.connections;
  }

  onModuleDestroy(): void {
    this.invalidations.complete();
  }
}
