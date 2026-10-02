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
} from './workout-messages';

const COPY = [
  dailyWorkoutMessage('Ana', 'Treino A', 'https://x/treino/abc'),
  durationInsightMessage(75, 60),
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
