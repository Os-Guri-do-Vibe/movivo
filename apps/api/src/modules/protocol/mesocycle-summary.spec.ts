import { describe, expect, it, vi } from 'vitest';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import {
  checkins,
  protocolRenewalSessions,
  protocols,
  workoutSessions,
  workoutSetEntries,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import {
  buildCareerDigestLine,
  computeMesocycleSummary,
  formatExecutionDigest,
  formatPeriodizationLedger,
  persistMesocycleSummary,
  readMesocycleNotes,
  type MesocycleSummary,
} from './mesocycle-summary';

function assertPresent<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected value to be present');
  return value;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROTOCOL_ID = '22222222-2222-4222-8222-222222222222';

function makeTx(responses: {
  protocolRows?: unknown[][];
  sessions?: unknown[];
  setEntries?: unknown[];
  checkinRows?: unknown[];
  renewalRows?: unknown[];
}) {
  const protocolQueue = [...(responses.protocolRows ?? [])];
  let table: unknown;
  const resolve = (): unknown[] => {
    if (table === protocols) return protocolQueue.shift() ?? [];
    if (table === workoutSessions) return responses.sessions ?? [];
    if (table === workoutSetEntries) return responses.setEntries ?? [];
    if (table === checkins) return responses.checkinRows ?? [];
    if (table === protocolRenewalSessions) return responses.renewalRows ?? [];
    return [];
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(resolve()),
    then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return chain as unknown as TenantTransaction;
}

const baseContent = {
  phase: 'HIPERTROFIA' as const,
  phaseDurationWeeks: 6,
  weeklyFrequency: 4,
  splitType: 'UPPER_LOWER',
};

const noCipher = {
  decryptHealth: vi.fn(async () => ''),
  encryptHealth: vi.fn(async (text: string) => Buffer.from(text)),
} as unknown as HealthCipherService;

describe('computeMesocycleSummary', () => {
  it('protocolo inexistente (ou de outro titular): retorna null', async () => {
    const tx = makeTx({ protocolRows: [[]] });
    const result = await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID);
    expect(result).toBeNull();
  });

  it('aderência, progressão de carga e RPE calculados a partir das sessões/séries reais', async () => {
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [
        {
          id: 's1',
          scheduledDate: '2026-08-01',
          status: 'COMPLETED',
          perceivedEffort: 6,
          painReported: false,
          feedbackCipher: null,
        },
        {
          id: 's2',
          scheduledDate: '2026-08-08',
          status: 'COMPLETED',
          perceivedEffort: 8,
          painReported: false,
          feedbackCipher: null,
        },
        {
          id: 's3',
          scheduledDate: '2026-08-15',
          status: 'PLANNED',
          perceivedEffort: null,
          painReported: false,
          feedbackCipher: null,
        },
      ],
      setEntries: [
        {
          workoutSessionId: 's1',
          exerciseId: 'supino_reto',
          reps: 10,
          loadValue: '40',
          loadUnit: 'KG',
          completed: true,
        },
        {
          workoutSessionId: 's2',
          exerciseId: 'supino_reto',
          reps: 8,
          loadValue: '50',
          loadUnit: 'KG',
          completed: true,
        },
      ],
      checkinRows: [{ id: 'c1' }],
      renewalRows: [],
    });

    const result = await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID);
    expect(result).not.toBeNull();
    const { summary } = assertPresent(result);

    expect(summary.adherence).toEqual({ completedSessions: 2, plannedSessions: 3, ratio: 2 / 3 });
    expect(summary.rpe).toEqual({ first: 6, last: 8, avg: 7 });
    expect(summary.painSessionCount).toBe(0);
    expect(summary.checkinsCompleted).toBe(1);
    expect(summary.weightKg).toBeNull();
    expect(summary.exercises).toEqual([
      {
        exerciseId: 'supino_reto',
        firstLoad: 40,
        lastLoad: 50,
        loadUnit: 'KG',
        repMin: 8,
        repMax: 10,
        sessionsCompleted: 2,
        sessionsPrescribed: 2,
      },
    ]);
    // M1 | HIPERTROFIA 6sem | UPPER_LOWER 4x/sem | aderência 67% | carga +25% | RPE méd 7.0 | dor 0
    expect(summary.ledgerLine).toBe(
      'M1 | HIPERTROFIA 6sem | UPPER_LOWER 4x/sem | aderência 67% | carga +25% | RPE méd 7.0 | dor 0',
    );
  });

  it('série de aquecimento incompleta (completed=false) não entra na progressão de carga', async () => {
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [
        {
          id: 's1',
          scheduledDate: '2026-08-01',
          status: 'COMPLETED',
          perceivedEffort: 7,
          painReported: false,
          feedbackCipher: null,
        },
      ],
      setEntries: [
        {
          workoutSessionId: 's1',
          exerciseId: 'agachamento',
          reps: 10,
          loadValue: '20',
          loadUnit: 'KG',
          completed: false, // aquecimento/série não concluída
        },
      ],
      checkinRows: [],
      renewalRows: [],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.exercises).toEqual([
      {
        exerciseId: 'agachamento',
        firstLoad: null,
        lastLoad: null,
        loadUnit: null,
        repMin: null,
        repMax: null,
        sessionsCompleted: 0,
        sessionsPrescribed: 1,
      },
    ]);
  });

  it('peso ao fim do ciclo vem do Bloco 4 da renovação que o encerrou (dataBlock4.currentWeightKg)', async () => {
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [],
      setEntries: [],
      checkinRows: [],
      renewalRows: [
        {
          dataBlock4: { currentWeightKg: 81, goalProgress: 'DENTRO_DO_ESPERADO', satisfaction: 7 },
        },
      ],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.weightKg).toBe(81);
    expect(summary.ledgerLine).toContain('81kg');
  });

  it('sessão com dor relatada e comentário cifrado: destila até 5 notas via decryptHealth', async () => {
    const cipher = {
      decryptHealth: vi.fn(async () => 'Senti dor no joelho na última série.'),
      encryptHealth: vi.fn(async (text: string) => Buffer.from(text)),
    } as unknown as HealthCipherService;
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [
        {
          id: 's1',
          scheduledDate: '2026-08-01',
          status: 'COMPLETED',
          perceivedEffort: 9,
          painReported: true,
          feedbackCipher: Buffer.from('cipher'),
        },
      ],
      setEntries: [],
      checkinRows: [],
      renewalRows: [],
    });

    const result = assertPresent(await computeMesocycleSummary(tx, cipher, USER_ID, PROTOCOL_ID));
    expect(result.summary.painSessionCount).toBe(1);
    expect(cipher.decryptHealth).toHaveBeenCalledWith(Buffer.from('cipher'));
    expect(result.notesCipher).not.toBeNull();
    expect(cipher.encryptHealth).toHaveBeenCalledWith(
      JSON.stringify(['Senti dor no joelho na última série.']),
    );
  });

  it('esforço quase máximo sem dor relatada também qualifica para destilar nota', async () => {
    const cipher = {
      decryptHealth: vi.fn(async () => 'Quase não terminei a última série.'),
      encryptHealth: vi.fn(async (text: string) => Buffer.from(text)),
    } as unknown as HealthCipherService;
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [
        {
          id: 's1',
          scheduledDate: '2026-08-01',
          status: 'COMPLETED',
          perceivedEffort: 9,
          painReported: false,
          feedbackCipher: Buffer.from('cipher'),
        },
      ],
      setEntries: [],
      checkinRows: [],
      renewalRows: [],
    });

    const result = assertPresent(await computeMesocycleSummary(tx, cipher, USER_ID, PROTOCOL_ID));
    expect(result.notesCipher).not.toBeNull();
  });

  it('mais de 5 sessões qualificando, fora de ordem: destila as 5 mais recentes primeiro', async () => {
    const cipher = {
      decryptHealth: vi.fn(async (buf: Buffer) => buf.toString()),
      encryptHealth: vi.fn(async (text: string) => Buffer.from(text)),
    } as unknown as HealthCipherService;
    // Datas fora de ordem (não crescente nem decrescente) — força o comparador de sort a
    // avaliar os dois sentidos da comparação, não só um deles.
    const dates = [
      '2026-08-03',
      '2026-08-01',
      '2026-08-06',
      '2026-08-02',
      '2026-08-05',
      '2026-08-04',
    ];
    const sessions = dates.map((scheduledDate, i) => ({
      id: `s${i}`,
      scheduledDate,
      status: 'COMPLETED',
      perceivedEffort: null,
      painReported: true,
      feedbackCipher: Buffer.from(`nota-${scheduledDate}`),
    }));
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions,
      setEntries: [],
      checkinRows: [],
      renewalRows: [],
    });

    await computeMesocycleSummary(tx, cipher, USER_ID, PROTOCOL_ID);
    expect(cipher.decryptHealth).toHaveBeenCalledTimes(5);
    // a mais antiga (2026-08-01) fica de fora — só as 5 mais recentes entram.
    expect(cipher.decryptHealth).not.toHaveBeenCalledWith(Buffer.from('nota-2026-08-01'));
  });

  it('comentário decifrado vazio (só espaços) após trim: não entra nas notas destiladas', async () => {
    const cipher = {
      decryptHealth: vi.fn(async () => '   '),
      encryptHealth: vi.fn(async (text: string) => Buffer.from(text)),
    } as unknown as HealthCipherService;
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [
        {
          id: 's1',
          scheduledDate: '2026-08-01',
          status: 'COMPLETED',
          perceivedEffort: null,
          painReported: true,
          feedbackCipher: Buffer.from('cipher'),
        },
      ],
      setEntries: [],
      checkinRows: [],
      renewalRows: [],
    });

    const result = assertPresent(await computeMesocycleSummary(tx, cipher, USER_ID, PROTOCOL_ID));
    expect(result.notesCipher).toBeNull();
  });

  it('sem carga registrada (loadUnit BODYWEIGHT) e sem reps: não entra na progressão de carga', async () => {
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [
        {
          id: 's1',
          scheduledDate: '2026-08-01',
          status: 'COMPLETED',
          perceivedEffort: null,
          painReported: false,
          feedbackCipher: null,
        },
      ],
      setEntries: [
        {
          workoutSessionId: 's1',
          exerciseId: 'flexao',
          reps: null,
          loadValue: null,
          loadUnit: 'BODYWEIGHT',
          completed: true,
        },
      ],
      checkinRows: [],
      renewalRows: [],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.exercises).toEqual([
      {
        exerciseId: 'flexao',
        firstLoad: null,
        lastLoad: null,
        loadUnit: null,
        repMin: null,
        repMax: null,
        sessionsCompleted: 1,
        sessionsPrescribed: 1,
      },
    ]);
    // sem carga (loadTrendPercent null) e sem RPE (avg null): ledgerLine cai no "n/d" das duas.
    expect(summary.ledgerLine).toContain('carga n/d');
    expect(summary.ledgerLine).toContain('RPE méd n/d');
  });

  it('conteúdo sem splitType: ledgerLine não tem o prefixo de split', async () => {
    const tx = makeTx({
      protocolRows: [
        [{ mesocycleNumber: 1, totalWeeks: 6, content: { ...baseContent, splitType: undefined } }],
      ],
      sessions: [],
      setEntries: [],
      checkinRows: [],
      renewalRows: [],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.splitType).toBeUndefined();
    expect(summary.ledgerLine).toContain('| 4x/sem |');
  });

  it('carga caiu entre a primeira e a última sessão: ledgerLine mostra percentual negativo', async () => {
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [
        {
          id: 's1',
          scheduledDate: '2026-08-01',
          status: 'COMPLETED',
          perceivedEffort: null,
          painReported: false,
          feedbackCipher: null,
        },
        {
          id: 's2',
          scheduledDate: '2026-08-08',
          status: 'COMPLETED',
          perceivedEffort: null,
          painReported: false,
          feedbackCipher: null,
        },
      ],
      setEntries: [
        {
          workoutSessionId: 's1',
          exerciseId: 'supino_reto',
          reps: 10,
          loadValue: '50',
          loadUnit: 'KG',
          completed: true,
        },
        {
          workoutSessionId: 's2',
          exerciseId: 'supino_reto',
          reps: 10,
          loadValue: '40',
          loadUnit: 'KG',
          completed: true,
        },
      ],
      checkinRows: [],
      renewalRows: [],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.ledgerLine).toContain('carga -20%');
  });

  it('peso ao fim do ciclo diferente do mesociclo anterior: ledgerLine mostra a seta', async () => {
    // `protocolRows` é uma FILA: a 1ª entrada atende o SELECT do protocolo pelo id, a 2ª
    // atende o SELECT do `previousMesocycleWeight` (mesmo `.from(protocols)`, 2ª chamada).
    const tx = makeTx({
      protocolRows: [
        [{ mesocycleNumber: 2, totalWeeks: 6, content: baseContent }],
        [{ mesocycleSummary: { weightKg: 82 } }],
      ],
      sessions: [],
      setEntries: [],
      checkinRows: [],
      renewalRows: [
        {
          dataBlock4: { currentWeightKg: 79, goalProgress: 'DENTRO_DO_ESPERADO', satisfaction: 7 },
        },
      ],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.weightKg).toBe(79);
    expect(summary.ledgerLine).toContain('82→79kg');
  });

  it('peso ao fim do ciclo igual ao anterior: ledgerLine mostra só o valor, sem seta', async () => {
    const tx = makeTx({
      protocolRows: [
        [{ mesocycleNumber: 2, totalWeeks: 6, content: baseContent }],
        [{ mesocycleSummary: { weightKg: 80 } }],
      ],
      sessions: [],
      setEntries: [],
      checkinRows: [],
      renewalRows: [
        {
          dataBlock4: { currentWeightKg: 80, goalProgress: 'DENTRO_DO_ESPERADO', satisfaction: 7 },
        },
      ],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.weightKg).toBe(80);
    expect(summary.ledgerLine).toContain('80kg');
    expect(summary.ledgerLine).not.toContain('→');
  });

  it('mesociclo anterior sem resumo (row ausente): weightBefore fica null', async () => {
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 2, totalWeeks: 6, content: baseContent }], []],
      sessions: [],
      setEntries: [],
      checkinRows: [],
      renewalRows: [
        {
          dataBlock4: { currentWeightKg: 80, goalProgress: 'DENTRO_DO_ESPERADO', satisfaction: 7 },
        },
      ],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.weightKg).toBe(80);
    expect(summary.ledgerLine).toContain('80kg');
    expect(summary.ledgerLine).not.toContain('→');
  });

  it('bloco 4 da renovação com dado fora do schema: pesoAoFim vira null', async () => {
    const tx = makeTx({
      protocolRows: [[{ mesocycleNumber: 1, totalWeeks: 6, content: baseContent }]],
      sessions: [],
      setEntries: [],
      checkinRows: [],
      renewalRows: [{ dataBlock4: { currentWeightKg: 'não é número' } }],
    });

    const { summary } = assertPresent(
      await computeMesocycleSummary(tx, noCipher, USER_ID, PROTOCOL_ID),
    );
    expect(summary.weightKg).toBeNull();
  });
});

