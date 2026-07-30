'use client';

import * as React from 'react';

import { isAnalyticsEnabled } from '@/lib/env';

/**
 * Dispara `protocol_viewed` uma vez ao montar, reutilizando o singleton do PostHog já
 * inicializado em `instrumentation-client.ts` (US-0.5) — mesmo mecanismo da landing e da
 * anamnese. Sem key válida a captura é pulada; analytics nunca bloqueia a página. Não
 * envia PII (o token é o próprio segredo — fora do evento).
 */
export function ProtocolViewed(): null {
  React.useEffect(() => {
    if (!isAnalyticsEnabled) return;
    void import('posthog-js').then(({ default: posthog }) => posthog.capture('protocol_viewed'));
  }, []);
  return null;
}
