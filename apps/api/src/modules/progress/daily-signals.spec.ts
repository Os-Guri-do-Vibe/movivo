import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import { trainingSignal, wellbeingSignal, type CheckInDay } from './daily-signals';
import {
  specialistTalkValidators,
  trainingDailyValidators,
  wellbeingDailyValidators,
  type DailyReadingInput,
} from './daily-specialists-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };
const day = (date: string, over: Partial<CheckInDay> = {}): CheckInDay => ({
  date,
  energy: 4,
  sleep: 4,
  soreness: 4,
  mood: 4,
  stress: 2,
  ...over,
});
const readiness = (score: number | null, delta: number | null) => ({
  readiness: { score, baseline: 70, delta, sleepAvg7d: null, stressAvg7d: null },
  risks: [],
});

describe('sinais que acordam o treinador', () => {
  it('dia normal fica em silêncio', () => {
    expect(
      trainingSignal({
        days: [day('2026-11-04')],
        today: '2026-11-04',
        load: readiness(72, 2),
        plannedToday: true,
      }),
    ).toBeNull();
  });

  it('prontidão baixa ou bem abaixo do normal dele acorda', () => {
    const base = { days: [day('2026-11-04')], today: '2026-11-04', plannedToday: true };
    expect(trainingSignal({ ...base, load: readiness(40, -5) })).toContain('prontidão baixa');
    expect(trainingSignal({ ...base, load: readiness(60, -18) })).toContain('abaixo do normal');
  });

  it('sono ruim só importa para o treino quando há sessão hoje', () => {
    const days = [day('2026-11-04', { sleep: 1 })];
    const base = { days, today: '2026-11-04', load: readiness(70, 0) };
    expect(trainingSignal({ ...base, plannedToday: true })).toContain('sono');
    expect(trainingSignal({ ...base, plannedToday: false })).toBeNull();
  });

  it('relato de doença, álcool ou viagem no dia do treino acorda', () => {
    const base = {
      days: [day('2026-11-04')],
      today: '2026-11-04',
      load: readiness(72, 2),
      plannedToday: true,
    };
    const report = (kind: 'ILLNESS' | 'ALCOHOL' | 'TRAVEL') => [
      { kind, score: null, valueNum: null },
    ];
    expect(trainingSignal({ ...base, reportsToday: report('ILLNESS') })).toContain('doente');
    expect(trainingSignal({ ...base, reportsToday: report('ALCOHOL') })).toContain('álcool');
    expect(trainingSignal({ ...base, reportsToday: report('TRAVEL') })).toContain('viagem');
    expect(
      trainingSignal({ ...base, plannedToday: false, reportsToday: report('ILLNESS') }),
    ).toBeNull();
  });

  it('carga subindo rápido demais acorda mesmo com o check-in bom', () => {
    expect(
      trainingSignal({
        days: [day('2026-11-04')],
        today: '2026-11-04',
        load: { ...readiness(75, 3), risks: [{ kind: 'ACWR_HIGH', detail: 'razão 1,6' }] },
        plannedToday: false,
      }),
    ).toContain('carga');
  });
});

describe('sinais que acordam o bem-estar', () => {
  const days = (overs: Partial<CheckInDay>[]) =>
    overs.map((over, i) => day(`2026-11-0${i + 1}`, over));

  it('um dia ruim é só um dia ruim', () => {
    expect(
      wellbeingSignal({
        days: days([{}, {}, { sleep: 1 }]),
        today: '2026-11-03',
        load: null,
        plannedToday: false,
      }),
    ).toBeNull();
  });

  it('padrão de sono, estresse ou humor acorda', () => {
    const run = (overs: Partial<CheckInDay>[]) =>
      wellbeingSignal({ days: days(overs), today: '2026-11-05', load: null, plannedToday: false });
    expect(run([{}, {}, {}, { sleep: 2 }, { sleep: 1 }])).toContain('sono');
    expect(run([{ stress: 4 }, { stress: 5 }, {}, { stress: 4 }, {}])).toContain('estresse');
    expect(run([{}, {}, {}, { mood: 2 }, { mood: 1 }])).toContain('humor');
  });
});

