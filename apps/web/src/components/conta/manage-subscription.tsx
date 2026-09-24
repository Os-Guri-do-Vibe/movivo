'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Pause, RotateCcw, X } from 'lucide-react';

import type { SubscriptionStatus } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { isAnalyticsEnabled } from '@/lib/env';
import { manageSubscription, type ManageAction } from '@/lib/subscription-api';

import styles from './manage-subscription.module.css';

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

const CAN_PAUSE: SubscriptionStatus[] = ['ACTIVE'];
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
    <div className={styles.actions}>
      {paused ? (
        <Button
          className={styles.primaryAction}
          onClick={() => void run('resume')}
          disabled={busy !== null}
        >
          <RotateCcw aria-hidden="true" />
          {busy === 'resume' ? 'Retomando…' : 'Retomar assinatura'}
        </Button>
      ) : CAN_PAUSE.includes(status) ? (
        <Button
          className={styles.secondaryAction}
          variant="outline"
          onClick={() => void run('pause')}
          disabled={busy !== null}
        >
          <Pause aria-hidden="true" />
          {busy === 'pause' ? 'Pausando…' : 'Pausar assinatura'}
        </Button>
      ) : null}

      {CAN_CANCEL.includes(status) ? (
        confirmCancel ? (
          <div className={styles.confirmBox} role="alertdialog" aria-labelledby="cancel-title">
            <span className={styles.alertIcon}>
              <AlertTriangle aria-hidden="true" />
            </span>
            <div>
              <h3 id="cancel-title">Confirmar cancelamento?</h3>
              <p>Interromperemos as próximas cobranças. Seu histórico continuará preservado.</p>
            </div>
            <div className={styles.confirmActions}>
              <Button
                className={styles.dangerAction}
                variant="destructive"
                onClick={() => void run('cancel')}
                disabled={busy !== null}
              >
                {busy === 'cancel' ? 'Cancelando…' : 'Sim, cancelar'}
              </Button>
              <Button
                className={styles.backAction}
                variant="ghost"
                onClick={() => setConfirmCancel(false)}
                disabled={busy !== null}
              >
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className={styles.cancelAction}
            variant="ghost"
            onClick={() => setConfirmCancel(true)}
          >
            <X aria-hidden="true" />
            Cancelar assinatura
          </Button>
        )
      ) : null}

      {error ? (
        <p role="alert" className={styles.error}>
          Não conseguimos concluir a ação agora. Tente novamente em instantes.
        </p>
      ) : null}
    </div>
  );
}
