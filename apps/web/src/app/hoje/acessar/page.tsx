'use client';

/**
 * Landing do link mágico do treino do dia. Mesma casca de `/anamnese` (achado
 * 2026-09-04, a pedido do fundador): faixa `bg-petroleo` de ponta a ponta com a logo
 * centralizada, página clara (`onboarding-light`) por baixo — nunca mais um cartão
 * flutuando sobre fundo escuro. Tokens semânticos (`bg-primary`, `text-foreground`,
 * `border-destructive`...) em vez de `var(--...)` cru, para ficar igual ao resto do
 * fluxo de onboarding, não uma variação à parte.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AccessScreen } from '@/components/training/access-screen';

export default function TrainingAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  // Registro tardio: o link abre o diário no dia do treino (`#token=...&date=AAAA-MM-DD`).
  const [date, setDate] = useState('');
  // Destino depois do acesso (só páginas do aluno; nunca um endereço vindo do link).
  const [next, setNext] = useState('/hoje');
  const [firstName, setFirstName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendNotice, setResendNotice] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const value = hash.get('token') ?? '';
    const requestedDate = hash.get('date') ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) setDate(requestedDate);
    const requestedNext = hash.get('next') ?? '';
    if (['/hoje', '/alimentacao', '/evolucao', '/check-in', '/reavaliacao'].includes(requestedNext))
      setNext(requestedNext);
    // React executa Effects duas vezes no Strict Mode de desenvolvimento. Depois da
    // primeira passagem o fragmento já foi removido; não podemos apagar o token em memória.
    if (value) {
      setToken(value);
      // So le o nome pra saudacao - nunca consome o token nem bloqueia o fluxo se falhar.
      fetch(`/api/training/access/peek?token=${encodeURIComponent(value)}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((data: { firstName?: string | null }) => setFirstName(data.firstName ?? ''))
        .catch(() => {});
    }
    history.replaceState(null, '', '/hoje/acessar');
  }, []);

  /** Sessão de 30 dias já trocada neste MESMO navegador (ver `exchangeMagicToken`/`COOKIE`
   *  em `_lib/bff.ts`) — se existir, o check-in do dia segue mesmo sem gastar o link. */
  async function hasActiveSession(): Promise<boolean> {
    const existing = await fetch('/api/training/day', { cache: 'no-store' });
    return existing.ok;
  }

  const workoutPath = date ? `${next}?date=${date}` : next;

  async function openWorkout() {
    if (!token) {
      if (await hasActiveSession()) return router.replace(workoutPath);
      setError('Link incompleto. Abra novamente a mensagem recebida no WhatsApp.');
      return;
    }
    setBusy(true);
    setError('');
    const response = await fetch('/api/training/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (response.ok) {
      router.replace(workoutPath);
      return;
    }
    /**
     * Achado 2026-09-10 (pedido do fundador): o token do link só pode ser trocado UMA
     * vez. Se o aluno já abriu este MESMO link antes (mesmo sem querer) e fechou tudo,
     * reabri-lo de novo cai aqui direto — mas o navegador dele já pode ter a sessão de
     * 30 dias daquela primeira troca. Antes de bloquear o check-in do dia com "link já
     * usado", confere se já existe sessão válida; só mostra erro se não existir.
     */
    if (await hasActiveSession()) return router.replace(workoutPath);
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    setError(body?.message ?? 'Não foi possível abrir este link.');
    setBusy(false);
  }

  /** Link já gasto (ex.: aberto em guia anônima): o novo vai só para o WhatsApp do titular. */
  async function resendLink() {
    setResending(true);
    setResendNotice('');
    try {
      const response = await fetch('/api/training/access/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await response.json().catch(() => null)) as { status?: string } | null;
      setResendNotice(
        response.ok && data?.status === 'SENT'
          ? 'Enviamos um novo link para o seu WhatsApp. Abra no navegador de sempre, fora da guia anônima.'
          : response.ok
            ? 'Você já pediu um novo link há pouco. Confira o seu WhatsApp.'
            : 'Não foi possível enviar um novo link agora. Tente de novo em instantes.',
      );
    } catch {
      setResendNotice('Não foi possível enviar um novo link agora. Tente de novo em instantes.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AccessScreen firstName={firstName} busy={busy} error={error} onOpen={openWorkout}>
      {error && token ? (
        <div className="mt-4 flex flex-col items-center gap-3">
          <p className="text-label text-muted-foreground">
            Se você abriu o link em uma guia anônima, ele pode ter sido usado lá. Peça um novo link
            e abra em uma guia normal.
          </p>
          <button
            type="button"
            onClick={resendLink}
            disabled={resending}
            className="h-11 rounded-xl border border-primary px-5 text-label font-semibold text-primary disabled:opacity-60"
          >
            {resending ? 'Enviando...' : 'Receber novo link no WhatsApp'}
          </button>
          {resendNotice ? (
            <p role="status" className="text-label text-petroleo">
              {resendNotice}
            </p>
          ) : null}
        </div>
      ) : null}
    </AccessScreen>
  );
}
