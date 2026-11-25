import { describe, expect, it } from 'vitest';

import { reviewWeekStart } from './review-week';

describe('reviewWeekStart', () => {
  it('no domingo à noite a semana revisada é a que está fechando', () => {
    expect(reviewWeekStart('2026-11-08')).toBe('2026-11-02'); // domingo → segunda da mesma semana
  });

  it('em outro dia, é a última semana fechada', () => {
    expect(reviewWeekStart('2026-11-04')).toBe('2026-10-26'); // quarta
    expect(reviewWeekStart('2026-11-09')).toBe('2026-11-02'); // segunda
  });
});
