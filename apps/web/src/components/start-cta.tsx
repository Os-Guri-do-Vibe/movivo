'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { isAnalyticsEnabled } from '@/lib/env';

/**
 * CTA único da landing (US-1.5, Sofia §9.1).
 *
 * Nenhuma informação de anamnese é coletada aqui — o objetivo é perguntado no bloco 1
 * do formulário (`/anamnese`), que é o único ponto de coleta.
 *
 * Analytics: dispara `form_started` no clique do CTA reutilizando o singleton do
 * PostHog já inicializado em `instrumentation-client.ts` (US-0.5). Sem key válida a
 * captura é pulada — analytics nunca bloqueia a navegação.
 */
export function StartCta() {
  function handleStart() {
    if (!isAnalyticsEnabled) return;
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.capture('form_started');
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href="/anamnese" onClick={handleStart}>
          Começar agora
        </Link>
      </Button>

      <p className="text-label text-muted-foreground">
        grátis por 7 dias · sem cartão · cancele quando quiser
      </p>
    </div>
  );
}
