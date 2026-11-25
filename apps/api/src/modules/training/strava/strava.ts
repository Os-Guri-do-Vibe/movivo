/**
 * Strava (regras puras): comandos do WhatsApp, atividade → registro de treino e mensagens.
 */
import { enduranceMetricsSchema, type EnduranceMetrics } from '@movivo/shared';
import { z } from 'zod';

export const STRAVA_DISCONNECT_PHRASE = 'DESCONECTAR STRAVA';

/** Só os campos usados; o resto da atividade (nome, mapa, fotos) nunca é lido. */
export const stravaActivitySchema = z.object({
  id: z.number().int().positive(),
  sport_type: z.string().max(40),
  start_date: z.string(),
  start_date_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  distance: z.number().nonnegative().optional(),
  moving_time: z.number().nonnegative(),
  elapsed_time: z.number().nonnegative().optional(),
  total_elevation_gain: z.number().optional(),
  average_heartrate: z.number().optional(),
  max_heartrate: z.number().optional(),
  perceived_exertion: z.number().nullable().optional(),
});
export type StravaActivity = z.infer<typeof stravaActivitySchema>;

/** Evento do webhook do Strava (não assinado: só serve de gatilho para buscar na API). */
export const stravaEventSchema = z.object({
  object_type: z.enum(['activity', 'athlete']),
  object_id: z.number().int().positive(),
  aspect_type: z.enum(['create', 'update', 'delete']),
  owner_id: z.number().int().positive(),
  updates: z.record(z.string(), z.unknown()).optional(),
});

export type StravaCommand = 'CONNECT' | 'DISCONNECT';

export function parseStravaCommand(text: string): StravaCommand | null {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
  if (normalized === STRAVA_DISCONNECT_PHRASE) return 'DISCONNECT';
  return normalized.length <= 80 &&
    /\b(CONECTAR|INTEGRAR|VINCULAR|LIGAR|SINCRONIZAR)\b.*\bSTRAVA\b/.test(normalized)
    ? 'CONNECT'
    : null;
}

const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);
const STRENGTH = new Set(['WeightTraining']);

/** Métricas válidas: valor fora do contrato fica de fora em vez de derrubar o registro. */
function metricsOf(activity: StravaActivity, running: boolean): EnduranceMetrics {
  const distance = activity.distance && activity.distance > 0 ? activity.distance : undefined;
  const candidate: Record<string, number | undefined> = {
    distanceMeters: distance,
    movingSeconds: activity.moving_time,
    elapsedSeconds: activity.elapsed_time,
    avgPaceSecondsPerKm:
      running && distance ? Math.round((activity.moving_time / distance) * 1000) : undefined,
    avgHeartRate:
      activity.average_heartrate !== undefined ? Math.round(activity.average_heartrate) : undefined,
    maxHeartRate:
      activity.max_heartrate !== undefined ? Math.round(activity.max_heartrate) : undefined,
    elevationGainMeters: activity.total_elevation_gain,
  };
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (value === undefined) continue;
    const field = enduranceMetricsSchema.shape[key as keyof EnduranceMetrics];
    if (field.safeParse(value).success) metrics[key] = value;
  }
  return metrics as EnduranceMetrics;
}

export function activityImport(activity: StravaActivity) {
  const running = RUNNING.has(activity.sport_type);
  const rpe = activity.perceived_exertion;
  return {
    externalId: `strava:${activity.id}`,
    modality: running
      ? 'RUNNING'
      : STRENGTH.has(activity.sport_type)
        ? 'STRENGTH'
        : 'EXTERNAL_SPORT',
    performedOn: activity.start_date_local.slice(0, 10),
    startedAt: new Date(activity.start_date),
    durationMinutes: Math.max(1, Math.round(activity.moving_time / 60)),
    metrics: metricsOf(activity, running),
    rpe: typeof rpe === 'number' && rpe >= 1 && rpe <= 10 ? Math.round(rpe) : null,
  } as const;
}

const duration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

const MODALITY_LABEL = {
  RUNNING: 'corrida',
  STRENGTH: 'treino de força',
  EXTERNAL_SPORT: 'atividade',
};

export function importedMessage(
  imported: ReturnType<typeof activityImport>,
  planned: boolean,
): string {
  const km = imported.metrics.distanceMeters
    ? ` de ${(imported.metrics.distanceMeters / 1000).toFixed(1).replace('.', ',')} km`
    : '';
  const time = imported.metrics.movingSeconds
    ? ` em ${duration(imported.metrics.movingSeconds)}`
    : '';
  return [
    `Recebi do Strava: ${MODALITY_LABEL[imported.modality]}${km}${time}.`,
    planned
      ? 'Marquei como feito o treino do plano desse dia.'
      : 'Registrei como treino fora do plano.',
    'Se quiser, me conta como você se sentiu.',
  ].join(' ');
}

export const connectMessage = (link: string) =>
  `Para conectar o Strava, abra o link e autorize a MOVIVO a ler as suas atividades: ${link}\n\nO link vale por 1 hora. Depois disso, cada atividade nova entra sozinha no seu registro de treinos.`;

export const CONNECTED_MESSAGE = `Strava conectado. A partir de agora, cada atividade nova entra sozinha no seu registro de treinos. Para desconectar, envie *${STRAVA_DISCONNECT_PHRASE}*.`;

export const DISCONNECTED_MESSAGE =
  'Strava desconectado. Não recebemos mais as suas atividades e apagamos o acesso que você tinha autorizado.';
