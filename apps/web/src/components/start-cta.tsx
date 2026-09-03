'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { isAnalyticsEnabled } from '@/lib/env';
import { captureFirstTouch } from '@/lib/first-touch';
import { cn } from '@/lib/utils';

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
type StartCtaProps = {
  label?: string;
  location?: string;
  microcopy?: string;
  showMicrocopy?: boolean;
  className?: string;
  buttonClassName?: string;
};

export function StartCta({
  label = 'Começar agora',
  location = 'landing',
  microcopy = '7 dias grátis, sem cartão e sem cobrança automática.',
  showMicrocopy = true,
  className,
  buttonClassName,
}: StartCtaProps = {}) {
  // Primeiro toque (US-8.2): a query string chega AQUI, na landing, e some na
  // navegação para `/anamnese`. Capturar na montagem é o que faz a origem
  // sobreviver até a criação da sessão no servidor.
  React.useEffect(() => {
    captureFirstTouch();
  }, []);

  function handleStart() {
    if (!isAnalyticsEnabled) return;
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.capture('form_started');
    });
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Button asChild size="lg" className={cn('w-full rounded-full sm:w-auto', buttonClassName)}>
        <Link
          href="/anamnese"
          onClick={handleStart}
          data-analytics-event={`${location}_anamnesis_click`}
        >
          <Image src="/brand/whatsapp-icon.svg" alt="" width={22} height={22} aria-hidden="true" />
          {label}
        </Link>
      </Button>

      {showMicrocopy ? <p className="text-label text-muted-foreground">{microcopy}</p> : null}
    </div>
  );
}
