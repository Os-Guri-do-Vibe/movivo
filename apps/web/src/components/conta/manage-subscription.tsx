'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, RotateCcw, Undo2, X } from 'lucide-react';

import type { PaymentMethodId, SubscriptionPlanId, SubscriptionStatus } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { isAnalyticsEnabled } from '@/lib/env';
import {
  getCheckoutLink,
  manageSubscription,
  requestRefund,
  type ManageAction,
} from '@/lib/subscription-api';

import styles from './manage-subscription.module.css';

/**
 * Ações self-service do portal (US-4.6/4.5): retomar, cancelar, pedir estorno por
 * arrependimento (7 dias) e assinar de novo.
 *
 * Cancelar é sempre visível e a um toque. Após a ação, revalida o estado do portal.
 */
function track(event: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsEnabled) return;
  void import('posthog-js').then(({ default: posthog }) => posthog.capture(event, props));
}

const CAN_CANCEL: SubscriptionStatus[] = [
  'ACTIVE',
  'TRIALING',
  'PENDING_PAYMENT',
  'PAST_DUE',
  'PAUSED',
];

export function ManageSubscription({
  token,
  status,
  plan,
  paymentMethod,
  refundEligibleUntil = null,
  canRepurchaseAt = null,
}: {
  token: string;
  status: SubscriptionStatus;
  plan: SubscriptionPlanId;
  paymentMethod: PaymentMethodId | null;
  /** Fim do prazo de arrependimento, enquanto o estorno ainda é possível. */
  refundEligibleUntil?: string | null;
  /** Cancelado com período pago em curso: a recompra só vale a partir desta data. */
  canRepurchaseAt?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<ManageAction | 'refund' | 'repurchase' | null>(null);
  const [error, setError] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [confirmRefund, setConfirmRefund] = React.useState(false);
  const [refundOutcome, setRefundOutcome] = React.useState<'REFUNDED' | 'PENDING_MANUAL' | null>(
    null,
  );

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

  async function refund() {
    setBusy('refund');
    setError(false);
    track('subscription_refund_requested');
    try {
      const result = await requestRefund(token);
      setRefundOutcome(result.status);
      setConfirmRefund(false);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  async function repurchase() {
    setBusy('repurchase');
    setError(false);
    track('subscription_repurchase_started');
    try {
      const { url } = await getCheckoutLink(token);
      window.location.assign(url);
    } catch {
      setError(true);
      setBusy(null);
    }
  }

  const paused = status === 'PAUSED';
  const canBuyAgain = status === 'EXPIRED' || (status === 'CANCELED' && !canRepurchaseAt);
  const refundDeadline = refundEligibleUntil
    ? new Date(refundEligibleUntil).toLocaleDateString('pt-BR')
    : null;

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
      ) : null}

      {canBuyAgain ? (
        <Button
          className={styles.primaryAction}
          onClick={() => void repurchase()}
          disabled={busy !== null}
        >
          {busy === 'repurchase' ? 'Abrindo…' : 'Assinar novamente'}
        </Button>
      ) : null}

      {status === 'CANCELED' && canRepurchaseAt ? (
        <p className={styles.note} role="status">
          Seu acesso segue até {new Date(canRepurchaseAt).toLocaleDateString('pt-BR')}. Você poderá
          assinar de novo a partir dessa data.
        </p>
      ) : null}

      {refundOutcome ? (
        <p className={styles.note} role="status">
          {refundOutcome === 'REFUNDED'
            ? 'Estorno solicitado. O valor volta pelo mesmo meio de pagamento; no cartão, pode levar até 10 dias úteis para aparecer na fatura.'
            : 'Recebemos o seu pedido de estorno e vamos concluí-lo manualmente. Você receberá a confirmação por aqui.'}
        </p>
      ) : null}

      {CAN_CANCEL.includes(status) ? (
        confirmCancel ? (
          <div className={styles.confirmBox} role="alertdialog" aria-labelledby="cancel-title">
            <span className={styles.alertIcon}>
              <AlertTriangle aria-hidden="true" />
            </span>
            <div>
              <h3 id="cancel-title">Confirmar cancelamento?</h3>
              <p>
                {status === 'PENDING_PAYMENT'
                  ? 'O pagamento pendente será cancelado e nenhuma cobrança será concluída.'
                  : paymentMethod === 'CARD' && plan === 'MONTHLY'
                    ? 'Não haverá novas mensalidades. Seu acesso segue até o fim do período pago.'
                    : paymentMethod === 'CARD'
                      ? 'Não haverá renovação automática. As parcelas da compra atual continuam devidas.'
                      : 'Não haverá renovação automática. Seu acesso segue até o fim do período pago.'}
              </p>
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

      {refundDeadline && !refundOutcome ? (
        confirmRefund ? (
          <div className={styles.confirmBox} role="alertdialog" aria-labelledby="refund-title">
            <span className={styles.alertIcon}>
              <AlertTriangle aria-hidden="true" />
            </span>
            <div>
              <h3 id="refund-title">Pedir o estorno?</h3>
              <p>
                Devolvemos o valor pago e interrompemos novas cobranças. Seu acesso é encerrado
                agora.
              </p>
            </div>
            <div className={styles.confirmActions}>
              <Button
                className={styles.dangerAction}
                variant="destructive"
                onClick={() => void refund()}
                disabled={busy !== null}
              >
                {busy === 'refund' ? 'Solicitando…' : 'Sim, pedir estorno'}
              </Button>
              <Button
                className={styles.backAction}
                variant="ghost"
                onClick={() => setConfirmRefund(false)}
                disabled={busy !== null}
              >
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.refundBox}>
            <p>
              Arrependimento: você pode pedir o estorno integral até{' '}
              <strong>{refundDeadline}</strong>.
            </p>
            <Button
              className={styles.secondaryAction}
              variant="outline"
              onClick={() => setConfirmRefund(true)}
              disabled={busy !== null}
            >
              <Undo2 aria-hidden="true" />
              Pedir estorno
            </Button>
          </div>
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
