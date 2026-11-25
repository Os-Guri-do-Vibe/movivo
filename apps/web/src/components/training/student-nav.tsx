'use client';

import Image from 'next/image';
import Link from 'next/link';
import { createContext, useContext, type ReactNode } from 'react';

const LINKS = [
  { href: '/hoje', label: 'Treino' },
  { href: '/alimentacao', label: 'Alimentação' },
  { href: '/evolucao', label: 'Evolução' },
] as const;

type StudentPage = (typeof LINKS)[number]['href'];

/**
 * Para onde cada aba leva. Na página do aluno são as rotas de sempre; a demonstração local troca
 * pelas rotas dela (`/hoje/demo/...`), para navegar entre as abas sem sair da simulação.
 */
const StudentPathsContext = createContext<Readonly<Record<StudentPage, string>>>({
  '/hoje': '/hoje',
  '/alimentacao': '/alimentacao',
  '/evolucao': '/evolucao',
});

export function StudentPathsProvider({
  paths,
  children,
}: {
  paths: Readonly<Record<StudentPage, string>>;
  children: ReactNode;
}) {
  return <StudentPathsContext.Provider value={paths}>{children}</StudentPathsContext.Provider>;
}

/** Faixa petróleo de ponta a ponta com a logo: a mesma do check-in diário e do acesso por link. */
function LogoBand() {
  return (
    <header className="flex w-full justify-center bg-petroleo px-6 py-6" aria-label="MOVIVO">
      <Image
        src="/brand/movivo-logo-horizontal.svg"
        alt="MOVIVO"
        width={176}
        height={46}
        preload
        unoptimized
        className="h-auto w-[154px] sm:w-44"
      />
    </header>
  );
}

/**
 * Navegação entre as páginas do aluno (todas usam a mesma sessão do link mágico), no padrão do
 * check-in diário: cartão branco com a aba ativa em petróleo.
 */
export function StudentNav({ current }: { current: StudentPage }) {
  const paths = useContext(StudentPathsContext);
  return (
    <nav aria-label="Seções" className="grid grid-cols-3 gap-1 rounded-2xl bg-card p-1 shadow-sm">
      {LINKS.map((link) => {
        const active = link.href === current;
        return (
          <Link
            key={link.href}
            href={paths[link.href]}
            aria-current={active ? 'page' : undefined}
            className={`grid min-h-11 place-items-center rounded-xl px-2 text-label font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${active ? 'bg-petroleo text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Casco das páginas do aluno: sempre claro (a página abre pelo WhatsApp, no celular), faixa com
 * a logo, as abas e uma coluna estreita de leitura. Carregamento e erro usam o mesmo casco, para
 * a página não "piscar" de um layout para outro.
 */
export function StudentShell({
  current,
  busy = false,
  children,
}: {
  current: StudentPage;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <main
      aria-busy={busy || undefined}
      className="protocolo-light min-h-dvh bg-background pb-28 text-foreground"
    >
      <LogoBand />
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pt-5">
        <StudentNav current={current} />
        {children}
      </div>
    </main>
  );
}

/** Aviso de erro no padrão das páginas do aluno. */
export function StudentAlert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
    >
      {children}
    </p>
  );
}

/** Saudação do topo: "Olá, Ana" em destaque, com o assunto da página logo abaixo. */
export function StudentGreeting({
  firstName,
  title,
  children,
}: {
  firstName: string | null;
  /** Assunto da página ("seu treino"): entra no título para o leitor de tela. */
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h1 className="text-h1 font-extrabold text-foreground">
        {firstName ? (
          <>
            <span className="font-normal text-muted-foreground">Olá, </span>
            {firstName}
            <span className="sr-only">, {title}</span>
          </>
        ) : (
          title.charAt(0).toUpperCase() + title.slice(1)
        )}
      </h1>
      {children ? <p className="text-label text-muted-foreground">{children}</p> : null}
    </section>
  );
}
