/**
 * Guardrail de linguagem (US-8.1, Definição de Pronto: **0 ocorrências de termo clínico
 * proibido na copy**) + parse do botão de insight de duração. `CLAUDE.md` torna estes
 * termos inegociáveis em qualquer texto gerado pelo sistema.
 */
import { describe, expect, it } from 'vitest';

import {
  dailyWorkoutMessage,
  durationInsightMessage,
  parseDurationInsightButton,
  resentWorkoutLinkMessage,
} from './workout-messages';

// Pergunta sobre o treino sem registro, dentro do link do dia: três variações (escolhidas pela
// data do treino) e "ontem"/dia da semana.
const YESTERDAY_SEEDS = ['2026-08-10', '2026-08-11', '2026-08-12'];
const WHENS = ['ontem', 'sexta'];
const withQuestion = (seed: string, when = 'ontem', focus = 'Costas e Bíceps') =>
  dailyWorkoutMessage('Ana', 'Pernas', 'https://x/check-in/abc', { focus, when, seed });
const QUESTION_COPY = YESTERDAY_SEEDS.flatMap((seed) =>
  WHENS.map((when) => withQuestion(seed, when)),
);

const COPY = [
  dailyWorkoutMessage('Ana', 'Treino A', 'https://x/treino/abc'),
  durationInsightMessage(75, 60),
  resentWorkoutLinkMessage('Ana', 'https://x/check-in/abc'),
  ...QUESTION_COPY,
];

const FORBIDDEN =
  /diagn[óo]stic|tratamento|cura\b|garantid|evolu[çc][ãa]o do quadro|progresso cl[íi]nico|resultado garantido/i;

describe('copy do treino diário', () => {
  it('não usa nenhum termo clínico ou promessa de resultado', () => {
    for (const text of COPY) expect(text).not.toMatch(FORBIDDEN);
  });

  // Regra de produto (achado 2026-09-09, correção do fundador): nunca travessão "—".
  it('não usa travessão (—)', () => {
    for (const text of COPY) expect(text).not.toContain('—');
  });

  it('monta a mensagem diária com nome e título em negrito e o link em linha própria', () => {
    expect(dailyWorkoutMessage('Ana', 'Treino A', 'https://x/check-in/abc')).toBe(
      'Bom dia, *Ana*! 💚\n\nSeu treino de hoje é *Treino A*, não esqueça de realizar seu check-in diário quando for treinar:\nhttps://x/check-in/abc\n\nAgora é com você. Bora se mover. 👊🏼',
    );
  });

  it('neutraliza marcadores de formatação e quebras de linha vindos do título', () => {
    const text = dailyWorkoutMessage('A*na', '*Peito_\nTríceps~', 'https://x/check-in/abc');
    expect(text).toContain('Bom dia, *Ana*!');
    expect(text).toContain('é *Peito Tríceps*,');
  });
});

describe('link do dia com a pergunta sobre o treino sem registro', () => {
  const BRAND_NEVER = /pregui[çc]a|falhou|perdeu|sem desculpa|\baluno|\busu[áa]rio/i;
  const PRESSURE = /ainda d[áa] tempo|agora mesmo|treine hoje|compens|repor|dobr/i;
  const LINK_BUBBLE =
    'Bom dia, *Ana*! 💚\n\nSeu treino de hoje é *Pernas*, não esqueça de realizar seu check-in diário quando for treinar:\nhttps://x/check-in/abc\n\nAgora é com você. Bora se mover. 👊🏼';
  const bubbles = (text: string) => text.split('\n---\n');
  const questionOf = (seed: string, when = 'ontem', focus = 'Costas e Bíceps') =>
    bubbles(withQuestion(seed, when, focus))[1] ?? '';
  const QUESTION_BUBBLES = QUESTION_COPY.map((text) => bubbles(text)[1] ?? '');

  it('são DOIS balões: o do link, idêntico ao de sempre, e o da pergunta', () => {
    for (const text of QUESTION_COPY) {
      const parts = bubbles(text);
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe(LINK_BUBBLE);
      expect(parts[1]).toContain('sem registro');
    }
  });

  it('o balão do link nunca carrega a pergunta e o da pergunta nunca repete o link', () => {
    for (const text of QUESTION_COPY) {
      const [link, question] = bubbles(text);
      expect(link).not.toContain('sem registro');
      expect(question).not.toContain('https://');
      expect(question).not.toContain('check-in');
    }
  });

  it('sem pergunta, a mensagem é exatamente o balão do link, sem separador', () => {
    const plain = dailyWorkoutMessage('Ana', 'Pernas', 'https://x/check-in/abc');
    expect(plain).toBe(LINK_BUBBLE);
    expect(plain).not.toContain('---');
  });

  it('cobre as três variações do balão da pergunta, todas distintas', () => {
    expect(new Set(YESTERDAY_SEEDS.map((seed) => questionOf(seed))).size).toBe(3);
  });

  it('pergunta de forma aberta e curta, com o manifesto de constância', () => {
    for (const question of QUESTION_BUBBLES) {
      expect(question).toMatch(/\?/);
      expect(question).toMatch(/uma palavra j[áa] ajuda/);
      expect(question).toMatch(/const[âa]ncia|perfeit/i);
      expect(question).toContain('*Costas e Bíceps*');
    }
  });

  it('diz "ontem" ou o dia da semana, sem nunca confundir os dois', () => {
    for (const seed of YESTERDAY_SEEDS) {
      expect(questionOf(seed, 'ontem').toLowerCase()).toContain('ontem');
      expect(questionOf(seed, 'sexta').toLowerCase()).not.toContain('ontem');
      expect(questionOf(seed, 'sexta').toLowerCase()).toContain('sexta');
    }
  });

  it('não cobra, não manda compensar e não usa palavras que a marca nunca usa', () => {
    for (const question of QUESTION_BUBBLES) {
      expect(question).not.toMatch(PRESSURE);
      expect(question).not.toMatch(BRAND_NEVER);
    }
  });

  it('nunca expõe o rótulo interno "Dia A" ao aluno', () => {
    for (const question of QUESTION_BUBBLES) expect(question).not.toMatch(/\bDia [A-Z0-9]\b/);
  });

  it('o balão da pergunta é curto o bastante para a prévia da notificação', () => {
    for (const question of QUESTION_BUBBLES) expect(question.length).toBeLessThan(330);
  });

  it('é determinística para a mesma data e neutraliza formatação no foco', () => {
    expect(withQuestion('2026-08-10')).toBe(withQuestion('2026-08-10'));
    expect(questionOf('2026-08-10', 'ontem', '*Peito_\nTríceps~')).toContain('*Peito Tríceps*');
  });
});

describe('parse do botão de insight de duração', () => {
  const INSIGHT_ID = '11111111-1111-4111-8111-111111111111';

  it('reconhece ADJUST e OK', () => {
    expect(parseDurationInsightButton(`workout-insight:${INSIGHT_ID}:ADJUST`)).toEqual({
      id: INSIGHT_ID,
      adjust: true,
    });
    expect(parseDurationInsightButton(`workout-insight:${INSIGHT_ID}:OK`)?.adjust).toBe(false);
  });

  it('ignora botões de outros fluxos', () => {
    expect(parseDurationInsightButton('checkin:anticipated')).toBeNull();
    expect(parseDurationInsightButton(undefined)).toBeNull();
  });
});
