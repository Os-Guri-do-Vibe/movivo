/**
 * Regressão da conversa real do Gabriel (21/10/2026, quarta 12:09): "joga meu treino de quarta
 * para sexta". Em produção toda ação com data foi recusada com "esse dia já passou", porque o
 * modelo recebia a semana inteira como `[data]` (scrubber) e inventava uma data. O parser agora
 * troca datas por referências de dia ("SEX", "HOJE"); o servidor converte e o planejador decide.
 *
 * O modelo é roteirizado (`FakeLlm`) com a resposta que ele dá ao novo contrato; o contrato em
 * si (o que chega ao modelo depois do scrubber) é provado em `schedule-request-parser.service.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BUBBLE_SEPARATOR } from '../../src/modules/whatsapp/message-templates';
import {
  adjustmentsOf,
  clock,
  createStudent,
  say,
  session,
  type Student,
  startWorld,
  weekLayout,
  type World,
} from './support/world';

let world: World;
let gabriel: Student;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  world = await startWorld();
  gabriel = await createStudent(world, {
    name: 'Gabriel Hayashida',
    sessions: [session('A', 'TUE'), session('B', 'WED'), session('C', 'THU')],
    firstProtocolDate: '2026-10-12',
  });
});

afterAll(async () => {
  vi.useRealTimers();
  await world?.close();
});

describe('Gabriel: passa o treino de hoje (quarta) para sexta, que era descanso', () => {
  it('"joga meu treino de quarta pra sexta": quarta vira descanso e sexta recebe o treino', async () => {
    const now = clock('2026-10-21 12:09');
    const outcome = await say(
      world,
      gabriel,
      'joga meu treino aí de quarta-feira pra sexta, por favor, que amanhã eu faço o normal',
      {
        intent: 'AJUSTE_AGENDA',
        // O que o modelo devolve no contrato novo: referências de dia, nunca datas.
        parsed: { action: 'TREINAR', date: 'SEX', sessionKey: 'B' },
        now,
        operationId: 'op-gabriel-quarta-sexta',
      },
    );

    expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: true });
    if (outcome.kind !== 'FIXED') return;
    expect(outcome.text.split(BUBBLE_SEPARATOR)[0]).not.toContain('já passou');
    expect(await weekLayout(world, gabriel, now)).toMatchObject({
      '2026-10-21': null,
      '2026-10-22': 'C',
      '2026-10-23': 'B',
    });
    expect(await adjustmentsOf(world, gabriel.userId)).toHaveLength(1);
  });

  it('"hoje não vou treinar, só amanhã": uma referência HOJE vira a data de hoje, não "dia que passou"', async () => {
    const now = clock('2026-10-21 12:13');
    const outcome = await say(world, gabriel, 'Fechado, hoje não vou treinar, somente amanhã', {
      intent: 'AJUSTE_AGENDA',
      parsed: { action: 'DESCANSAR', date: 'HOJE' },
      now,
      operationId: 'op-gabriel-hoje-descanso',
    });
    expect(outcome.kind).toBe('FIXED');
    if (outcome.kind !== 'FIXED') return;
    expect(outcome.text).not.toContain('Esse dia já passou');
  });
});
