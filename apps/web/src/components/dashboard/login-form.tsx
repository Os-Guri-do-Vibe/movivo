'use client';

import { LockKeyhole } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import { captureDashboardEvent } from '@/lib/dashboard-api';

export function LoginForm({ initialError = '' }: { initialError?: string }) {
  const router = useRouter();
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/dashboard/session/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      const value = (await response.json().catch(() => ({}))) as { message?: unknown };
      if (!response.ok) {
        throw new Error(
          typeof value.message === 'string' ? value.message : 'Não foi possível entrar agora.',
        );
      }
      captureDashboardEvent('dashboard_login_succeeded');
      router.replace('/dashboard');
    } catch (caught) {
      captureDashboardEvent('dashboard_login_failed');
      setError(caught instanceof Error ? caught.message : 'Não foi possível entrar agora.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} aria-busy={pending} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-label font-semibold">
          E-mail corporativo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={255}
          autoFocus
          className="min-h-12 rounded-lg border border-input bg-background px-3 text-body focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-label font-semibold">
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={200}
          className="min-h-12 rounded-lg border border-input bg-background px-3 text-body focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          aria-describedby={error ? 'login-error' : undefined}
        />
      </div>

      <div id="login-status" aria-live="polite" aria-atomic="true">
        {error ? (
          <p
            id="login-error"
            role="alert"
            className="rounded-lg bg-destructive p-3 text-label text-destructive-foreground"
          >
            {error}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        <LockKeyhole aria-hidden="true" />
        {pending ? 'Verificando…' : 'Entrar com segurança'}
      </Button>
    </form>
  );
}
