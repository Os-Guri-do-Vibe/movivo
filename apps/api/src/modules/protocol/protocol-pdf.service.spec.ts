import { describe, expect, it } from 'vitest';

import { sessionsInCalendarOrder } from './protocol-pdf.service';

describe('sessionsInCalendarOrder', () => {
  it('ordena o calendário do PDF de segunda a domingo', () => {
    const sessions = [
      { weekday: 'MON' as const },
      { weekday: 'TUE' as const },
      { weekday: 'WED' as const },
      { weekday: 'THU' as const },
      { weekday: 'FRI' as const },
      { weekday: 'SUN' as const },
      { weekday: 'SAT' as const },
    ];

    expect(sessionsInCalendarOrder(sessions).map((session) => session.weekday)).toEqual([
      'MON',
      'TUE',
      'WED',
      'THU',
      'FRI',
      'SAT',
      'SUN',
    ]);
  });

  it('preserva a ordem de protocolo legado sem dia fixo', () => {
    const sessions = [{ weekday: 'SUN' as const }, {}, { weekday: 'SAT' as const }];

    expect(sessionsInCalendarOrder(sessions)).toEqual(sessions);
  });
});
