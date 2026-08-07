'use client';

import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sem conteúdo sensível: somente digest técnico gerado pelo Next.
    if (error.digest) console.error('dashboard_render_failed', error.digest);
  }, [error.digest]);

  return (
    <section role="alert" className="rounded-xl border border-coral bg-card p-6">
      <h1 className="text-h2 font-bold">O dashboard encontrou um erro</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Nenhuma ação foi aplicada. Tente carregar esta área novamente.
      </p>
      <Button className="mt-4" onClick={reset}>
        <RefreshCw aria-hidden="true" /> Tentar novamente
      </Button>
    </section>
  );
}
