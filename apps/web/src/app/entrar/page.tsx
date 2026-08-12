import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { LoginForm } from '@/components/dashboard/login-form';

export const metadata: Metadata = {
  title: 'Entrar no MOVIVO Control Center',
  description: 'Acesso restrito à operação interna da MOVIVO.',
  robots: { index: false, follow: false, nocache: true },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  const initialError =
    erro === 'sem-permissao'
      ? 'Esta conta não tem permissão para acessar o Control Center.'
      : erro === 'sessao-expirada'
        ? 'Sua sessão expirou. Entre novamente.'
        : '';
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <section
        aria-labelledby="login-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-petroleo text-verde-pulso"
          >
            <ShieldCheck />
          </span>
          <div>
            <p className="font-mono text-label text-muted-foreground">movivo · área restrita</p>
            <h1 id="login-title" className="text-h2 font-bold">
              Control Center
            </h1>
          </div>
        </div>
        <p className="mb-6 text-body text-muted-foreground">
          Plataforma interna para operação, supervisão profissional e monitoramento da MOVIVO.
        </p>
        <LoginForm initialError={initialError} />
        <p className="mt-6 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground">
          Sessão protegida com cookies inacessíveis ao JavaScript, rotação e acesso por
          responsabilidade. A IA é ferramenta; decisões de liberação e mudanças são humanas.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex min-h-11 items-center text-label font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          Voltar para o site
        </Link>
      </section>
    </main>
  );
}
