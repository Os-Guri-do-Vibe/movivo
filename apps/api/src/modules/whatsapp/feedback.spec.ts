import { describe, expect, it } from 'vitest';

import { FEEDBACK_BUTTONS, FEEDBACK_DOWN_ID, FEEDBACK_UP_ID, parseFeedback } from './feedback';

describe('parseFeedback', () => {
  it('mapeia os ids dos botões para o voto', () => {
    expect(parseFeedback(FEEDBACK_UP_ID)).toBe('UP');
    expect(parseFeedback(FEEDBACK_DOWN_ID)).toBe('DOWN');
  });

  it('id desconhecido ou ausente → null (mensagem normal, não é feedback)', () => {
    expect(parseFeedback('qualquer')).toBeNull();
    expect(parseFeedback(undefined)).toBeNull();
  });

  it('expõe exatamente os dois botões 👍/👎', () => {
    expect(FEEDBACK_BUTTONS.map((b) => b.id)).toEqual([FEEDBACK_UP_ID, FEEDBACK_DOWN_ID]);
  });
});
