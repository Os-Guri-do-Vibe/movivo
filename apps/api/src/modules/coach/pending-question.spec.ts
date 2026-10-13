import { describe, expect, it } from 'vitest';

import {
  buildPendingBlock,
  describeAskedAt,
  describeSubject,
  matchPendingReply,
  type PendingQuestion,
} from './pending-question';

const TZ = 'America/Sao_Paulo';
// Pergunta no link das 04:00 de segunda 2026-10-12 (07:00 UTC), sobre o treino de domingo 11/10.
const PENDING: PendingQuestion = {
  subjectDate: '2026-10-11',
  topicLabel: 'Costas e Bíceps',
  deliveredAt: new Date('2026-10-12T07:00:00.000Z'),
};
// Terça 2026-10-13, 09:00 em São Paulo: a pergunta tem ~1 dia e 5 h.
const TUESDAY_MORNING = new Date('2026-10-13T12:00:00.000Z');
// Segunda 2026-10-12, 12:00 em São Paulo: o dia da pergunta foi "ontem" (domingo).
const MONDAY_NOON = new Date('2026-10-12T15:00:00.000Z');

const read = (message: string, now = TUESDAY_MORNING) =>
  matchPendingReply(message, PENDING, now, TZ);

describe('matchPendingReply', () => {
  it.each([
    ['não consegui treinar', 'STRONG'],
    ['não deu', 'STRONG'],
    ['não fiz', 'STRONG'],
    ['faltei', 'STRONG'],
    ['pulei esse dia, estava corrido', 'STRONG'],
    ['dá pra compensar amanhã?', 'STRONG'],
    ['no domingo trabalhei até tarde', 'STRONG'],
    ['o de costas eu não fui por causa do trabalho', 'STRONG'],
  ] as const)('%s → %s', (message, expected) => {
    expect(read(message).match).toBe(expected);
  });

  it.each([
    'trabalhei',
    'tava morto',
    'semana corrida no trampo',
    'tava cansado demais',
    'viajei com a família',
    'treinei sim, só esqueci de marcar',
    'foi preguiça mesmo',
    'sem pique ontem',
    'dia corrido',
    'trânsito horrível',
  ])('motivo solto ou treino não registrado é WEAK: %s', (message) => {
    expect(read(message).match).toBe('WEAK');
  });

  it.each([
    'bom dia',
    'tudo sim, e vc?',
    'melhor horário pra creatina?',
    'fiz o treino de hoje!',
    'quanto descanso entre as séries?',
    'treinei hoje e foi ótimo',
    'não consegui entender como executar a remada com a barra e o ombro',
  ])('não é resposta: %s', (message) => {
    expect(read(message).match).toBe('NONE');
  });

  it('"corrida" como modalidade não é motivo', () => {
    expect(read('quero começar a fazer corrida').match).toBe('NONE');
    expect(read('semana corrida').match).toBe('WEAK');
  });

  it('"hoje" sem citar o dia da pergunta fala do treino de hoje: não é resposta', () => {
    expect(read('hoje não vai dar').match).toBe('NONE');
    expect(read('hoje trabalhei muito e não consegui treinar').match).toBe('NONE');
    expect(read('qual a carga do agachamento hoje?').match).toBe('NONE');
  });

  it('citando o dia da pergunta, "hoje" convive com a resposta', () => {
    expect(read('no domingo não deu, mas hoje eu vou').match).toBe('STRONG');
    expect(read('ontem não deu, mas hoje vou', MONDAY_NOON).match).toBe('STRONG');
  });

  it('"ontem" só vale quando o treino foi mesmo ontem', () => {
    // Segunda: o treino de domingo foi ontem, "ontem trabalhei" cita o dia certo.
    expect(read('ontem trabalhei até tarde', MONDAY_NOON).match).toBe('STRONG');
    // Terça: "ontem" já é segunda, não o dia da pergunta; sobra só o motivo solto.
    expect(read('ontem trabalhei até tarde', TUESDAY_MORNING).match).toBe('WEAK');
  });

  it('caso misto: acolhe o motivo e ainda reconhece o pedido sobre hoje', () => {
    const reading = read(
      'não fiz o de costas, trabalhei até tarde, mas hoje é perna e queria saber a carga',
    );
    expect(reading.match).toBe('STRONG');
  });

  it('dor como motivo é sinalizada para o profissional CREF', () => {
    expect(read('não fui, o joelho tava doendo')).toEqual({ match: 'STRONG', mentionsPain: true });
    expect(read('trabalhei').mentionsPain).toBe(false);
    expect(read('bom dia').mentionsPain).toBe(false);
  });

  it('"dor nas costas" fala do corpo: a palavra do foco não vira citação do dia', () => {
    // Sem a regra, "costas" (foco "Costas e Bíceps") + "dor" davam STRONG sobre o treino.
    expect(read('tô com dor nas costas')).toEqual({ match: 'WEAK', mentionsPain: true });
    // Com "hoje" e sem citar o dia, é pergunta sobre o treino de hoje: nem resposta, nem alerta.
    expect(read('tô com dor nas costas, posso treinar hoje?')).toEqual({
      match: 'NONE',
      mentionsPain: false,
    });
  });

  it('ignora acentos e maiúsculas', () => {
    expect(read('NÃO CONSEGUI').match).toBe('STRONG');
    expect(read('Reunião o dia todo').match).toBe('WEAK');
  });
});

