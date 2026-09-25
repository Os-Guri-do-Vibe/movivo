'use client';

/**
 * Landing do magic link de treino (US-8.1). Mesma casca de `/anamnese` (achado
 * 2026-09-04, a pedido do fundador): faixa `bg-petroleo` de ponta a ponta com a logo
 * centralizada, página clara (`onboarding-light`) por baixo — nunca mais um cartão
 * flutuando sobre fundo escuro. Tokens semânticos (`bg-primary`, `text-foreground`,
 * `border-destructive`...) em vez de `var(--...)` cru, para ficar igual ao resto do
 * fluxo de onboarding, não uma variação à parte.
 */
import { ArrowRight, LockKeyhole } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function WorkoutAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [firstName, setFirstName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    // React executa Effects duas vezes no Strict Mode de desenvolvimento. Depois da
    // primeira passagem o fragmento já foi removido; não podemos apagar o token em memória.
    if (value) {
      setToken(value);
      // So le o nome pra saudacao - nunca consome o token nem bloqueia o fluxo se falhar.
      fetch(`/api/workout/access/peek?token=${encodeURIComponent(value)}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((data: { firstName?: string | null }) => setFirstName(data.firstName ?? ''))
        .catch(() => {});
    }
    history.replaceState(null, '', '/treino/acessar');
  }, []);

  /** Sessão de 30 dias já trocada neste MESMO navegador (ver `exchangeMagicToken`/`COOKIE`
   *  em `_lib/bff.ts`) — se existir, o check-in do dia segue mesmo sem gastar o link. */
  async function hasActiveSession(): Promise<boolean> {
    const existing = await fetch('/api/workout/journal', { cache: 'no-store' });
    return existing.ok;
  }

  async function openWorkout() {
    if (!token) {
      if (await hasActiveSession()) return router.replace('/treino');
      setError('Link incompleto. Abra novamente a mensagem recebida no WhatsApp.');
      return;
    }
    setBusy(true);
    setError('');
    const response = await fetch('/api/workout/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (response.ok) {
      router.replace('/treino');
      return;
    }
    /**
     * Achado 2026-09-10 (pedido do fundador): o token do link só pode ser trocado UMA
     * vez. Se o aluno já abriu este MESMO link antes (mesmo sem querer) e fechou tudo,
     * reabri-lo de novo cai aqui direto — mas o navegador dele já pode ter a sessão de
     * 30 dias daquela primeira troca. Antes de bloquear o check-in do dia com "link já
     * usado", confere se já existe sessão válida; só mostra erro se não existir.
     */
    if (await hasActiveSession()) return router.replace('/treino');
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    setError(body?.message ?? 'Não foi possível abrir este link.');
    setBusy(false);
  }

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
      <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-8">
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <LockKeyhole aria-hidden="true" className="mx-auto mb-5 size-10 text-verde-pulso" />
          <h1 className="text-h1 font-extrabold tracking-tight text-foreground">
            Tudo pronto{firstName ? `, ${firstName}` : ''}.
          </h1>
          <p className="mt-3 text-body leading-7 text-muted-foreground">
            Seu treino de hoje e o check-in estão te esperando. Este link veio do seu WhatsApp e é
            só seu. Toque abaixo para abrir o planejamento com segurança.
          </p>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
            >
              {error}
            </p>
          ) : null}
        </section>
        <button
          type="button"
          onClick={openWorkout}
          disabled={busy}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {busy ? 'Abrindo...' : 'Abrir meu treino'} <ArrowRight size={20} aria-hidden="true" />
        </button>
      </main>
    </div>
  );
}
