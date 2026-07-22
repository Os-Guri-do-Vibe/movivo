import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Página não encontrada',
};

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-6 px-6 py-10">
      <p className="font-mono text-label text-muted-foreground">erro 404</p>
      <h1 className="text-h1 font-bold">Esta página não existe</h1>
      <p className="max-w-prose text-body text-muted-foreground">
        O endereço acessado não corresponde a nenhuma página da MOVIVO.
      </p>
      <div>
        <Button asChild>
          <Link href="/">Voltar ao início</Link>
        </Button>
      </div>
    </main>
  );
}
