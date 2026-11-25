import { describe, expect, it, vi } from 'vitest';

import { shareCardOptionsSchema, trainingDaySchema } from '@movivo/shared';

vi.mock('@/lib/training-api', () => ({
  previewShareCardImage: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  TrainingApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { previewShareCardImage } from '@/lib/training-api';

import { addDays, createDemoApi, DEMO_HISTORY_DAYS, mondayOf } from './demo-api';
import { DEMO_SCENARIOS } from './demo-scenarios';

const TODAY = '2026-11-12'; // quinta-feira

describe('demonstração do diário', () => {
  it('todo cenário monta um diário válido pelo schema real', async () => {
    for (const scenario of DEMO_SCENARIOS) {
      const api = createDemoApi(scenario, { body: 'MALE', today: TODAY });
      const day = await api.getTrainingDay();
      expect(() => trainingDaySchema.parse(day), scenario.id).not.toThrow();
      expect(day.selected).toHaveLength(scenario.today.length);
      expect(day.hasPlan).toBe(!scenario.noPlan);
      expect(day.checkedInToday).toBe(!scenario.pendingCheckIn);
    }
  });

  it('o check-in do dia respondido libera o treino', async () => {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === 'fluxo-forca');
    if (!scenario) throw new Error('fluxo-forca');
    const api = createDemoApi(scenario, { body: 'MALE', today: TODAY });
    expect((await api.getTrainingDay()).checkedInToday).toBe(false);
    await api.saveCheckIn({
      energy: 4,
      sleep: 3,
      soreness: 4,
      mood: 5,
      stress: 2,
      nutrition: null,
    });
    expect((await api.getTrainingDay()).checkedInToday).toBe(true);
  });

  it('as semanas passadas têm treinos fechados até o início do plano', async () => {
    const scenario = DEMO_SCENARIOS[0];
    if (!scenario) throw new Error('sem cenário');
    const api = createDemoApi(scenario, { body: 'MALE', today: TODAY });
    const day = await api.getTrainingDay();
    expect(day.firstScheduledOn).toBe(mondayOf(addDays(TODAY, -DEMO_HISTORY_DAYS)));
    const past = await api.getTrainingDay(addDays(TODAY, -7));
    const statuses = past.week.flatMap((d) => d.sessions.map((s) => s.status));
    expect(statuses).toContain('DONE');
  });

  it('cada modalidade concluída oferece os modelos de cartão dela', async () => {
    const expected: Record<string, string[]> = {
      'forca-concluida': ['CLASSIC', 'MUSCLES', 'SUMMARY', 'HIGHLIGHT'],
      'corrida-concluida': ['CLASSIC', 'SPLITS', 'SUMMARY', 'HIGHLIGHT'],
      'hyrox-concluido': ['CLASSIC', 'STATIONS', 'SUMMARY', 'HIGHLIGHT'],
      'externo-concluido': ['CLASSIC', 'SUMMARY', 'HIGHLIGHT'],
    };
    for (const [id, layouts] of Object.entries(expected)) {
      const scenario = DEMO_SCENARIOS.find((s) => s.id === id);
      if (!scenario) throw new Error(id);
      const api = createDemoApi(scenario, { body: 'FEMALE', today: TODAY });
      const [session] = (await api.getTrainingDay()).selected;
      const options = shareCardOptionsSchema.parse(
        await api.getShareCard(session?.execution?.id ?? ''),
      );
      expect(options.layouts, id).toEqual(layouts);
    }
  });

  it('sem sexo no cadastro, o modelo de músculos some', async () => {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === 'forca-concluida');
    if (!scenario) throw new Error('forca-concluida');
    const api = createDemoApi(scenario, { body: null, today: TODAY });
    const [session] = (await api.getTrainingDay()).selected;
    const options = await api.getShareCard(session?.execution?.id ?? '');
    expect(options.layouts).not.toContain('MUSCLES');
  });

  it('começar, registrar e fechar leva ao cartão, como no servidor', async () => {
    const scenario = DEMO_SCENARIOS.find((s) => s.id === 'corrida-rua');
    if (!scenario) throw new Error('corrida-rua');
    const api = createDemoApi(scenario, { body: 'MALE', today: TODAY });
    const [session] = (await api.getTrainingDay()).selected;
    if (!session) throw new Error('sem sessão');

    const started = await api.startSession(session.scheduledSessionId);
    await expect(api.getShareCard(started.id)).rejects.toThrow(/fechar o treino/);
    const read = await api.uploadActivityFile(started.id, new File([''], 'a.fit'));
    expect(read.metricsConfirmed).toBe(false);
    await api.saveMetrics(started.id, { metrics: read.metrics ?? {}, confirmed: true });
    await api.finishExecution(started.id, {
      status: 'COMPLETED',
      rpe: 5,
      durationMinutes: 40,
      painReports: [],
      enjoyment: null,
    });

    const after = await api.getTrainingDay();
    expect(after.selected[0]?.status).toBe('DONE');
    const options = await api.getShareCard(started.id);
    expect(options.layouts).toContain('SPLITS');
    await api.getShareCardImage(started.id, 'SPLITS');
    expect(previewShareCardImage).toHaveBeenCalledWith(
      expect.objectContaining({ modality: 'RUNNING', distanceMeters: 7_040 }),
      'SPLITS',
      undefined,
    );
  });
});