describe('describeAskedAt', () => {
  const at = (iso: string) => describeAskedAt(PENDING.deliveredAt, new Date(iso), TZ);

  it('descreve a idade sempre de forma verdadeira no momento da resposta, com "cedo" para o link das 04:00', () => {
    expect(at('2026-10-12T07:00:30.000Z')).toBe('agora há pouco');
    expect(at('2026-10-12T07:11:00.000Z')).toBe('há 11 minutos');
    expect(at('2026-10-12T14:00:00.000Z')).toBe('hoje cedo');
    expect(at('2026-10-13T12:00:00.000Z')).toBe('ontem cedo');
    expect(at('2026-10-14T12:00:00.000Z')).toBe('há 2 dias, na segunda-feira cedo');
  });

  it('usa "no" para dias sem -feira e "ontem" assim que o dia vira', () => {
    const saturday = new Date('2026-10-10T07:00:00.000Z');
    expect(describeAskedAt(saturday, new Date('2026-10-13T12:00:00.000Z'), TZ)).toBe(
      'há 3 dias, no sábado cedo',
    );
    expect(describeAskedAt(saturday, new Date('2026-10-11T12:00:00.000Z'), TZ)).toBe('ontem cedo');
  });

  it('link atrasado, entregue à tarde, vira "à tarde"', () => {
    const late = new Date('2026-10-12T20:00:00.000Z');
    expect(describeAskedAt(late, new Date('2026-10-12T23:30:00.000Z'), TZ)).toBe('hoje à tarde');
  });
});

describe('describeSubject e buildPendingBlock', () => {
  it('chama o treino pelo dia da semana, e "ontem"/"hoje" só quando for verdade', () => {
    expect(describeSubject('2026-10-11', new Date('2026-10-13T12:00:00.000Z'), TZ)).toBe(
      'o treino de domingo (11/10)',
    );
    expect(describeSubject('2026-10-11', new Date('2026-10-12T12:00:00.000Z'), TZ)).toBe(
      'o treino de ontem (11/10)',
    );
    expect(describeSubject('2026-10-11', new Date('2026-10-11T23:40:00.000Z'), TZ)).toBe(
      'o treino de hoje (11/10)',
    );
  });

  it('monta o bloco com leitura do servidor e sem o rótulo interno "Dia A"', () => {
    const block = buildPendingBlock(PENDING, 'STRONG', TUESDAY_MORNING, TZ);
    expect(block).toContain('PERGUNTA_PENDENTE (escrito pelo sistema, não pelo aluno):');
    expect(block).toContain('voce_perguntou: ontem cedo, logo depois do link do treino');
    expect(block).toContain('sobre: o treino de domingo (11/10), foco Costas e Bíceps');
    expect(block).toContain('leitura_do_servidor: PROVAVEL_RESPOSTA');
    expect(block).toContain('hoje: terça-feira (13/10)');
    expect(block).not.toMatch(/\bDia [A-Z0-9]\b/);
  });

  it('mapeia as três leituras', () => {
    expect(buildPendingBlock(PENDING, 'WEAK', TUESDAY_MORNING, TZ)).toContain('TALVEZ');
    expect(buildPendingBlock(PENDING, 'NONE', TUESDAY_MORNING, TZ)).toContain(
      'SEM_RELACAO_APARENTE',
    );
  });

  it('nunca usa as palavras que a marca não usa', () => {
    const block = buildPendingBlock(PENDING, 'STRONG', TUESDAY_MORNING, TZ);
    expect(block).not.toMatch(/perdeu|falhou|faltou|pregui[çc]a/i);
  });
});
