import { describe, expect, it } from 'vitest';

import { activityImport, importedMessage, parseStravaCommand, type StravaActivity } from './strava';

const run: StravaActivity = {
  id: 987654321,
  sport_type: 'Run',
  start_date: '2026-10-31T10:00:00Z',
  start_date_local: '2026-10-31T07:00:00Z',
  distance: 5020,
  moving_time: 1694,
  elapsed_time: 1720,
  total_elevation_gain: 32,
  average_heartrate: 151.4,
  max_heartrate: 172,
  perceived_exertion: null,
};

describe('Strava', () => {
  it('reconhece os comandos do WhatsApp', () => {
    expect(parseStravaCommand('quero conectar meu Strava')).toBe('CONNECT');
    expect(parseStravaCommand('Integrar com o strava!')).toBe('CONNECT');
    expect(parseStravaCommand('desconectar strava')).toBe('DISCONNECT');
    expect(parseStravaCommand('corri 5 km hoje, já está no strava')).toBeNull();
  });

  it('corrida vira RUNNING com ritmo, FC e dia local', () => {
    expect(activityImport(run)).toEqual({
      externalId: 'strava:987654321',
      modality: 'RUNNING',
      performedOn: '2026-10-31',
      startedAt: new Date('2026-10-31T10:00:00Z'),
      durationMinutes: 28,
      metrics: {
        distanceMeters: 5020,
        movingSeconds: 1694,
        elapsedSeconds: 1720,
        avgPaceSecondsPerKm: 337,
        avgHeartRate: 151,
        maxHeartRate: 172,
        elevationGainMeters: 32,
      },
      rpe: null,
    });
  });

  it('musculação vira STRENGTH sem ritmo; outros esportes viram EXTERNAL_SPORT', () => {
    const strength = activityImport({ ...run, sport_type: 'WeightTraining', distance: 0 });
    expect(strength.modality).toBe('STRENGTH');
    expect(strength.metrics.avgPaceSecondsPerKm).toBeUndefined();
    expect(activityImport({ ...run, sport_type: 'Ride', perceived_exertion: 6 })).toMatchObject({
      modality: 'EXTERNAL_SPORT',
      rpe: 6,
    });
  });

  it('valor fora do contrato fica de fora em vez de derrubar o registro', () => {
    expect(activityImport({ ...run, max_heartrate: 400 }).metrics.maxHeartRate).toBeUndefined();
  });

  it('mensagem de confirmação', () => {
    expect(importedMessage(activityImport(run), true)).toBe(
      'Recebi do Strava: corrida de 5,0 km em 28:14. Marquei como feito o treino do plano desse dia. Se quiser, me conta como você se sentiu.',
    );
  });
});
