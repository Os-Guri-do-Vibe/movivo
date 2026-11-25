import type { Metadata } from 'next';

import { planReadSchema, type PlanRead } from '@movivo/shared';

import { PlanView } from '@/components/plano/plan-view';
import { publicEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Seu plano · MOVIVO',
  robots: { index: false },
};

async function fetchPlan(token: string): Promise<PlanRead | null> {
  let res: Response;
  try {
    res = await fetch(
      `${(process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '')}/plans/by-token/${encodeURIComponent(token)}`,
      { cache: 'no-store', headers: { Accept: 'application/json' } },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = planReadSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="protocolo-light min-h-dvh w-full bg-background text-foreground">
      <header className="flex w-full justify-center bg-petroleo px-6 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático de marca, sem otimização de imagem necessária. */}
        <img src="/brand/movivo-logo-horizontal.svg" alt="MOVIVO" className="h-12 w-auto" />
      </header>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-8">{children}</div>
    </div>
  );
}

export default async function PlanoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await fetchPlan(token);
  if (!plan) {
    return (
      <Shell>
        <main id="conteudo" className="flex flex-1 flex-col justify-center gap-4">
          <p className="font-mono text-label text-muted-foreground">link indisponível</p>
          <h1 className="text-h1 font-bold">Não encontramos este plano</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            O link pode ter expirado ou estar incorreto. Abra o link mais recente enviado no seu
            WhatsApp, ou fale com a gente por lá.
          </p>
        </main>
      </Shell>
    );
  }
  return (
    <Shell>
      <PlanView plan={plan} />
    </Shell>
  );
}