describe('persistMesocycleSummary', () => {
  it('só escreve quando mesocycleSummary ainda é NULL (write-once)', async () => {
    const where = vi.fn(async () => []);
    const set = vi.fn(() => ({ where }));
    const tx = { update: vi.fn(() => ({ set })) } as unknown as TenantTransaction;

    const computed = {
      summary: { ledgerLine: 'M1 | ...' } as unknown as MesocycleSummary,
      notesCipher: null,
    };
    await persistMesocycleSummary(tx, PROTOCOL_ID, computed);

    expect(tx.update).toHaveBeenCalledWith(protocols);
    expect(set).toHaveBeenCalledWith({
      mesocycleSummary: computed.summary,
      mesocycleNotesCipher: null,
    });
    expect(where).toHaveBeenCalledOnce();
  });
});

describe('readMesocycleNotes', () => {
  it('sem cipher: array vazio, sem chamar decryptHealth', async () => {
    const cipher = { decryptHealth: vi.fn() } as unknown as HealthCipherService;
    await expect(readMesocycleNotes(cipher, null)).resolves.toEqual([]);
    expect(cipher.decryptHealth).not.toHaveBeenCalled();
  });

  it('decifra e filtra só strings do array JSON', async () => {
    const cipher = {
      decryptHealth: vi.fn(async () => JSON.stringify(['nota real', 42, null])),
    } as unknown as HealthCipherService;
    await expect(readMesocycleNotes(cipher, Buffer.from('x'))).resolves.toEqual(['nota real']);
  });

  it('JSON decifrado não é array: retorna vazio', async () => {
    const cipher = {
      decryptHealth: vi.fn(async () => JSON.stringify({ not: 'an array' })),
    } as unknown as HealthCipherService;
    await expect(readMesocycleNotes(cipher, Buffer.from('x'))).resolves.toEqual([]);
  });
});

