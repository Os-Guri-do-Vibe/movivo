import { isAnalyticsEnabled } from './env';

/** Erro de uma chamada do painel à API (status HTTP, mensagem e detalhes opcionais). */
export class DashboardApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
    /** Código de negócio do backend. */
    readonly code?: string,
  ) {
    super(message);
  }
}

export function captureDashboardEvent(
  name: string,
  properties: Record<string, unknown> = {},
): void {
  if (!isAnalyticsEnabled) return;
  void import('posthog-js').then(({ default: posthog }) => posthog.capture(name, properties));
}
