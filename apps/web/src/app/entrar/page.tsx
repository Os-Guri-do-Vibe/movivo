import type { Metadata } from 'next';
import Image from 'next/image';

import { LoginForm } from '@/components/dashboard/login-form';
import { LoginBackground } from '@/components/login/login-background';

export const metadata: Metadata = {
  // `absolute` ignora o `title.template` (" · MOVIVO") do layout raiz — a aba deve
  // mostrar exatamente "Movivo - Plataforma Interna", sem sufixo.
  title: { absolute: 'Movivo - Plataforma Interna' },
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
    <main className="login-fixed relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-10">
      <LoginBackground />
      <section
        aria-labelledby="login-title"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      >
        <h1 id="login-title" className="sr-only">
          Entrar no MOVIVO Control Center
        </h1>
        {/* O SVG do logo é lettering branco sobre fundo transparente (uso pensado pra fundo
            escuro, mesmo padrão do header em `/anamnese`) — precisa da faixa petróleo
            por trás pra não ficar invisível sobre o card branco. */}
        <div className="flex flex-col items-center justify-center gap-2 bg-petroleo px-6 py-8">
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={176}
            height={46}
            unoptimized
            className="h-auto w-44"
          />
        </div>
        {/* `onboarding-light`: mesma trava de contraste do resto do produto — o anel de
            foco em Verde Pulso reprova WCAG sobre claro (1,59:1), então aqui ele volta a
            ser Petróleo (13,3:1), como em qualquer outra superfície clara do design system. */}
        <div className="onboarding-light bg-background p-6 sm:p-8">
          <LoginForm initialError={initialError} />
        </div>
      </section>
    </main>
  );
}
