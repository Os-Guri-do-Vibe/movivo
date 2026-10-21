import { describe, expect, it } from 'vitest';

import type { WeekSlot } from '../workout/schedule-planner';
import {
  lateLogAlreadyLoggedMessage,
  lateLogOutOfWindowMessage,
  lateLogWhichDayMessage,
  lateLogWhichSessionQuestion,
  linkJustSentMessage,
  linkUnavailableMessage,
  noActiveProtocolMessage,
  noWorkoutTodayMessage,
  scheduleAlreadyThereMessage,
  scheduleAppliedMessage,
  scheduleChoiceQuestion,
  scheduleNotUnderstoodMessage,
  scheduleRefusalMessage,
  scheduleUndoUnavailableMessage,
  scheduleUndoneMessage,
  sessionName,
  weekLayout,
  workoutAlreadyDoneMessage,
  type NameOf,
  type RefusalReason,
} from './schedule-messages';

// Semana de 2026-10-19 (segunda) a 2026-10-25 (domingo); hoje é terça.
const TODAY = '2026-10-20';
const NAMES: Record<string, { dayLabel: string; focus: string }> = {
  A: { dayLabel: 'Treino A', focus: 'Costas e Bíceps' },
  B: { dayLabel: 'Treino B', focus: 'Pernas' },
  C: { dayLabel: 'Treino C', focus: 'Peito e Tríceps' },
};
const nameOf: NameOf = (key) => NAMES[key] ?? { dayLabel: key, focus: key };

const SLOTS: WeekSlot[] = [
  { date: '2026-10-19', sessionKey: null, locked: false },
  { date: '2026-10-20', sessionKey: 'A', locked: false },
  { date: '2026-10-21', sessionKey: null, locked: false },
  { date: '2026-10-22', sessionKey: null, locked: false },
  { date: '2026-10-23', sessionKey: 'B', locked: false },
  { date: '2026-10-24', sessionKey: null, locked: false },
  { date: '2026-10-25', sessionKey: 'C', locked: false },
];

const FORBIDDEN =
  /diagn[óo]stic|tratamento|cura\b|garantid|resultado garantido|pregui[çc]a|falhou|perdeu|faltou|compens|sem desculpa|\baluno\b|\busu[áa]rio\b/i;

const REASONS: RefusalReason[] = [
  'PAST_DATE',
  'OUT_OF_WEEK',
  'DAY_LOCKED',
  'UNKNOWN_SESSION',
  'ALREADY_DONE',
  'QUOTA_REACHED',
  'NOTHING_PENDING',
  'DATE_TAKEN',
  'DUPLICATE_DATE',
  'DUPLICATE_SESSION',
];

function allCopy(): string[] {
  const copy: string[] = [];
  for (const seed of ['a', 'b', 'c', 'd']) {
    copy.push(
      scheduleAppliedMessage({
        request: { kind: 'TRAIN_ON', date: TODAY, sessionKey: 'A' },
        today: TODAY,
        slots: SLOTS,
        dropped: [],
        nameOf,
        seed,
      }),
    );
  }
  copy.push(
    scheduleAppliedMessage({
      request: { kind: 'TRAIN_ON', date: '2026-10-23', sessionKey: 'B' },
      today: TODAY,
      slots: SLOTS,
      dropped: [],
      nameOf,
      seed: 'x',
    }),
    scheduleAppliedMessage({
      request: { kind: 'REST_ON', date: TODAY },
      today: TODAY,
      slots: SLOTS,
      dropped: ['C'],
      nameOf,
      seed: 'x',
    }),
    scheduleAppliedMessage({
      request: { kind: 'REST_ON', date: '2026-10-21' },
      today: TODAY,
      slots: SLOTS,
      dropped: ['B', 'C'],
      nameOf,
      seed: 'x',
    }),
    scheduleAppliedMessage({
      request: { kind: 'REORGANIZE' },
      today: TODAY,
      slots: SLOTS,
      dropped: [],
      nameOf,
      seed: 'x',
    }),
    scheduleAlreadyThereMessage({
      request: { kind: 'TRAIN_ON', date: TODAY, sessionKey: 'A' },
      today: TODAY,
      nameOf,
    }),
    scheduleAlreadyThereMessage({
      request: { kind: 'TRAIN_ON', date: '2026-10-23', sessionKey: 'B' },
      today: TODAY,
      nameOf,
    }),
    scheduleAlreadyThereMessage({
      request: { kind: 'REST_ON', date: '2026-10-21' },
      today: TODAY,
      nameOf,
    }),
    scheduleChoiceQuestion({
      request: { kind: 'REST_ON', date: '2026-10-21' },
      today: TODAY,
      candidates: [
        { date: '2026-10-23', sessionKey: 'B' },
        { date: '2026-10-25', sessionKey: 'C' },
      ],
      nameOf,
    }),
    scheduleChoiceQuestion({
      request: { kind: 'TRAIN_ON', date: TODAY },
      today: TODAY,
      candidates: [{ date: '2026-10-23', sessionKey: 'B' }],
      nameOf,
    }),
    scheduleNotUnderstoodMessage(),
    scheduleUndoneMessage({ slots: SLOTS, today: TODAY, nameOf }),
    scheduleUndoUnavailableMessage('ALREADY_USED'),
    scheduleUndoUnavailableMessage('NOTHING_TO_UNDO'),
    lateLogWhichDayMessage(),
    lateLogWhichSessionQuestion({ options: [{ key: 'A', focus: 'Costas' }] }),
    lateLogOutOfWindowMessage(2),
    lateLogAlreadyLoggedMessage('Pernas'),
    noWorkoutTodayMessage(),
    workoutAlreadyDoneMessage('Costas e Bíceps'),
    linkJustSentMessage(),
    linkUnavailableMessage('DAILY'),
    linkUnavailableMessage('LATE_LOG'),
    noActiveProtocolMessage(),
  );
  for (const reason of REASONS) {
    for (const [date, pending] of [
      [TODAY, 0],
      ['2026-10-22', 2],
    ] as const) {
      copy.push(
        scheduleRefusalMessage({
          reason,
          today: TODAY,
          date,
          sessionKey: 'A',
          quota: 3,
          pending,
          sessionNames: Object.values(NAMES),
          nameOf,
        }),
      );
    }
  }
  return copy;
}

