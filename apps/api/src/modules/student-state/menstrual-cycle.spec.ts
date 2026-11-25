import { describe, expect, it } from 'vitest';

import { cycleForecast, cycleView, dueCycleCareEvents, parseCycleMessage } from './menstrual-cycle';

const TODAY = '2026-10-31';

describe('parseCycleMessage', () => {
  it('reconhece as frases fixas com ou sem acento e pontuação', () => {
    expect(parseCycleMessage('autorizo ciclo.', TODAY)).toEqual({ kind: 'AUTHORIZE' });
    expect(parseCycleMessage('  Revogar   CICLO! ', TODAY)).toEqual({ kind: 'REVOKE' });
  });

  it('lê o início relatado e a data', () => {
    expect(parseCycleMessage('Menstruei hoje', TODAY)).toEqual({
      kind: 'LOG',
      onDate: TODAY,
      question: false,
    });
    expect(parseCycleMessage('minha menstruação veio ontem', TODAY)).toMatchObject({
      onDate: '2026-10-30',
    });
    expect(parseCycleMessage('menstruei anteontem', TODAY)).toMatchObject({
      onDate: '2026-10-29',
    });
    expect(parseCycleMessage('menstruei dia 28', TODAY)).toMatchObject({ onDate: '2026-10-28' });
    // "dia 30" ainda não chegou neste mês: é o do mês anterior.
    expect(parseCycleMessage('fiquei menstruada dia 30', '2026-10-05')).toMatchObject({
      onDate: '2026-09-30',
    });
    expect(parseCycleMessage('estou menstruada, posso treinar?', TODAY)).toMatchObject({
      question: true,
    });
  });

  it('ignora o que não é registro', () => {
    expect(parseCycleMessage('treino de hoje feito', TODAY)).toBeNull();
    expect(parseCycleMessage(`menstruei hoje ${'e '.repeat(100)}`, TODAY)).toBeNull();
    // "dia 30" no futuro deste mês e fevereiro sem dia 30.
    expect(parseCycleMessage('menstruei dia 30', '2026-03-01')).toBeNull();
  });
});

describe('cycleView', () => {
  it('sem registro não há fatia', () => {
    expect(cycleView([], TODAY)).toBeNull();
  });

  it('estima dia e fase pelo comprimento típico das últimas menstruações', () => {
    const starts = ['2026-08-10', '2026-09-09', '2026-10-09'];
    expect(cycleView(starts, '2026-10-11')).toEqual({
      lastStart: '2026-10-09',
      cycleDay: 3,
      typicalLength: 30,
      phase: 'MENSTRUAL',
      cyclesLogged: 3,
    });
    expect(cycleView(starts, '2026-10-16')?.phase).toBe('FOLLICULAR');
    expect(cycleView(starts, '2026-10-24')?.phase).toBe('OVULATORY');
    expect(cycleView(starts, '2026-10-31')?.phase).toBe('LUTEAL');
  });

  it('não especula a fase quando a menstruação atrasou muito', () => {
    expect(cycleView(['2026-09-01'], TODAY)).toMatchObject({ cycleDay: 61, phase: null });
  });
});

describe('pedido de ligar e desligar o acompanhamento', () => {
  it.each([
    'quero acompanhar meu ciclo',
    'Quero monitorar meu ciclo menstrual',
    'posso registrar minha menstruação por aqui?',
    'ativar acompanhamento do ciclo',
    'como faço para acompanhar meu ciclo?',
  ])('começa: %s', (text) => {
    expect(parseCycleMessage(text, TODAY)).toEqual({ kind: 'START' });
  });

  it.each([
    'quero parar o acompanhamento do ciclo',
    'não quero mais lembretes do ciclo menstrual',
    'desativar ciclo',
    'cancelar o monitoramento da menstruação',
  ])('parar ensina a frase que apaga: %s', (text) => {
    expect(parseCycleMessage(text, TODAY)).toEqual({ kind: 'STOP_HINT' });
  });

  it.each([
    'meu ciclo começou atrasado esse mês',
    'minha menstruação parou de vir',
    'como o ciclo menstrual afeta o treino?',
    'estou no fim do ciclo de treino',
    'quero registrar meu almoço',
  ])('comentário ou dúvida segue para os agentes: %s', (text) => {
    expect(parseCycleMessage(text, TODAY)).toBeNull();
  });

  it('contar que menstruou continua sendo registro, mesmo com palavras de pedido', () => {
    expect(parseCycleMessage('quero registrar que menstruei hoje', TODAY)).toMatchObject({
      kind: 'LOG',
      onDate: TODAY,
    });
  });
});

describe('previsão e lembretes do ciclo', () => {
  // Ciclo de 28 dias iniciado em 01/10: ovulação estimada no dia 14 (14/10), próxima em 29/10.
  const view = (today: string) => {
    const found = cycleView(['2026-10-01'], today);
    if (!found) throw new Error('sem ciclo');
    return found;
  };

  it('estima a próxima menstruação e a janela fértil pelo calendário', () => {
    expect(cycleForecast(view('2026-10-05'), '2026-10-05')).toEqual({
      nextStart: '2026-10-29',
      daysUntilNext: 24,
      fertileFrom: '2026-10-09',
      fertileTo: '2026-10-15',
    });
  });

  it.each([
    ['2026-10-05', []],
    ['2026-10-09', ['FERTILE_WINDOW']],
    ['2026-10-11', ['FERTILE_WINDOW']],
    ['2026-10-12', []],
    ['2026-10-22', ['PMS_PHASE']],
    ['2026-10-24', ['PMS_PHASE']],
    ['2026-10-25', []],
    ['2026-10-27', ['PERIOD_SOON']],
    ['2026-10-28', ['PERIOD_SOON']],
    ['2026-10-29', []],
    ['2026-11-02', ['PERIOD_LATE']],
    ['2026-11-06', ['PERIOD_LATE']],
    // Atraso longo: ciclo irregular ou registro esquecido, não se insiste nem se especula.
    ['2026-11-07', []],
    ['2026-12-15', []],
  ])('em %s os marcos do dia são %j', (today, expected) => {
    expect(dueCycleCareEvents(view(today), today)).toEqual(expected);
  });

  it('a duração típica vem dos ciclos registrados', () => {
    const starts = ['2026-08-01', '2026-09-02', '2026-10-04'];
    const found = cycleView(starts, '2026-10-10');
    expect(found).toMatchObject({ typicalLength: 32, cyclesLogged: 3 });
    expect(cycleForecast(found as NonNullable<typeof found>, '2026-10-10').nextStart).toBe(
      '2026-11-05',
    );
  });
});
