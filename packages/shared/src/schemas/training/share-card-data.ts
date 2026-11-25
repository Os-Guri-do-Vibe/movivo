/**
 * Os números do cartão de compartilhamento a partir do que o aluno registrou (séries, números
 * do relógio, fechamento). Função pura: a API usa com o treino gravado e a página de
 * demonstração usa com dados de exemplo, então os dois mostram exatamente a mesma coisa.
 */
import type { EnduranceMetrics } from './execution.schema';
import { SESSION_MODALITY_LABELS } from './modality.schema';
import type { SessionContent } from './plan.schema';
import { mapWorkoutMuscles, type ShareCardData } from './share-card.schema';

/** Uma volta do relógio conta como parcial de 1 km quando tem entre 0,95 e 1,05 km. */
const SPLIT_MIN_METERS = 950;
const SPLIT_MAX_METERS = 1_050;

/** Ritmo de cada km a partir das voltas do relógio (só as de ~1 km entram). */
export function splitsOf(metrics: EnduranceMetrics | null): number[] {
  return (metrics?.laps ?? [])
    .filter(
      (lap) => lap.distanceMeters >= SPLIT_MIN_METERS && lap.distanceMeters <= SPLIT_MAX_METERS,
    )
    .map((lap) => Math.round(lap.durationSeconds / (lap.distanceMeters / 1000)))
    .filter((pace) => pace >= 100 && pace <= 1_800);
}

export interface ShareCardSource {
  modality: ShareCardData['modality'];
  title: string;
  content: SessionContent | null;
  rpe: number | null;
  durationMinutes: number | null;
  sets: {
    exerciseId: string;
    setNumber: number;
    reps: number | null;
    loadKg: number | null;
    completed: boolean;
  }[];
  metrics: EnduranceMetrics | null;
  biologicalSex: string | null;
  muscleGroupsOf: (exerciseId: string) => readonly string[];
}

/** Os números do cartão, só com o que foi registrado (função pura, testada sem banco). */
export function shareCardDataOf(source: ShareCardSource): ShareCardData {
  const { metrics, content } = source;
  const recordedSeconds = metrics?.movingSeconds ?? metrics?.elapsedSeconds ?? null;
  const durationSeconds =
    recordedSeconds ?? (source.durationMinutes !== null ? source.durationMinutes * 60 : null);
  const rpe = source.rpe;
  const title = source.title.trim() || SESSION_MODALITY_LABELS[source.modality];

  if (source.modality === 'STRENGTH') {
    const done = source.sets.filter((s) => s.completed && s.setNumber >= 1);
    const exerciseIds = [...new Set(done.map((s) => s.exerciseId))];
    const volumeKg = done.reduce((sum, s) => sum + (s.reps ?? 0) * (s.loadKg ?? 0), 0);
    const { groups } = mapWorkoutMuscles(exerciseIds.flatMap((id) => source.muscleGroupsOf(id)));
    const sex = source.biologicalSex;
    return {
      modality: 'STRENGTH',
      title,
      durationSeconds,
      exercises: exerciseIds.length,
      sets: done.length,
      volumeKg,
      rpe,
      body: sex === 'MALE' ? 'male' : sex === 'FEMALE' ? 'female' : null,
      muscles: groups,
    };
  }
  if (source.modality === 'RUNNING') {
    const treadmill =
      content?.modality === 'RUNNING' &&
      (content.terrain === 'TREADMILL' || content.segments.some((s) => s.paceReference?.treadmill));
    const distance = metrics?.distanceMeters ?? null;
    const pace =
      metrics?.avgPaceSecondsPerKm ??
      (distance && recordedSeconds ? Math.round(recordedSeconds / (distance / 1000)) : null);
    return {
      modality: 'RUNNING',
      title,
      durationSeconds,
      distanceMeters: distance,
      avgPaceSecondsPerKm: pace !== null && pace >= 100 && pace <= 1_800 ? pace : null,
      avgHeartRate: metrics?.avgHeartRate ?? null,
      elevationGainMeters: metrics?.elevationGainMeters ?? null,
      splits: splitsOf(metrics),
      rpe,
      treadmill,
    };
  }
  if (source.modality === 'HYROX') {
    const blocks = content?.modality === 'HYROX' ? content.blocks : [];
    const rounds = content?.modality === 'HYROX' ? content.rounds : 1;
    const plannedRun =
      blocks.reduce((sum, b) => sum + (b.type === 'RUN' ? b.distanceMeters : 0), 0) * rounds;
    // Com o tempo de cada estação vindo do relógio, ele vale; senão, as estações do circuito.
    const stations =
      metrics?.stations && metrics.stations.length > 0
        ? metrics.stations.map((s) => ({
            station: s.station,
            seconds: Math.round(s.durationSeconds),
          }))
        : blocks.flatMap((b) =>
            b.type === 'STATION' ? [{ station: b.station, seconds: null }] : [],
          );
    return {
      modality: 'HYROX',
      title,
      durationSeconds,
      runDistanceMeters: metrics?.distanceMeters ?? (plannedRun > 0 ? plannedRun : null),
      rounds,
      stations: stations.slice(0, 16),
      rpe,
    };
  }
  return {
    modality: 'EXTERNAL_SPORT',
    title,
    sport: content?.modality === 'EXTERNAL_SPORT' ? content.label : title,
    durationSeconds,
    rpe,
  };
}
