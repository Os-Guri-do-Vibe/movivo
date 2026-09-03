import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { WorkoutCompletionService } from './workout-completion.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function session(dayLabel: string) {
  return {
    dayLabel,
    focus: 'Corpo inteiro',
    exercises: [
      {
        exerciseId: 'goblet_squat',
        name: 'Agachamento goblet com halter',
        sets: 3,
        reps: { min: 8, max: 12 },
        loadStrategy: 'DOUBLE_PROGRESSION',
        restSeconds: 90,
      },
    ],
  };
}

/** Frequência 3 => segunda/quarta/sexta (`workout-schedule.ts`). */
const STRUCTURE = {
  promptVersion: 'methodology-2026-08-v2+catalog-2026-08-v2',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 3,
  sessions: [session('A'), session('B'), session('C')],
};

/**
 * `tx` mínimo: `select(...)` devolve o protocolo vigente e `insert(...)` registra o que
 * foi gravado, devolvendo `returning` conforme o dedupe tenha ou não escrito a linha.
 */
function makeService(options: {
  protocolRows?: unknown[];
  /** `false` simula o `setWhere` barrando a promoção (fonte existente mais específica). */
  written?: boolean;
}) {
  const { protocolRows = [], written = true } = options;
  const inserted: Array<Record<string, unknown>> = [];
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => protocolRows,
  };
  const tx = {
    select: () => selectChain,
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => (written ? [{ id: 'row-1' }] : []),
          }),
        };
      },
    }),
  } as never;
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const logger = { setContext: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
  return { service: new WorkoutCompletionService(db, logger), inserted };
}

describe('WorkoutCompletionService.record', () => {
  it('grava a conclusão com a fonte declarada e normaliza os campos opcionais ausentes', async () => {
    const { service, inserted } = makeService({});

    await expect(
      service.record(USER_ID, 'p1', 2, 3, 'A', '2026-08-10', 'WHATSAPP_QUICK_REPLY'),
    ).resolves.toBe(true);

    expect(inserted[0]).toMatchObject({
      userId: USER_ID,
      protocolId: 'p1',
      protocolVersion: 2,
      weekNumber: 3,
      sessionKey: 'A',
      completedAt: '2026-08-10',
      source: 'WHATSAPP_QUICK_REPLY',
      exercisesDone: null,
      perceivedEffort: null,
    });
  });

  it('preserva os extras informados e devolve false quando a precedência barra a escrita', async () => {
    const { service, inserted } = makeService({ written: false });

    await expect(
      service.record(USER_ID, 'p1', 1, 1, 'A', '2026-08-10', 'CHECKIN', {
        exercisesDone: ['goblet_squat'],
        perceivedEffort: 7,
      }),
    ).resolves.toBe(false);

    expect(inserted[0]).toMatchObject({ exercisesDone: ['goblet_squat'], perceivedEffort: 7 });
  });
});

describe('WorkoutCompletionService.activeProtocol', () => {
  it('devolve null quando não há protocolo ACTIVE com assinatura ACTIVE', async () => {
    const { service } = makeService({ protocolRows: [] });
    await expect(service.activeProtocol(USER_ID)).resolves.toBeNull();
  });

  it('devolve null quando a estrutura persistida não valida', async () => {
    const { service } = makeService({
      protocolRows: [{ id: 'p1', version: 1, currentWeek: 1, content: { lixo: true } }],
    });
    await expect(service.activeProtocol(USER_ID)).resolves.toBeNull();
  });

  it('mapeia currentWeek para weekNumber quando a estrutura valida', async () => {
    const { service } = makeService({
      protocolRows: [{ id: 'p1', version: 4, currentWeek: 6, content: STRUCTURE }],
    });
    await expect(service.activeProtocol(USER_ID)).resolves.toMatchObject({
      id: 'p1',
      version: 4,
      weekNumber: 6,
    });
  });
});

describe('WorkoutCompletionService.recordFromQuickReply', () => {
  it('não grava nada quando o aluno não tem protocolo vigente', async () => {
    const { service, inserted } = makeService({ protocolRows: [] });
    await expect(service.recordFromQuickReply(USER_ID, '2026-08-10', 'A')).resolves.toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it('grava com fonte WHATSAPP_QUICK_REPLY a partir do protocolo vigente', async () => {
    const { service, inserted } = makeService({
      protocolRows: [{ id: 'p1', version: 2, currentWeek: 3, content: STRUCTURE }],
    });

    await expect(service.recordFromQuickReply(USER_ID, '2026-08-10', 'A')).resolves.toBe(true);

    expect(inserted[0]).toMatchObject({
      protocolId: 'p1',
      protocolVersion: 2,
      weekNumber: 3,
      sessionKey: 'A',
      completedAt: '2026-08-10',
      source: 'WHATSAPP_QUICK_REPLY',
    });
  });
});

describe('WorkoutCompletionService.recordFromCheckin', () => {
  it.each([[undefined], ['NENHUM'], ['RESPOSTA_DESCONHECIDA']])(
    'não grava nada para a resposta %s',
    async (workouts) => {
      const { service, inserted } = makeService({
        protocolRows: [{ id: 'p1', version: 1, currentWeek: 1, content: STRUCTURE }],
      });
      await expect(service.recordFromCheckin(USER_ID, workouts)).resolves.toBe(0);
      expect(inserted).toHaveLength(0);
    },
  );

  it('não grava nada quando o aluno não tem protocolo vigente', async () => {
    const { service, inserted } = makeService({ protocolRows: [] });
    await expect(service.recordFromCheckin(USER_ID, 'TRES_MAIS')).resolves.toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('atribui as conclusões aos dias PREVISTOS mais recentes, não à data da resposta', async () => {
    const { service, inserted } = makeService({
      protocolRows: [{ id: 'p1', version: 1, currentWeek: 1, content: STRUCTURE }],
    });
    vi.useFakeTimers();
    // Domingo 2026-08-16: os dias de treino dos 7 dias anteriores são seg/qua/sex.
    vi.setSystemTime(new Date('2026-08-16T15:00:00.000Z'));
    try {
      await expect(service.recordFromCheckin(USER_ID, 'UM_DOIS')).resolves.toBe(1);
    } finally {
      vi.useRealTimers();
    }

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ completedAt: '2026-08-14', source: 'CHECKIN' });
  });

  it('TRES_MAIS grava o piso da faixa (3), do dia mais recente para trás', async () => {
    const { service, inserted } = makeService({
      protocolRows: [{ id: 'p1', version: 1, currentWeek: 1, content: STRUCTURE }],
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T15:00:00.000Z'));
    try {
      await expect(service.recordFromCheckin(USER_ID, 'TRES_MAIS')).resolves.toBe(3);
    } finally {
      vi.useRealTimers();
    }

    expect(inserted.map((row) => row.completedAt)).toEqual([
      '2026-08-14',
      '2026-08-12',
      '2026-08-10',
    ]);
  });
});