describe('formatExecutionDigest', () => {
  const summary: MesocycleSummary = {
    ledgerLine: 'M1 | ...',
    mesocycleNumber: 1,
    phase: 'HIPERTROFIA',
    phaseDurationWeeks: 6,
    weeklyFrequency: 4,
    adherence: { completedSessions: 20, plannedSessions: 24, ratio: 20 / 24 },
    rpe: { first: 6, last: 8, avg: 7 },
    painSessionCount: 2,
    weightKg: 80,
    checkinsCompleted: 5,
    exercises: [
      {
        exerciseId: 'supino_reto',
        firstLoad: 40,
        lastLoad: 50,
        loadUnit: 'KG',
        repMin: 8,
        repMax: 12,
        sessionsCompleted: 18,
        sessionsPrescribed: 20,
      },
    ],
  };

  it('renderiza aderência, RPE, dor, check-ins e exercícios em texto', () => {
    const text = formatExecutionDigest(summary, []);
    expect(text).toContain('Aderência real: 20/24 sessões concluídas (83%).');
    expect(text).toContain('RPE real ao longo do ciclo: 6 → 8 (média 7.0).');
    expect(text).toContain('Sessões com dor relatada: 2.');
    expect(text).toContain('Check-ins semanais respondidos: 5.');
    expect(text).toContain('supino_reto: 40→50kg, 8-12 reps, 18/20 sessões concluídas.');
  });

  it('inclui comentários destilados quando houver', () => {
    const text = formatExecutionDigest(summary, ['Senti dor no joelho.']);
    expect(text).toContain(
      'Comentários do aluno em sessões com dor relatada ou esforço quase máximo:',
    );
    expect(text).toContain('- Senti dor no joelho.');
  });

  it('RPE médio ausente: omite a linha de RPE', () => {
    const withoutRpe: MesocycleSummary = {
      ...summary,
      rpe: { first: null, last: null, avg: null },
    };
    const text = formatExecutionDigest(withoutRpe, []);
    expect(text).not.toContain('RPE real ao longo do ciclo');
  });

  it('exercício sem carga registrada e sem faixa de reps: cai nos textos-padrão', () => {
    const withoutLoadOrReps: MesocycleSummary = {
      ...summary,
      exercises: [
        {
          exerciseId: 'prancha',
          firstLoad: null,
          lastLoad: null,
          loadUnit: null,
          repMin: null,
          repMax: null,
          sessionsCompleted: 5,
          sessionsPrescribed: 6,
        },
      ],
    };
    const text = formatExecutionDigest(withoutLoadOrReps, []);
    expect(text).toContain('prancha: sem carga registrada, 5/6 sessões concluídas.');
  });

  it('RPE médio presente mas primeiro/último ausentes (dado espúrio): usa "n/d" nas pontas', () => {
    const partialRpe: MesocycleSummary = {
      ...summary,
      rpe: { first: null, last: null, avg: 7 },
    };
    const text = formatExecutionDigest(partialRpe, []);
    expect(text).toContain('RPE real ao longo do ciclo: n/d → n/d (média 7.0).');
  });

  it('carga registrada sem unidade (dado espúrio): omite a unidade no texto', () => {
    const loadWithoutUnit: MesocycleSummary = {
      ...summary,
      exercises: [
        {
          exerciseId: 'leg_press',
          firstLoad: 100,
          lastLoad: 120,
          loadUnit: null,
          repMin: null,
          repMax: null,
          sessionsCompleted: 2,
          sessionsPrescribed: 2,
        },
      ],
    };
    const text = formatExecutionDigest(loadWithoutUnit, []);
    expect(text).toContain('leg_press: 100→120, 2/2 sessões concluídas.');
  });

  it('exercício com só repMin (sem repMax): não mostra faixa de reps', () => {
    const partialReps: MesocycleSummary = {
      ...summary,
      exercises: [
        {
          exerciseId: 'rosca_direta',
          firstLoad: null,
          lastLoad: null,
          loadUnit: null,
          repMin: 10,
          repMax: null,
          sessionsCompleted: 3,
          sessionsPrescribed: 4,
        },
      ],
    };
    const text = formatExecutionDigest(partialReps, []);
    expect(text).toContain('rosca_direta: sem carga registrada, 3/4 sessões concluídas.');
    expect(text).not.toContain('reps');
  });
});