describe('validadores dos especialistas em tempo real', () => {
  const input: DailyReadingInput = {
    trigger: 'prontidão baixa (40)',
    today: '2026-11-04',
    days: [],
    load: null,
    plannedToday: { title: 'Força A', minutes: 60, priority: 'KEY' },
    last7Days: { planned: 4, done: 3 },
    recentOutreach: 0,
    source: 'CHECK_IN',
    reportsToday: [],
  };
  const run = async <O>(
    validators: ReadonlyArray<(i: DailyReadingInput, o: O, c: ValidationContext) => unknown>,
    i: DailyReadingInput,
    o: O,
  ) => JSON.stringify((await Promise.all(validators.map((v) => v(i, o, ctx)))).flat());

  const training = {
    level: 'ACT' as const,
    reading: 'Prontidão bem abaixo do normal dele e sono curto na véspera.',
    shortenToday: true,
    recommendation: null as string | null,
    reachOut: true,
    question: 'Como foi a noite de sono por aí?',
    memoryNote: null,
  };

  it('treinador: encurtar exige sessão hoje e avisar o aluno', async () => {
    expect(await run(trainingDailyValidators, input, training)).toBe('[]');
    expect(
      await run(trainingDailyValidators, { ...input, plannedToday: null }, training),
    ).toContain('não há sessão marcada');
    expect(
      await run(trainingDailyValidators, input, { ...training, reachOut: false, question: null }),
    ).toContain('avise o aluno');
  });

  it('treinador: se o aluno avisou no chat antes de treinar, a recomendação é obrigatória', async () => {
    const chat: DailyReadingInput = { ...input, source: 'CHAT' };
    expect(await run(trainingDailyValidators, chat, training)).toContain('recomendação explícita');
    expect(
      await run(trainingDailyValidators, chat, {
        ...training,
        recommendation:
          'Faça o treino, mas pare 2 repetições antes da falha e corte a última série.',
      }),
    ).toBe('[]');
    expect(
      await run(trainingDailyValidators, chat, {
        ...training,
        shortenToday: false,
        reachOut: false,
        question: null,
        recommendation: 'Mantenha o treino, mas reduza a carga em 10% nos básicos hoje.',
      }),
    ).toContain('fale com ele');
  });

  it('bem-estar: sem rótulo clínico e só escala nível ACT', async () => {
    const wellbeing = {
      level: 'WATCH' as const,
      reading: 'Sono curto em vários dias e energia baixa.',
      reachOut: false,
      question: null,
      escalate: true,
      memoryNote: null,
    };
    expect(await run(wellbeingDailyValidators, input, wellbeing)).toContain('nível ACT');
    expect(
      await run(wellbeingDailyValidators, input, {
        ...wellbeing,
        level: 'ACT' as const,
        reading: 'Parece depressão pelos dados de humor.',
      }),
    ).toContain('rótulo clínico');
  });

  it('conversa termina em pergunta quando há pergunta', async () => {
    const talkInput = {
      firstName: 'Ana',
      specialist: 'TRAINING' as const,
      reading: training.reading,
      shortened: { title: 'Força A', minutes: 40 },
      recommendation: null,
      acknowledgeOnly: false,
      question: training.question,
    };
    const validators = specialistTalkValidators as ReadonlyArray<
      (i: typeof talkInput, o: { messages: string[] }, c: ValidationContext) => unknown
    >;
    const check = async (messages: string[]) =>
      JSON.stringify(
        (await Promise.all(validators.map((v) => v(talkInput, { messages }, ctx)))).flat(),
      );
    expect(await check(['Vi que o corpo está pedindo calma hoje. Como foi a noite de sono?'])).toBe(
      '[]',
    );
    expect(await check(['Ajustei o treino de hoje para ficar mais leve.'])).toContain('pergunta');
  });
});
