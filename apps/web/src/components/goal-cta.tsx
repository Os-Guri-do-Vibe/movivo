'use client';

import * as React from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isAnalyticsEnabled } from '@/lib/env';

/**
 * Pré-qualifying de objetivo (1 clique) + CTA único da landing (US-1.5, Sofia §9.1).
 *
 * A seleção pinta o chip em Verde Pulso e vira o `primary_goal` que segue como query
 * param para o início da anamnese (US-1.6, rota `/anamnese`). O CTA funciona mesmo sem
 * objetivo escolhido — pré-qualifying é aceleração de funil, não gate.
 *
 * Analytics: dispara `form_started` no clique do CTA reutilizando o singleton do
 * PostHog já inicializado em `instrumentation-client.ts` (US-0.5). Sem key válida a
 * captura é pulada — analytics nunca bloqueia a navegação.
 */
const GOALS = [
  { value: 'perder_peso', label: 'Perder peso' },
  { value: 'ganhar_massa', label: 'Ganhar massa' },
  { value: 'condicionamento', label: 'Condicionamento' },
] as const;

type GoalValue = (typeof GOALS)[number]['value'];

export function GoalCta() {
  const [goal, setGoal] = React.useState<GoalValue | null>(null);

  const href = goal ? `/anamnese?goal=${goal}` : '/anamnese';

  function handleStart() {
    if (!isAnalyticsEnabled) return;
    void import('posthog-js').then(({ default: posthog }) => {
      posthog.capture('form_started', { primary_goal: goal ?? 'nao_informado' });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="text-h3 font-semibold">Qual é o seu foco agora?</legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {GOALS.map((item) => {
            const selected = goal === item.value;
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setGoal(item.value)}
                className={cn(
                  'inline-flex min-h-11 items-center justify-center rounded-lg border px-5 py-2 text-body font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link href={href} onClick={handleStart}>
          Começar agora
        </Link>
      </Button>

      <p className="text-label text-muted-foreground">
        grátis por 7 dias · sem cartão · cancele quando quiser
      </p>
    </div>
  );
}
