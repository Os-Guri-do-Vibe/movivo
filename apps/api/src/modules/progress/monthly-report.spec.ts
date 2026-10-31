import { describe, expect, it } from 'vitest';

import type { WeekMetrics } from '@movivo/shared';

import { languageViolations } from '../planning/tasks/common';
import {
  formatDuration,
  monthlyReportPdf,
  previousMonth,
  raceEstimate,
  reportMessage,
  summarize,
} from './monthly-report';

const week = (over: Partial<WeekMetrics> = {}): WeekMetrics => ({
  weekStart: '2026-10-05',
  planned: 4,
  done: 3,
  missed: 1,
  keyPlanned: 2,
  keyDone: 2,
  load: 1000,
  avgRpe: 6,
  painReports: 0,
  foodLogDays: 5,
  weightKg: null,
  checkIn: null,
  ...over,
});

describe('relatório mensal', () => {
  it('mês anterior atravessa a virada do ano', () => {
    expect(previousMonth('2026-11-02')).toBe('2026-10');
    expect(previousMonth('2027-01-04')).toBe('2026-12');
  });

  it('estimativa de prova pela melhor corrida e sem extrapolar demais', () => {
    expect(raceEstimate([{ date: '2026-10-10', meters: 2_000, seconds: 600 }])).toBeNull();
    const estimate = raceEstimate([
      { date: '2026-10-03', meters: 5_000, seconds: 1_800 },
      { date: '2026-10-17', meters: 10_000, seconds: 3_300 },
    ]);
    expect(estimate?.basedOn.meters).toBe(10_000);
    expect(estimate?.races.map((r) => r.label)).toEqual(['5 km', '10 km', '21,1 km']);
    const short = raceEstimate([{ date: '2026-10-03', meters: 5_000, seconds: 1_500 }]);
    expect(short?.races.map((r) => r.label)).toEqual(['5 km', '10 km']);
    expect(short?.races[0]?.seconds).toBe(1_500);
    expect(formatDuration(3_725)).toBe('1h02min05s');
  });

  it('compara só com o próprio mês anterior, sem promessa nem culpa, e gera o PDF', async () => {
    const report = summarize(
      '2026-10',
      'Ana',
      [
        week({
          weightKg: 80,
          checkIn: {
            energy: 4,
            sleep: 3,
            soreness: null,
            intensityFeel: null,
            barrier: null,
            foodDifficulty: null,
          },
        }),
        week({ weightKg: 79.4 }),
      ],
      [week({ done: 2 })],
      [{ date: '2026-10-10', meters: 8_000, seconds: 2_880 }],
      [{ status: 'OK', findings: [], strengths: [], focus: 'Manter as duas sessões-chave.' }],
    );
    expect(report.sessions).toEqual({ planned: 8, done: 6, keyPlanned: 4, keyDone: 4 });
    expect(report.previousRate).toBe(0.5);
    expect(report.weight).toEqual({ first: 80, last: 79.4 });
    const text = reportMessage(report);
    expect(text).toContain('6 de 8 sessões (75%)');
    expect(text).toContain('no mês anterior foram 50%');
    expect(languageViolations(text, 'mensagem')).toEqual([]);
    const pdf = await monthlyReportPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
