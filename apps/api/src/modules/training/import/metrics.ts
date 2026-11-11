import { enduranceMetricsSchema, type EnduranceMetrics } from '@movivo/shared';

export interface ParsedActivity {
  metrics: EnduranceMetrics;
  sport: 'RUNNING' | 'CYCLING' | 'OTHER';
}

/** Remove `undefined`, calcula o ritmo médio e valida contra o contrato de métricas. */
export function finalizeMetrics(
  raw: EnduranceMetrics,
  extra: { sport: ParsedActivity['sport'] },
): ParsedActivity {
  const metrics: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    metrics[key] = value;
  }
  const seconds = (metrics.movingSeconds ?? metrics.elapsedSeconds) as number | undefined;
  const meters = metrics.distanceMeters as number | undefined;
  if (seconds && meters && meters >= 100) {
    const pace = (seconds / meters) * 1000;
    if (pace >= 100 && pace <= 1_800) metrics.avgPaceSecondsPerKm = Math.round(pace);
  }
  return { metrics: enduranceMetricsSchema.parse(metrics), sport: extra.sport };
}
