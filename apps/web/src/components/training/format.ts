import {
  HYROX_STATION_LABELS,
  RUNNING_SESSION_KIND_LABELS,
  type EnduranceTarget,
  type HyroxBlock,
  type RunningSegment,
  type SessionContent,
} from '@movivo/shared';

const SEGMENT_LABELS: Record<RunningSegment['type'], string> = {
  WARMUP: 'Aquecimento',
  STEADY: 'Contínuo',
  WORK: 'Esforço',
  RECOVERY: 'Recuperação',
  STRIDES: 'Tiros curtos',
  COOLDOWN: 'Desaquecimento',
};

/** 330 → "5:30". */
export function paceLabel(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function targetLabel(target: EnduranceTarget): string {
  switch (target.by) {
    case 'ZONE':
      return `zona ${target.zone.slice(1)}`;
    case 'PACE':
      return `ritmo ${paceLabel(target.secondsPerKm.min)}–${paceLabel(target.secondsPerKm.max)} /km`;
    case 'HEART_RATE':
      return `FC ${target.bpm.min}–${target.bpm.max} bpm`;
    case 'RPE':
      return `esforço ${target.rpe.min}–${target.rpe.max} de 10`;
  }
}

function volumeLabel(distanceMeters?: number, durationSeconds?: number): string {
  if (distanceMeters !== undefined) {
    return distanceMeters >= 1000
      ? `${(distanceMeters / 1000).toLocaleString('pt-BR')} km`
      : `${distanceMeters} m`;
  }
  const seconds = durationSeconds ?? 0;
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
}

export function segmentLine(segment: RunningSegment): string {
  const repeat = segment.repeat && segment.repeat > 1 ? `${segment.repeat} × ` : '';
  return `${SEGMENT_LABELS[segment.type]}: ${repeat}${volumeLabel(segment.distanceMeters, segment.durationSeconds)} — ${targetLabel(segment.target)}`;
}

export function hyroxBlockLine(block: HyroxBlock): string {
  if (block.type === 'RUN') {
    return `Corrida ${volumeLabel(block.distanceMeters)} — ${targetLabel(block.target)}`;
  }
  if (block.type === 'REST') return `Descanso ${block.durationSeconds} s`;
  const volume = block.distanceMeters
    ? `${block.distanceMeters} m`
    : block.reps
      ? `${block.reps} reps`
      : `${block.durationSeconds} s`;
  return `${HYROX_STATION_LABELS[block.station]}: ${volume}${block.loadKg ? ` com ${block.loadKg} kg` : ''}`;
}

/** Linhas de prescrição para modalidades de resistência (corrida, HYROX). */
export function enduranceLines(content: SessionContent): string[] {
  if (content.modality === 'RUNNING') {
    return [RUNNING_SESSION_KIND_LABELS[content.kind], ...content.segments.map(segmentLine)];
  }
  if (content.modality === 'HYROX') {
    const rounds = content.rounds > 1 ? [`${content.rounds} voltas do circuito`] : [];
    return [...rounds, ...content.blocks.map(hyroxBlockLine)];
  }
  return [];
}

/** "1h05" / "28 min" a partir de segundos. */
export function durationLabel(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
}

export function dateLabel(date: string): string {
  const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const d = new Date(`${date}T00:00:00Z`);
  return `${weekdays[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