describe('copy do fluxo de agenda', () => {
  it('não usa termo clínico, promessa de resultado nem tom de culpa', () => {
    for (const text of allCopy()) expect(text).not.toMatch(FORBIDDEN);
  });

  it('não usa travessão (—)', () => {
    for (const text of allCopy()) expect(text).not.toContain('—');
  });

  it('toda mensagem tem conteúdo e termina sem espaço sobrando', () => {
    for (const text of allCopy()) {
      expect(text.length).toBeGreaterThan(10);
      expect(text).toBe(text.trim());
    }
  });
});

describe('scheduleAppliedMessage', () => {
  it('pedido para treinar hoje: afirma, mostra a semana de hoje em diante e oferece desfazer', () => {
    const text = scheduleAppliedMessage({
      request: { kind: 'TRAIN_ON', date: TODAY, sessionKey: 'A' },
      today: TODAY,
      slots: SLOTS,
      dropped: [],
      nameOf,
      seed: 'a',
    });
    expect(text).toContain('Treino A (Costas e Bíceps)');
    expect(text).toContain('*Terça* (hoje): Treino A (Costas e Bíceps)');
    expect(text).toContain('*Quinta*: descanso');
    // Segunda já passou: fora da lista.
    expect(text).not.toContain('Segunda');
    expect(text).toContain('desfazer');
  });

  it('a variação é estável para a mesma semente (retry do job reenvia o mesmo texto)', () => {
    const build = (seed: string) =>
      scheduleAppliedMessage({
        request: { kind: 'TRAIN_ON', date: TODAY, sessionKey: 'A' },
        today: TODAY,
        slots: SLOTS,
        dropped: [],
        nameOf,
        seed,
      });
    expect(build('2026-10-20')).toBe(build('2026-10-20'));
  });

  it('treino deixado de fora é dito sem culpa e com a volta ao plano na segunda', () => {
    const text = scheduleAppliedMessage({
      request: { kind: 'REST_ON', date: '2026-10-21' },
      today: TODAY,
      slots: SLOTS,
      dropped: ['C'],
      nameOf,
      seed: 'x',
    });
    expect(text).toContain('fica de fora desta semana');
    expect(text).toContain('na segunda a semana volta ao plano de sempre');
  });
});

describe('weekLayout', () => {
  it('marca dia treinado como feito e não repete o nome quando rótulo e foco coincidem', () => {
    const slots: WeekSlot[] = [{ date: TODAY, sessionKey: 'A', locked: true }];
    expect(weekLayout(slots, TODAY, nameOf)).toBe('• *Terça* (hoje): treino feito ✅');
    expect(sessionName({ dayLabel: 'Pernas', focus: 'Pernas' })).toBe('Pernas');
  });
});

describe('scheduleChoiceQuestion', () => {
  it('lista os treinos que podem ficar de fora, numerados, e deixa o aluno escolher os dias', () => {
    const text = scheduleChoiceQuestion({
      request: { kind: 'REST_ON', date: '2026-10-21' },
      today: TODAY,
      candidates: [
        { date: '2026-10-23', sessionKey: 'B' },
        { date: '2026-10-25', sessionKey: 'C' },
      ],
      nameOf,
    });
    expect(text).toContain('1. *Sexta*: Treino B (Pernas)');
    expect(text).toContain('2. *Domingo*: Treino C (Peito e Tríceps)');
    expect(text).toContain('em que dia fica cada um dos outros');
  });
});
