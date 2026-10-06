'use client';

import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { captureDashboardEvent } from '@/lib/dashboard-api';

const INPUT_CLASS =
  'min-h-12 rounded-lg border border-input bg-background px-3 text-body focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

type Phase =
  | { kind: 'credentials' }
  | { kind: 'verify'; challengeToken: string }
  | { kind: 'setup'; challengeToken: string }
  | { kind: 'recovery-codes'; codes: string[] };

interface SetupView {
  secret: string;
  account: string;
  qrDataUrl: string;
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const value = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, value };
}

function messageOf(value: Record<string, unknown>, fallback: string): string {
  return typeof value.message === 'string' ? value.message : fallback;
}

/** Chave base32 em grupos de 4, como o app autenticador mostra — mais fácil de digitar. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function LoginForm({ initialError = '' }: { initialError?: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'credentials' });
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  function backToCredentials(message = '') {
    setPhase({ kind: 'credentials' });
    setError(message);
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const { response, value } = await postJson('/api/dashboard/session/login', {
        email: form.get('email'),
        password: form.get('password'),
      });
      if (!response.ok) throw new Error(messageOf(value, 'Não foi possível entrar agora.'));
      const mfa = value.mfa as { step?: string; challengeToken?: string } | undefined;
      if (mfa?.challengeToken && (mfa.step === 'verify' || mfa.step === 'setup')) {
        // Senha certa, falta o 2º fator: ainda não há sessão.
        setPhase({ kind: mfa.step, challengeToken: mfa.challengeToken });
        return;
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

  async function submitCode(
    event: FormEvent<HTMLFormElement>,
    path: string,
    challengeToken: string,
  ) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const { response, value } = await postJson(path, {
        challengeToken,
        code: form.get('code'),
      });
      if (!response.ok) {
        // Desafio queimado/expirado (401 sem "código"): volta ao passo da senha.
        const message = messageOf(value, 'Código inválido ou expirado.');
        if (/desafio expirado/i.test(message)) return backToCredentials(message);
        throw new Error(message);
      }
      captureDashboardEvent('dashboard_login_succeeded');
      const codes = value.recoveryCodes;
      if (Array.isArray(codes) && codes.length > 0) {
        setPhase({ kind: 'recovery-codes', codes: codes.map(String) });
        return;
      }
      router.replace('/dashboard');
    } catch (caught) {
      captureDashboardEvent('dashboard_login_failed');
      setError(caught instanceof Error ? caught.message : 'Código inválido ou expirado.');
    } finally {
      setPending(false);
    }
  }

  const status = (
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
  );

  // Cada etapa tem `key` própria: sem ela o React reaproveita os <input> da etapa anterior (campos
  // não controlados) e a SENHA digitada reaparece, em texto puro, dentro do campo do código.
  if (phase.kind === 'verify') {
    return (
      <form
        key="mfa-verify"
        onSubmit={(event) =>
          submitCode(event, '/api/dashboard/session/mfa/verify', phase.challengeToken)
        }
        aria-busy={pending}
        className="flex flex-col gap-5"
      >
        <header className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-title font-semibold">
            <ShieldCheck aria-hidden="true" className="size-5" />
            Verificação em duas etapas
          </h2>
          <p className="text-label text-muted-foreground">
            Abra o app autenticador e digite o código de 6 dígitos da MOVIVO. Sem acesso ao app? Use
            um código de recuperação (XXXXX-XXXXX).
          </p>
        </header>
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-label font-semibold">
            Código
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            required
            minLength={6}
            maxLength={14}
            autoFocus
            spellCheck={false}
            autoCapitalize="characters"
            className={`${INPUT_CLASS} font-mono tracking-widest`}
            aria-describedby={error ? 'login-error' : undefined}
          />
        </div>
        {status}
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          <ShieldCheck aria-hidden="true" />
          {pending ? 'Verificando…' : 'Verificar e entrar'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => backToCredentials()}>
          Voltar
        </Button>
      </form>
    );
  }

  if (phase.kind === 'setup') {
    return (
      <SetupStep
        key="mfa-setup"
        challengeToken={phase.challengeToken}
        pending={pending}
        error={error}
        status={status}
        onError={setError}
        onSubmit={(event) =>
          submitCode(event, '/api/dashboard/session/mfa/enable', phase.challengeToken)
        }
        onBack={backToCredentials}
      />
    );
  }

  if (phase.kind === 'recovery-codes') {
    return (
      <RecoveryCodes
        key="mfa-recovery"
        codes={phase.codes}
        onDone={() => router.replace('/dashboard')}
      />
    );
  }

  return (
    <form
      key="credentials"
      onSubmit={submitCredentials}
      aria-busy={pending}
      className="flex flex-col gap-5"
    >
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
          className={INPUT_CLASS}
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
          className={INPUT_CLASS}
          aria-describedby={error ? 'login-error' : undefined}
        />
      </div>

      {status}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        <LockKeyhole aria-hidden="true" />
        {pending ? 'Verificando…' : 'Acessar'}
      </Button>
    </form>
  );
}

function SetupStep({
  challengeToken,
  pending,
  error,
  status,
  onError,
  onSubmit,
  onBack,
}: {
  challengeToken: string;
  pending: boolean;
  error: string;
  status: React.ReactNode;
  onError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: (message?: string) => void;
}) {
  const [setup, setSetup] = useState<SetupView | null>(null);
  const requested = useRef(false);

  useEffect(() => {
    // O efeito pode rodar duas vezes em dev (StrictMode): a rota é idempotente por desafio,
    // mas evitamos a segunda ida de qualquer jeito.
    if (requested.current) return;
    requested.current = true;
    void (async () => {
      try {
        const { response, value } = await postJson('/api/dashboard/session/mfa/setup', {
          challengeToken,
        });
        if (!response.ok) {
          onBack(messageOf(value, 'Desafio expirado. Entre novamente com e-mail e senha.'));
          return;
        }
        setSetup(value as unknown as SetupView);
      } catch {
        onError('Não foi possível iniciar a configuração agora. Tente de novo.');
      }
    })();
  }, [challengeToken, onBack, onError]);

  return (
    <form onSubmit={onSubmit} aria-busy={pending || !setup} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-title font-semibold">
          <KeyRound aria-hidden="true" className="size-5" />
          Ative a verificação em duas etapas
        </h2>
        <p className="text-label text-muted-foreground">
          Esta conta acessa dados de saúde dos alunos, então a MOVIVO exige um segundo fator.
          Escaneie o QR com o Google Authenticator, Microsoft Authenticator, 1Password ou similar e
          digite o código que o app mostrar.
        </p>
      </header>

      {setup ? (
        <div className="flex flex-col items-center gap-3">
          {/* data URL gerada no servidor do BFF; `next/image` não otimiza data URL. */}
          <Image
            src={setup.qrDataUrl}
            alt={`QR Code para cadastrar a conta ${setup.account} no app autenticador`}
            width={224}
            height={224}
            unoptimized
            className="rounded-lg border border-border bg-white"
          />
          <p className="text-label text-muted-foreground">Ou digite esta chave no app:</p>
          <code
            className="select-all rounded-md bg-muted px-3 py-2 text-center font-mono text-label tracking-wider"
            aria-label="Chave de configuração"
          >
            {groupSecret(setup.secret)}
          </code>
        </div>
      ) : (
        <p role="status" className="text-label text-muted-foreground">
          Preparando a configuração…
        </p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="code" className="text-label font-semibold">
          Código de 6 dígitos
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          minLength={6}
          maxLength={7}
          pattern="[0-9 ]*"
          disabled={!setup}
          spellCheck={false}
          className={`${INPUT_CLASS} font-mono tracking-widest`}
          aria-describedby={error ? 'login-error' : undefined}
        />
      </div>
      {status}
      <Button type="submit" size="lg" disabled={pending || !setup} className="w-full">
        <ShieldCheck aria-hidden="true" />
        {pending ? 'Ativando…' : 'Ativar e entrar'}
      </Button>
      <Button type="button" variant="ghost" onClick={() => onBack()}>
        Voltar
      </Button>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby="recovery-title">
      <header className="flex flex-col gap-1">
        <h2 id="recovery-title" className="flex items-center gap-2 text-title font-semibold">
          <ShieldCheck aria-hidden="true" className="size-5" />
          Guarde seus códigos de recuperação
        </h2>
        <p className="text-label text-muted-foreground">
          Se você perder o celular, cada código abaixo entra uma única vez no lugar do código do
          app. <strong>Eles não serão mostrados de novo.</strong> Guarde num gerenciador de senhas.
        </p>
      </header>
      <ul
        className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-label"
        aria-label="Códigos de recuperação"
      >
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" onClick={copy}>
        {copied ? 'Copiados' : 'Copiar códigos'}
      </Button>
      <label className="flex items-start gap-2 text-label">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="mt-1 size-4"
        />
        Guardei os códigos em um lugar seguro.
      </label>
      <Button type="button" size="lg" disabled={!saved} onClick={onDone} className="w-full">
        Continuar para o painel
      </Button>
    </section>
  );
}
