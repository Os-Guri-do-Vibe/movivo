import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function DashboardNotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <section className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card text-center shadow-sm">
        <div className="flex flex-col items-center bg-petroleo px-6 py-10 text-nevoa">
          <Compass aria-hidden="true" className="mb-5 size-12 text-verde-pulso" strokeWidth={1.5} />
          <p className="font-mono text-sm tracking-[0.2em] text-verde-pulso">ERRO 404</p>
          <h1 className="mt-3 text-h1 font-bold">Página não encontrada</h1>
        </div>
        <div className="px-6 py-8 sm:px-10">
          <p className="mx-auto max-w-md text-body text-muted-foreground">
            Este endereço não corresponde a uma página do Control Center. Volte ao painel para
            continuar seu trabalho.
          </p>
          <Button asChild className="mt-7">
            <Link href="/dashboard">
              <ArrowLeft aria-hidden="true" /> Voltar ao painel
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
