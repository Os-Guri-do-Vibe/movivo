import { Injectable, type MessageEvent, type OnModuleDestroy } from '@nestjs/common';
import { defer, finalize, interval, map, merge, Observable, Subject, takeUntil, timer } from 'rxjs';

/**
 * Evento da aba "Conversas". Carrega só UUID e metadado — nunca o texto da mensagem: o
 * painel, ao receber, busca o conteúdo pela rota autorizada, sob RLS e auditada.
 */
export type ConversationEvent =
  | {
      type: 'conversation.message';
      studentId: string;
      direction: 'INBOUND' | 'OUTBOUND';
      at: string;
      /** Presente quando quem emitiu já entrega a linha ao cliente (envio manual). */
      messageId?: string;
    }
  | { type: 'conversation.attendance'; studentId: string; aiPaused: boolean }
  | { type: 'conversation.read'; studentId: string; unreadCount: number };

/** Tempo real da aba "Conversas" (SSE): mensagem nova e mudança do atendimento automático. */
@Injectable()
export class ConversationEventsService implements OnModuleDestroy {
  private readonly events = new Subject<ConversationEvent>();
  private connections = 0;

  emitMessage(studentId: string, direction: 'INBOUND' | 'OUTBOUND', messageId?: string): void {
    this.events.next({
      type: 'conversation.message',
      studentId,
      direction,
      at: new Date().toISOString(),
      ...(messageId ? { messageId } : {}),
    });
  }

  emitAttendance(studentId: string, aiPaused: boolean): void {
    this.events.next({ type: 'conversation.attendance', studentId, aiPaused });
  }

  emitRead(studentId: string, unreadCount: number): void {
    this.events.next({ type: 'conversation.read', studentId, unreadCount });
  }

  stream(): Observable<MessageEvent> {
    return defer(() => {
      this.connections += 1;
      const updates = this.events.pipe(
        map(({ type, ...data }) => ({ type, data }) satisfies MessageEvent),
      );
      const heartbeat = interval(25_000).pipe(map(() => ({ type: 'heartbeat', data: {} })));
      // ponytail: barramento in-process cobre o MVP single-replica (igual à fila do painel);
      // Redis Pub/Sub substitui a origem ao escalar, sem mudar o contrato SSE. A conexão
      // fecha em 5 min e o `EventSource` do navegador reconecta sozinho.
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
    this.events.complete();
  }
}
