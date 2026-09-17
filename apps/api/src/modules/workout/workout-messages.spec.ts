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

const COPY = [dailyWorkoutMessage('Ana', 'https://x/treino/abc'), durationInsightMessage(75, 60)];

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

  it('mantém o profissional CREF visível na mensagem diária', () => {
    expect(dailyWorkoutMessage('Ana', 'https://x/treino/abc')).toMatch(/profissional CREF/);
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
