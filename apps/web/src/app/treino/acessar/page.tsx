'use client';

import { ArrowRight, LockKeyhole } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function WorkoutAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    // React executa Effects duas vezes no Strict Mode de desenvolvimento. Depois da
    // primeira passagem o fragmento já foi removido; não podemos apagar o token em memória.
    if (value) setToken(value);
    history.replaceState(null, '', '/treino/acessar');
  }, []);

  async function openWorkout() {
    if (!token) {
      const existing = await fetch('/api/workout/journal', { cache: 'no-store' });
      if (existing.ok) return router.replace('/treino');
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
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? 'Nao foi possivel abrir este link.');
      setBusy(false);
      return;
    }
    router.replace('/treino');
  }

  return (
    <main className="onboarding-light min-h-dvh bg-[var(--petroleo-vivo)] px-5 py-8 text-[var(--grafite)]">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col justify-between rounded-[2rem] bg-white p-7 shadow-2xl">
        <Image
          src="/brand/movivo-logo-horizontal.svg"
          alt="MOVIVO"
          width={180}
          height={40}
          className="h-10 w-auto self-start rounded-lg bg-[var(--petroleo-vivo)] px-3 py-2"
        />
        <section className="py-12">
          <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-[var(--verde-pulso-tenue)] text-[var(--petroleo-vivo)]">
            <LockKeyhole aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">Seu treino, sem senha.</h1>
          <p className="mt-3 text-base leading-7 text-[var(--musgo)]">
            Este acesso veio do seu WhatsApp. Toque abaixo para abrir o planejamento do dia com
            segurança.
          </p>
          {error ? (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
        </section>
        <button
          type="button"
          onClick={openWorkout}
          disabled={busy}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--verde-pulso)] px-5 font-bold text-[var(--petroleo-vivo)] transition hover:brightness-95 disabled:opacity-60"
        >
          {busy ? 'Abrindo...' : 'Abrir meu treino'} <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
    </main>
  );
}
