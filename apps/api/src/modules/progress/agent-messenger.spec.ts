import { describe, expect, it, vi } from 'vitest';

import { AgentMessenger } from './agent-messenger';

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';

function makeMessenger() {
  const store = { persistTurn: vi.fn().mockResolvedValue(undefined) };
  const queues = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const messenger = new AgentMessenger(store as never, queues as never, logger as never);
  return { messenger, queues };
}

const outboundJobIds = (queues: { enqueue: ReturnType<typeof vi.fn> }) =>
  queues.enqueue.mock.calls
    .filter((call) => call[0] === 'whatsapp-outbound')
    .map((call) => (call[3] as { jobId: string }).jobId);

describe('AgentMessenger', () => {
  it('o mesmo fato do dia para dois alunos gera dois jobs distintos (nenhum é descartado como duplicado)', async () => {
    const { messenger, queues } = makeMessenger();
    const dedupeId = 'meal-reminder_2026-11-11_LUNCH';

    await messenger.send(ANA, ['almoço da Ana'], dedupeId);
    await messenger.send(BRUNO, ['almoço do Bruno'], dedupeId);

    const [ana, bruno] = outboundJobIds(queues);
    expect(ana).toBe(`agent-message_${ANA}_${dedupeId}`);
    expect(bruno).toBe(`agent-message_${BRUNO}_${dedupeId}`);
    expect(ana).not.toBe(bruno);
  });

  it('o mesmo fato para o mesmo aluno continua idempotente', async () => {
    const { messenger, queues } = makeMessenger();
    await messenger.send(ANA, ['a'], 'day-summary_2026-11-11');
    await messenger.send(ANA, ['a'], 'day-summary_2026-11-11');
    const [first, second] = outboundJobIds(queues);
    expect(first).toBe(second);
  });
});
