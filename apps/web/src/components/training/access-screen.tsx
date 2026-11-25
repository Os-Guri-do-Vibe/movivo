'use client';

import { ArrowRight, Dumbbell, LockKeyhole, TrendingUp, Utensils } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';

/** O que o check-in do dia reúne (não é mais só o treino). */
const INSIDE = [
  { label: 'Treino', icon: Dumbbell },
  { label: 'Alimentação', icon: Utensils },
  { label: 'Evolução', icon: TrendingUp },
] as const;

/**
 * Etapa 1 do check-in diário: o acesso pelo link do WhatsApp, sem login nem senha. Mesma casca
 * de `/anamnese`: faixa petróleo com a logo e a página clara por baixo. A lógica (troca do token,
 * novo link) fica na página; aqui só o desenho, para a demonstração usar o mesmo.
 */
export function AccessScreen({
  firstName,
  busy,
  error,
  onOpen,
  children,
}: {
  firstName: string;
  busy: boolean;
  error: string;
  onOpen: () => void;
  /** Ajuda extra abaixo do erro (pedir um novo link). */
  children?: ReactNode;
}) {
  return (
    <div className="onboarding-light flex min-h-dvh w-full flex-col overflow-x-hidden bg-white text-foreground">
      <header className="w-full bg-petroleo" aria-label="MOVIVO">
        <div className="mx-auto flex h-[72px] w-full max-w-[640px] items-center justify-center px-5 sm:h-20 sm:px-8">
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={176}
            height={46}
            preload
            unoptimized
            className="h-auto w-[154px] sm:w-44"
          />
        </div>
      </header>
      {/* No celular o botão fica embaixo, perto do polegar; em telas maiores, logo abaixo do texto. */}
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-5 pt-8 pb-6 sm:justify-center sm:px-8 sm:py-12">
        <section className="flex flex-1 flex-col items-center justify-center text-center sm:flex-none">
          <LockKeyhole aria-hidden="true" className="mx-auto mb-5 size-10 text-verde-pulso" />
          <h1 className="text-h1 font-extrabold tracking-tight text-balance text-foreground">
            Tudo pronto{firstName ? `, ${firstName}` : ''}.
          </h1>
          <p className="mt-3 max-w-md text-body leading-7 text-balance text-muted-foreground">
            Seu dia em um só lugar. Link pessoal, sem login e sem senha.
          </p>
          <ul
            aria-label="No seu check-in"
            className="mt-8 grid w-full max-w-sm grid-cols-3 gap-3 sm:mt-10"
          >
            {INSIDE.map(({ label, icon: Icon }) => (
              <li key={label} className="flex flex-col items-center gap-2">
                <span className="grid size-12 place-items-center rounded-full bg-verde-pulso/15 sm:size-14">
                  <Icon aria-hidden="true" className="size-6 text-petroleo" />
                </span>
                <span className="text-label font-bold text-foreground">{label}</span>
              </li>
            ))}
          </ul>
          {error ? (
            <p
              role="alert"
              className="mt-6 w-full rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
            >
              {error}
            </p>
          ) : null}
          {children}
        </section>
        <button
          type="button"
          onClick={onOpen}
          disabled={busy}
          className="mt-8 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground sm:mx-auto sm:mt-10 sm:max-w-sm"
        >
          {busy ? 'Abrindo...' : 'Abrir meu check-in'} <ArrowRight size={20} aria-hidden="true" />
        </button>
      </main>
    </div>
  );
}