describe('formatPeriodizationLedger + buildCareerDigestLine', () => {
  it('sem histórico além da janela: só as linhas recentes, sem linha de carreira', () => {
    expect(buildCareerDigestLine([])).toBeNull();
    expect(formatPeriodizationLedger(['M1 | ...', 'M2 | ...'], null)).toBe('M1 | ...\nM2 | ...');
  });

  it('agrega mesociclos além da janela numa linha de carreira única', () => {
    const older: MesocycleSummary[] = [
      {
        ledgerLine: 'M1',
        mesocycleNumber: 1,
        phase: 'ADAPTACAO',
        phaseDurationWeeks: 4,
        weeklyFrequency: 3,
        adherence: { completedSessions: 10, plannedSessions: 12, ratio: 10 / 12 },
        rpe: { first: null, last: null, avg: null },
        painSessionCount: 1,
        weightKg: null,
        checkinsCompleted: 4,
        exercises: [],
      },
      {
        ledgerLine: 'M2',
        mesocycleNumber: 2,
        phase: 'HIPERTROFIA',
        phaseDurationWeeks: 6,
        weeklyFrequency: 4,
        adherence: { completedSessions: 20, plannedSessions: 24, ratio: 20 / 24 },
        rpe: { first: null, last: null, avg: null },
        painSessionCount: 0,
        weightKg: null,
        checkinsCompleted: 6,
        exercises: [],
      },
    ];
    const line = buildCareerDigestLine(older);
    expect(line).toContain('Carreira (2 mesociclo(s) mais antigos, resumidos)');
    expect(line).toContain('1x ADAPTACAO');
    expect(line).toContain('1x HIPERTROFIA');
    expect(line).toContain('sessões com dor no total: 1');

    const full = formatPeriodizationLedger(['M3 | ...'], line);
    expect(full.split('\n')[0]).toBe(line);
    expect(full.split('\n')[1]).toBe('M3 | ...');
  });
});
