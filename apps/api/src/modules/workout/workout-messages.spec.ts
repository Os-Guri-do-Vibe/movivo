/**
 * Guardrail de linguagem (US-8.1, Definição de Pronto: **0 ocorrências de termo clínico
 * proibido na copy**) + parse do botão. `CLAUDE.md` torna estes termos inegociáveis em
 * qualquer texto gerado pelo sistema.
 */
import { describe, expect, it } from 'vitest';

import {
  WORKOUT_DONE_ACK,
  WORKOUT_DONE_TITLE,
  WORKOUT_QUICK_REPLY_TEXT,
  WORKOUT_SKIPPED_ACK,
  WORKOUT_SKIPPED_TITLE,
  parseWorkoutButton,
  workoutButtons,
} from './workout-messages';

const COPY = [
  WORKOUT_QUICK_REPLY_TEXT,
  WORKOUT_DONE_TITLE,
  WORKOUT_SKIPPED_TITLE,
  WORKOUT_DONE_ACK,
  WORKOUT_SKIPPED_ACK,
];

const FORBIDDEN =
  /diagn[óo]stic|tratamento|cura\b|garantid|evolu[çc][ãa]o do quadro|progresso cl[íi]nico|resultado garantido/i;

describe('copy do quick reply de treino', () => {
  it('não usa nenhum termo clínico ou promessa de resultado', () => {
    for (const text of COPY) expect(text).not.toMatch(FORBIDDEN);
  });

  it('mantém o profissional CREF visível e o registro como fato, não interpretação', () => {
    expect(WORKOUT_QUICK_REPLY_TEXT).toMatch(/profissional CREF/);
    expect(WORKOUT_DONE_ACK).toMatch(/Treino registrado/);
  });
});

describe('parse do botão', () => {
  it('faz round-trip de data e sessão, inclusive com ":" no rótulo', () => {
    const [done, skip] = workoutButtons('2026-08-10', 'Dia A: superiores');
    expect(parseWorkoutButton(done?.id)).toEqual({
      done: true,
      completedAt: '2026-08-10',
      sessionKey: 'Dia A: superiores',
    });
    expect(parseWorkoutButton(skip?.id)?.done).toBe(false);
  });

  it('ignora botões de outros fluxos', () => {
    expect(parseWorkoutButton('checkin:anticipated')).toBeNull();
    expect(parseWorkoutButton(undefined)).toBeNull();
  });
});
