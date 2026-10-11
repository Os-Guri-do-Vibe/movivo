import { describe, expect, it, vi } from 'vitest';

import { ConversationEventsService } from './conversation-events.service';

const STUDENT = '33333333-3333-4333-8333-333333333333';

describe('ConversationEventsService', () => {
  it('avisa mensagem nova e mudança de atendimento só com ids e metadado, nunca conteúdo', () => {
    const service = new ConversationEventsService();
    const received: Array<{ type?: string; data: Record<string, unknown> }> = [];
    const subscription = service.stream().subscribe((event) => received.push(event as never));

    service.emitMessage(STUDENT, 'INBOUND');
    service.emitMessage(STUDENT, 'OUTBOUND', 'msg-1');
    service.emitAttendance(STUDENT, true);
    service.emitRead(STUDENT, 0);

    expect(received.map((event) => event.type)).toEqual([
      'conversation.message',
      'conversation.message',
      'conversation.attendance',
      'conversation.read',
    ]);
    expect(received[3]?.data).toEqual({ studentId: STUDENT, unreadCount: 0 });
    expect(received[0]?.data).toMatchObject({ studentId: STUDENT, direction: 'INBOUND' });
    expect(received[0]?.data).not.toHaveProperty('messageId');
    expect(received[1]?.data).toMatchObject({ direction: 'OUTBOUND', messageId: 'msg-1' });
    expect(received[2]?.data).toEqual({ studentId: STUDENT, aiPaused: true });
    expect(JSON.stringify(received)).not.toMatch(/content|text|phone/i);

    subscription.unsubscribe();
    service.onModuleDestroy();
  });

  it('manda heartbeat, encerra a conexão em 5 min e libera o contador', () => {
    vi.useFakeTimers();
    const service = new ConversationEventsService();
    const received: unknown[] = [];
    const subscription = service.stream().subscribe((event) => received.push(event));
    expect(service.activeConnections()).toBe(1);

    vi.advanceTimersByTime(25_000);
    expect(received[0]).toEqual({ type: 'heartbeat', data: {} });

    vi.advanceTimersByTime(5 * 60_000);
    expect(service.activeConnections()).toBe(0);
    subscription.unsubscribe();
    service.onModuleDestroy();
    vi.useRealTimers();
  });

  it('não entrega evento anterior à assinatura nem depois do unsubscribe', () => {
    const service = new ConversationEventsService();
    service.emitMessage(STUDENT, 'INBOUND');
    const received: unknown[] = [];
    const subscription = service.stream().subscribe((event) => received.push(event));
    subscription.unsubscribe();
    service.emitMessage(STUDENT, 'INBOUND');
    expect(received).toEqual([]);
    expect(service.activeConnections()).toBe(0);
    service.onModuleDestroy();
  });
});
