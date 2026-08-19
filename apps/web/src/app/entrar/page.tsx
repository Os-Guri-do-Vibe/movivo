import type { Metadata } from 'next';
import Image from 'next/image';

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
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <h1 id="login-title" className="sr-only">
          Entrar no MOVIVO Control Center
        </h1>
        {/* O SVG do logo é lettering branco sobre fundo transparente (uso pensado pra fundo
            escuro, mesmo padrão do header em `/anamnese/[token]`) — precisa da faixa petróleo
            por trás pra não ficar invisível sobre o card branco. */}
        <div className="flex items-center justify-center bg-petroleo px-6 py-8">
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={176}
            height={46}
            unoptimized
            className="h-auto w-44"
          />
        </div>
        <div className="p-6 sm:p-8">
          <LoginForm initialError={initialError} />
        </div>
      </section>
    </main>
  );
}
