import type { Metadata } from 'next';
import { Check, ShieldCheck } from 'lucide-react';

import {
  SUBSCRIPTION_PLANS,
  subscriptionViewSchema,
  type SubscriptionStatus,
  type SubscriptionView,
} from '@movivo/shared';

import { SubscriptionFrame } from '@/components/assinatura/subscription-frame';
import { ManageSubscription } from '@/components/conta/manage-subscription';
import { publicEnv } from '@/lib/env';
import { CONTACT_URL } from '@/lib/landing/site';
import { formatBRL } from '@/lib/subscription-api';

import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Sua assinatura · MOVIVO',
  description: 'Consulte e gerencie sua assinatura MOVIVO.',
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIALING: 'Período de teste',
  PENDING_PAYMENT: 'Aguardando pagamento',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Pagamento pendente',
  PAUSED: 'Pausada',
  CANCELED: 'Cancelada',
  EXPIRED: 'Expirada',
};

const STATUS_TONE: Record<SubscriptionStatus, 'positive' | 'warning' | 'neutral' | 'danger'> = {
  TRIALING: 'positive',
  PENDING_PAYMENT: 'warning',
  ACTIVE: 'positive',
  PAST_DUE: 'warning',
  PAUSED: 'neutral',
  CANCELED: 'danger',
  EXPIRED: 'neutral',
};

async function fetchView(token: string): Promise<SubscriptionView | null> {
  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl}/subscription/${token}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const parsed = subscriptionViewSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

export default async function ContaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await fetchView(token);

  if (!view) {
    return (
      <SubscriptionFrame
        secureLabel="Área da assinatura"
        footerLead="Gestão protegida da sua assinatura MOVIVO."
      >
        <section className={styles.emptyCard} aria-labelledby="empty-title">
          <ShieldCheck aria-hidden="true" />
          <p>Conta indisponível</p>
          <h1 id="empty-title">Não encontramos esta assinatura</h1>
          <span>
            O link pode estar incorreto. Abra o link mais recente enviado no seu WhatsApp.
          </span>
          {CONTACT_URL ? <a href={CONTACT_URL}>Falar com o suporte</a> : null}
        </section>
      </SubscriptionFrame>
    );
  }

  const plan = SUBSCRIPTION_PLANS.find((candidate) => candidate.id === view.plan);
  const inactive = view.status === 'CANCELED' || view.status === 'EXPIRED';

  return (
    <SubscriptionFrame
      secureLabel="Área da assinatura"
      footerLead="Gestão da assinatura sincronizada com o provedor de pagamento."
    >
      <div className={styles.accountGrid}>
        <section className={styles.summary} aria-labelledby="account-title">
          <p className={styles.eyebrow}>Sua assinatura MOVIVO</p>
          <h1 id="account-title">Você está no controle.</h1>
          <p className={styles.subtitle}>
            Consulte seu plano e gerencie sua continuidade com clareza e sem burocracia.
          </p>

          <div className={styles.planCard}>
            <div className={styles.planHeading}>
              <div>
                <span>Plano {plan?.label ?? view.plan}</span>
                <strong>{plan ? formatBRL(plan.monthlyCents) : 'MOVIVO'}</strong>
                <small>{plan ? 'por mês equivalente' : 'plano individualizado'}</small>
              </div>
              {plan ? (
                <span className={styles.period}>
                  {plan.months} {plan.months === 1 ? 'mês' : 'meses'}
                </span>
              ) : null}
            </div>
            <dl className={styles.planFacts}>
              <div>
                <dt>Total do contrato</dt>
                <dd>{plan ? formatBRL(plan.priceCents) : 'Consulte o suporte'}</dd>
              </div>
              <div>
                <dt>Situação atual</dt>
                <dd>{STATUS_LABEL[view.status]}</dd>
              </div>
              {view.currentPeriodEnd ? (
                <div>
                  <dt>{view.status === 'CANCELED' ? 'Acesso até' : 'Próxima cobrança'}</dt>
                  <dd>
                    <time dateTime={view.currentPeriodEnd}>
                      {new Date(view.currentPeriodEnd).toLocaleDateString('pt-BR')}
                    </time>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <ul className={styles.benefits} aria-label="Compromissos da MOVIVO">
            <li>
              <Check aria-hidden="true" /> Cancelamento sem burocracia
            </li>
            <li>
              <Check aria-hidden="true" /> Histórico financeiro preservado
            </li>
            <li>
              <Check aria-hidden="true" /> Supervisão de profissional CREF
            </li>
          </ul>
        </section>

        <section className={styles.manageCard} aria-labelledby="manage-title">
          <div className={styles.cardHeader}>
            <span className={styles.shield}>
              <ShieldCheck aria-hidden="true" />
            </span>
            <div>
              <h2 id="manage-title">Gerenciar assinatura</h2>
              <p>Suas escolhas são aplicadas de forma segura.</p>
            </div>
            <span className={`${styles.status} ${styles[STATUS_TONE[view.status]]}`}>
              {STATUS_LABEL[view.status]}
            </span>
          </div>

          <div className={styles.explanation}>
            <h3>{inactive ? 'Sua assinatura não está ativa' : 'Como deseja continuar?'}</h3>
            <p>
              {inactive
                ? 'Quando quiser voltar, fale com nosso suporte para receber um novo link seguro de checkout.'
                : 'Você pode gerenciar sua assinatura sem perder o histórico dos seus treinos.'}
            </p>
          </div>

          {inactive ? (
            CONTACT_URL ? (
              <a className={styles.supportButton} href={CONTACT_URL}>
                Falar com o suporte
              </a>
            ) : null
          ) : (
            <ManageSubscription token={token} status={view.status} />
          )}

          <div className={styles.providerNote}>
            <ShieldCheck aria-hidden="true" />
            <p>
              Cancelamentos de contratos externos são enviados ao provedor antes da atualização do
              estado na MOVIVO. Valores já liquidados exigem análise de reembolso.
            </p>
          </div>
        </section>
      </div>
    </SubscriptionFrame>
  );
}
