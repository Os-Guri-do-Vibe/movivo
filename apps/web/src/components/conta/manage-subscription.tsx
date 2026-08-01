'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import type { SubscriptionStatus } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { isAnalyticsEnabled } from '@/lib/env';
import { manageSubscription, type ManageAction } from '@/lib/subscription-api';

/**
 * Ações self-service do portal (US-4.6/4.5): pausar / retomar / cancelar.
 *
 * UX Peak-End (sem dark pattern): pausar é oferecido antes de cancelar, mas cancelar é
 * sempre visível e a um toque — nunca escondido. Após a ação, revalida o estado do portal.
 */
function track(event: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsEnabled) return;
  void import('posthog-js').then(({ default: posthog }) => posthog.capture(event, props));
}

const CAN_PAUSE: SubscriptionStatus[] = ['ACTIVE', 'TRIALING', 'PAST_DUE'];
const CAN_CANCEL: SubscriptionStatus[] = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED'];

export function ManageSubscription({
  token,
  status,
}: {
  token: string;
  status: SubscriptionStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<ManageAction | null>(null);
  const [error, setError] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  React.useEffect(() => {
    track('subscription_manage_viewed', { status });
  }, [status]);

  async function run(action: ManageAction) {
    setBusy(action);
    setError(false);
    track('subscription_managed', { action });
    try {
      await manageSubscription(token, action);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  const paused = status === 'PAUSED';

  return (
    <div className="flex flex-col gap-3">
      {paused ? (
        <Button onClick={() => void run('resume')} disabled={busy !== null}>
          {busy === 'resume' ? 'Retomando…' : 'Retomar assinatura'}
        </Button>
      ) : CAN_PAUSE.includes(status) ? (
        <Button variant="outline" onClick={() => void run('pause')} disabled={busy !== null}>
          {busy === 'pause' ? 'Pausando…' : 'Pausar assinatura'}
        </Button>
      ) : null}

      {CAN_CANCEL.includes(status) ? (
        confirmCancel ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
            <p className="text-body">
              Tem certeza que quer cancelar? Você pode pausar em vez disso.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="destructive"
                onClick={() => void run('cancel')}
                disabled={busy !== null}
              >
                {busy === 'cancel' ? 'Cancelando…' : 'Sim, cancelar'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirmCancel(false)}
                disabled={busy !== null}
              >
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
            Cancelar assinatura
          </Button>
        )
      ) : null}

      {error ? (
        <p role="alert" className="text-label text-destructive">
          Não conseguimos concluir a ação agora. Tente novamente em instantes.
        </p>
      ) : null}
    </div>
  );
}
