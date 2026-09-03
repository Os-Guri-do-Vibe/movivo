import type { Metadata } from 'next';

import { subscriptionPlanIdSchema, type SubscriptionPlanId } from '@movivo/shared';

import { PlanSelector } from '@/components/assinatura/plan-selector';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Página de seleção/confirmação de plano (US-4.6) — RSC. Mostra os 4 planos, pré-seleciona
 * pelo `?plano=` (querystring dos links de conversão), mantém a garantia de cancelamento e o
 * respaldo CREF sempre visíveis, e leva ao checkout hospedado. Sem campo de cartão (PCI).
 *
 * Copy nos guardrails (CLAUDE.md): sem promessa de resultado, a IA nunca decide sozinha.
 */
export const metadata: Metadata = {
  title: 'Assine a MOVIVO',
  robots: { index: false },
};

/** Plano recomendado (pré-seleção padrão quando o `?plano=` é ausente/ inválido). */
const DEFAULT_PLAN: SubscriptionPlanId = 'SEMIANNUAL';

function resolvePlan(raw: string | undefined): SubscriptionPlanId {
  const parsed = subscriptionPlanIdSchema.safeParse(raw?.toUpperCase());
  return parsed.success ? parsed.data : DEFAULT_PLAN;
}

export default async function AssinarPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ plano?: string }>;
}) {
  const [{ token }, { plano }] = await Promise.all([params, searchParams]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-10 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 font-mono text-label tracking-wide text-muted-foreground">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
          movivo
        </p>
        <ThemeToggle />
      </header>

      <main id="conteudo" className="flex flex-1 flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h1 className="text-h1 font-bold">Continue treinando com a MOVIVO</h1>
          <p className="max-w-prose text-h3 text-muted-foreground">
            Escolha o plano que combina com você. Você pode pausar ou cancelar quando quiser, sem
            burocracia.
          </p>
        </section>

        <PlanSelector token={token} initialPlan={resolvePlan(plano)} />

        <p className="rounded-lg bg-card p-4 text-body text-card-foreground">
          <strong className="font-semibold">Cancele a qualquer momento.</strong> Sem multa e sem
          ligação. Você faz o cancelamento em poucos toques, na sua conta.
        </p>
      </main>

      <footer className="flex items-start gap-3 border-t border-border pt-6">
        <span aria-hidden="true" className="text-h3 leading-none">
          🛡
        </span>
        <p className="font-mono text-label text-muted-foreground">
          A MOVIVO conta com a responsabilidade técnica de um profissional de Educação Física
          registrado no CREF. A IA é uma ferramenta de apoio. A orientação é sempre supervisionada
          por esse profissional.
        </p>
      </footer>
    </div>
  );
}
