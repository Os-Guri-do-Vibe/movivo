/**
 * Unit — golden set da agenda flexível. Não chama modelo: prova que a fixture é coerente e que,
 * para CADA frase, o que o parser entrega ao modelo depois do scrubber real ainda identifica
 * hoje e cada dia da semana (a regressão de produção de 21/10/2026: datas viravam `[data]`).
 * A avaliação contra o modelo de verdade é manual: `src/scripts/eval-agenda.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import { scrubPII } from '../ai-coach/llm/pii-scrubber';
import {
  GOLDEN_USER,
  SCENARIO_SESSIONS,
  SCENARIO_WEEK,
  SCHEDULE_GOLDEN_SET,
  scenarioRequest,
} from './schedule-golden-set.fixture';
import { ScheduleRequestParserService } from './schedule-request-parser.service';

describe('golden set da agenda flexível — fixture', () => {
  it('tem 50 casos, ids únicos e cada caso aponta para dias e treinos do cenário', () => {
    expect(SCHEDULE_GOLDEN_SET).toHaveLength(50);
    expect(new Set(SCHEDULE_GOLDEN_SET.map((c) => c.id)).size).toBe(50);
    const dates = new Set(SCENARIO_WEEK.map((day) => day.date));
    const keys = new Set(SCENARIO_SESSIONS.map((session) => session.key));
    for (const c of SCHEDULE_GOLDEN_SET) {
      if (c.date && c.date !== 'FORA')
        expect(dates.has(c.date) || c.date.startsWith('2026-10-')).toBe(true);
      if (c.sessionKey) expect(keys.has(c.sessionKey)).toBe(true);
      for (const placement of c.placements ?? []) {
        expect(keys.has(placement.sessionKey)).toBe(true);
        if (placement.date) expect(dates.has(placement.date)).toBe(true);
      }
      for (const key of c.leaveOut ?? []) expect(keys.has(key)).toBe(true);
    }
  });

  it('cobre todas as ações e as três rotas', () => {
    const actions = new Set(SCHEDULE_GOLDEN_SET.flatMap((c) => c.actions));
    for (const action of [
      'TREINAR',
      'DESCANSAR',
      'REORGANIZAR',
      'ESCOLHA',
      'REGISTRAR',
      'DESFAZER',
      'LINK',
      'OUTRO',
    ]) {
      expect(actions.has(action as never)).toBe(true);
    }
    expect(new Set(SCHEDULE_GOLDEN_SET.map((c) => c.route))).toEqual(
      new Set(['AGENDA', 'LINK', 'OTHER']),
    );
  });
});

describe('golden set da agenda flexível — o que o modelo recebe depois do scrubber', () => {
  it.each(SCHEDULE_GOLDEN_SET.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const complete = vi.fn(async (_input: unknown) => ({ text: '{"action":"OUTRO"}' }));
    const service = new ScheduleRequestParserService(
      { complete } as unknown as LlmRouter,
      { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() } as never,
    );
    await service.parse({
      userId: 'u',
      operationId: 'op',
      user: GOLDEN_USER,
      personaSlot: null,
      ...scenarioRequest(c.message, c.openQuestion),
    });
    // DESFAZER é reconhecido por regra, sem chamar o modelo.
    if (complete.mock.calls.length === 0) return;
    const call = complete.mock.calls[0]?.[0] as unknown as { messages: Array<{ content: string }> };
    const envelope = call.messages[0]?.content ?? '';
    const scrubbed = scrubPII(envelope, GOLDEN_USER);
    // A mensagem do aluno pode trazer um número ("dia 30"); o resto do envelope não pode perder dias.
    expect(scrubbed).toContain('"hoje":{"dia":"HOJE","weekday":"quarta"}');
    for (const ref of ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM']) {
      expect(scrubbed).toContain(`"dia":"${ref}"`);
    }
    expect(scrubbed).not.toContain('[data]');
  });
});
