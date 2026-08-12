import type { Metadata } from 'next';
import Link from 'next/link';

import {
  SUBSCRIPTION_PLANS,
  subscriptionViewSchema,
  type SubscriptionStatus,
  type SubscriptionView,
} from '@movivo/shared';

import { ManageSubscription } from '@/components/conta/manage-subscription';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { formatBRL } from '@/lib/subscription-api';
import { publicEnv } from '@/lib/env';

/**
 * Portal de gestão da assinatura (US-4.6) — RSC. Busca o estado por token (= userId) e
 * mostra plano, status e próxima cobrança; as ações (cancelar/pausar/retomar) vivem no
 * client component `ManageSubscription`. Token inválido/sem assinatura → estado neutro,
 * sem vazar dado (o backend devolve 404). Copy nos guardrails.
 */
export const metadata: Metadata = {
  title: 'Sua conta · MOVIVO',
  robots: { index: false },
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Período de teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento pendente',
  PAUSED: 'Pausada',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
};

async function fetchView(token: string): Promise<SubscriptionView | null> {
  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl}/subscription/${token}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = subscriptionViewSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-10 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 font-mono text-label tracking-wide text-muted-foreground">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
          movivo
        </p>
        <ThemeToggle />
      </header>
      {children}
    </div>
  );
}

export default async function ContaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await fetchView(token);

  if (!view) {
    return (
      <Shell>
        <main id="conteudo" className="flex flex-1 flex-col justify-center gap-4">
          <p className="font-mono text-label text-muted-foreground">conta indisponível</p>
          <h1 className="text-h1 font-bold">Não encontramos esta conta</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            O link pode ter expirado ou estar incorreto. Abra o link mais recente enviado no seu
            WhatsApp.
          </p>
        </main>
      </Shell>
    );
  }

  const planLabel = SUBSCRIPTION_PLANS.find((p) => p.id === view.plan);
  const inactive = view.status === 'CANCELED' || view.status === 'EXPIRED';

  return (
    <Shell>
      <main id="conteudo" className="flex flex-1 flex-col gap-8">
        <section className="flex flex-col gap-3">
          <h1 className="text-h1 font-bold">Sua conta</h1>
          <dl className="flex flex-col gap-4 rounded-lg bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-label text-muted-foreground">Plano</dt>
              <dd className="text-body font-medium">
                {planLabel ? `${planLabel.label} · ${formatBRL(planLabel.priceCents)}` : view.plan}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-label text-muted-foreground">Situação</dt>
              <dd className="text-body font-medium">{STATUS_LABEL[view.status]}</dd>
            </div>
            {view.currentPeriodEnd ? (
              <div className="flex items-center justify-between gap-4">
                <dt className="text-label text-muted-foreground">
                  {view.status === 'CANCELED' ? 'Acesso até' : 'Próxima cobrança'}
                </dt>
                <dd className="text-body font-medium">
                  <time dateTime={view.currentPeriodEnd}>
                    {new Date(view.currentPeriodEnd).toLocaleDateString('pt-BR')}
                  </time>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section aria-labelledby="titulo-gerenciar" className="flex flex-col gap-4">
          <h2 id="titulo-gerenciar" className="text-h2 font-semibold">
            Gerenciar assinatura
          </h2>
          {inactive ? (
            <div className="flex flex-col gap-3">
              <p className="max-w-prose text-body text-muted-foreground">
                Sua assinatura não está ativa. Você pode voltar a treinar com a MOVIVO quando
                quiser.
              </p>
              <Button asChild className="w-full sm:w-auto">
                <Link href={`/assinar/${token}`}>Ver planos</Link>
              </Button>
            </div>
          ) : (
            <ManageSubscription token={token} status={view.status} />
          )}
        </section>
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
    </Shell>
  );
}
