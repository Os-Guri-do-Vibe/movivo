'use client';

import * as React from 'react';
import { Check, Copy, CreditCard, LockKeyhole, QrCode, RefreshCw } from 'lucide-react';
import Image from 'next/image';

import {
  SUBSCRIPTION_PLANS,
  type CheckoutPaymentResult,
  type CheckoutPayer,
  type CheckoutSummary,
  type CreateCheckoutBody,
  type PaymentMethodId,
  type SubscriptionPlanId,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { LEGAL_LINKS } from '@/lib/landing/site';
import { formatBRL, getCheckoutSummary, startCheckoutPayment } from '@/lib/subscription-api';

import styles from './plan-selector.module.css';

/** Selo do checkout: a assinatura de marca da MOVIVO, definida pelos fundadores. */
const SEAL = 'Treinos feitos para você. Tecnologia que potencializa. Ciência que orienta.';

const METHODS: {
  id: PaymentMethodId;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  { id: 'CARD', label: 'Cartão', description: 'Crédito, no ambiente do Asaas', icon: CreditCard },
  { id: 'PIX', label: 'Pix à vista', description: 'QR Code na própria página', icon: QrCode },
];

/** FORM → (Pix) PENDING | (cartão) REDIRECTING → volta do Asaas em CONFIRMING → SUCCESS. */
type CheckoutState =
  'FORM' | 'SUBMITTING' | 'PENDING' | 'REDIRECTING' | 'CONFIRMING' | 'SUCCESS' | 'ERROR';

/** Quanto tempo a tela espera o webhook antes de avisar que a confirmação pode demorar. */
const CONFIRMING_SLOW_MS = 90_000;

const onlyDigits = (value: string, limit?: number) => value.replace(/\D/g, '').slice(0, limit);

function maskCpf(value: string): string {
  return onlyDigits(value, 11)
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

function maskPhone(value: string): string {
  const digits = onlyDigits(value, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const local = digits.slice(2);
  return `(${digits.slice(0, 2)}) ${local.length <= 5 ? local : `${local.slice(0, 5)}-${local.slice(5)}`}`;
}

function maskPostalCode(value: string): string {
  const digits = onlyDigits(value, 8);
  return digits.length <= 5 ? digits : `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Lê e remove `?retorno=` (volta do Checkout do Asaas) sem recarregar a página. */
function consumeReturnParam(): 'sucesso' | 'cancelado' | 'expirado' | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get('retorno');
  if (!value) return null;
  url.searchParams.delete('retorno');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return value === 'sucesso' || value === 'cancelado' || value === 'expirado' ? value : null;
}

export function PlanSelector({ token }: { token: string }) {
  const [server, setServer] = React.useState<CheckoutSummary>();
  // Plano escolhido na tela: nasce no plano persistido (o da landing) e o aluno pode trocá-lo.
  const [selectedPlan, setSelectedPlan] = React.useState<SubscriptionPlanId>();
  const [method, setMethod] = React.useState<PaymentMethodId>('CARD');
  const [state, setState] = React.useState<CheckoutState>('FORM');
  const [result, setResult] = React.useState<CheckoutPaymentResult>();
  const [lastBody, setLastBody] = React.useState<CreateCheckoutBody>();
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState<number>();
  const [slowConfirmation, setSlowConfirmation] = React.useState(false);
  // O próximo envio de cartão abre uma sessão nova (a anterior expirou ou foi abandonada).
  const [regenerateCard, setRegenerateCard] = React.useState(false);
  const redirecting = React.useRef(false);
  const paymentRef = React.useRef<HTMLElement>(null);

  const loadSummary = React.useCallback(
    async (initial = false) => {
      const current = await getCheckoutSummary(token);
      setServer(current);
      setSelectedPlan((chosen) => chosen ?? current.plan);
      setMethod((chosen) =>
        current.methods.includes(chosen) ? chosen : (current.methods[0] ?? chosen),
      );
      if (current.status === 'ACTIVE') {
        setState('SUCCESS');
      } else if (initial) {
        const back = consumeReturnParam();
        if (back === 'sucesso') {
          setState('CONFIRMING');
        } else if (back === 'expirado') {
          setRegenerateCard(true);
          setNotice('O tempo do pagamento seguro acabou. Gere um novo link para continuar.');
        } else if (current.status === 'PENDING_PAYMENT' && current.checkoutUrl) {
          setResult({ status: 'PENDING', method: 'CARD', checkoutUrl: current.checkoutUrl });
          setState('PENDING');
          if (back === 'cancelado') {
            setNotice('Você saiu do pagamento seguro. Quando quiser, continue de onde parou.');
          }
        }
      }
      return current;
    },
    [token],
  );

  const summary = React.useMemo(
    () => (server ? summaryFor(server, selectedPlan ?? server.plan) : undefined),
    [server, selectedPlan],
  );
  // Sem os links dos documentos legais não há o que aceitar: o checkout não abre.
  const checkoutOpen = Boolean(LEGAL_LINKS.terms && LEGAL_LINKS.privacy);

  React.useEffect(() => {
    loadSummary(true).catch(() => {
      setError('Este link é inválido ou expirou. Solicite um novo link pelo WhatsApp.');
      setState('ERROR');
    });
  }, [loadSummary]);

  // Pix pendente ou volta do Asaas: pergunta ao servidor até o webhook confirmar o pagamento.
  React.useEffect(() => {
    if (state !== 'PENDING' && state !== 'CONFIRMING') return;
    const timer = window.setInterval(() => void loadSummary().catch(() => undefined), 3_000);
    return () => window.clearInterval(timer);
  }, [loadSummary, state]);

  // No celular o pagamento fica abaixo do plano: ao gerar o Pix (ou voltar do Asaas), leva o aluno até ele.
  React.useEffect(() => {
    if (state === 'FORM' || state === 'SUBMITTING' || state === 'ERROR') return;
    paymentRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [state]);

  React.useEffect(() => {
    if (state !== 'CONFIRMING') return;
    setSlowConfirmation(false);
    const timer = window.setTimeout(() => setSlowConfirmation(true), CONFIRMING_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  React.useEffect(() => {
    const expiration = result?.qrCode?.expirationDate;
    if (!expiration) return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiration).getTime() - Date.now()) / 1_000),
      );
      setSecondsLeft(remaining);
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [result?.qrCode?.expirationDate]);

  function backToForm() {
    setResult(undefined);
    setNotice('');
    setError('');
    setState('FORM');
  }

  async function submit(event: React.FormEvent<HTMLFormElement>, regenerate = false) {
    event.preventDefault();
    if (!summary) return;
    if (!checkoutOpen) {
      setError('A contratação paga está indisponível no momento.');
      return;
    }
    setState('SUBMITTING');
    setError('');
    setNotice('');
    const data = new FormData(event.currentTarget);
    const payer: CheckoutPayer = {
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      cpfCnpj: onlyDigits(String(data.get('cpfCnpj') ?? ''), 11),
      postalCode: onlyDigits(String(data.get('postalCode') ?? ''), 8),
      addressNumber: String(data.get('addressNumber') ?? ''),
      addressComplement: String(data.get('addressComplement') ?? '') || undefined,
      phone: onlyDigits(String(data.get('phone') ?? ''), 11),
    };
    try {
      // O cartão nunca é digitado aqui: só o Asaas o recebe, na página dele.
      const body: CreateCheckoutBody =
        method === 'CARD'
          ? {
              method,
              payer,
              installments: summary.maxInstallments,
              acceptTerms: true,
              plan: summary.plan,
              ...(regenerateCard ? { regenerate: true } : {}),
            }
          : { method: 'PIX', payer, acceptTerms: true, regenerate, plan: summary.plan };
      setLastBody(body);
      const next = await startCheckoutPayment(token, body);
      setResult(next);
      setRegenerateCard(false);
      if (next.checkoutUrl) {
        openHostedCheckout(next.checkoutUrl);
        return;
      }
      setState(next.status === 'REFUSED' || next.status === 'EXPIRED' ? 'ERROR' : 'PENDING');
      if (next.status === 'REFUSED') setError('O pagamento não foi aprovado. Revise os dados.');
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.endsWith('_409')
          ? 'Já existe uma tentativa em processamento. Aguarde alguns segundos.'
          : cause instanceof Error && cause.message.endsWith('_400')
            ? 'Revise os dados informados e tente novamente.'
            : 'Não foi possível iniciar o pagamento. Tente novamente em instantes.',
      );
      setState('ERROR');
    }
  }

  /** Leva o aluno ao Checkout hospedado do Asaas, na mesma aba (melhor no navegador do WhatsApp). */
  function openHostedCheckout(url: string) {
    setState('REDIRECTING');
    if (redirecting.current) return;
    redirecting.current = true;
    window.location.assign(url);
  }

  async function copyPix() {
    if (!result?.qrCode?.payload) return;
    await navigator.clipboard.writeText(result.qrCode.payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  async function regeneratePix() {
    if (!lastBody || lastBody.method === 'CARD') return;
    setState('SUBMITTING');
    setError('');
    try {
      const next = await startCheckoutPayment(token, { ...lastBody, regenerate: true });
      setResult(next);
      setState('PENDING');
    } catch {
      setError('Não foi possível gerar um novo QR Code. Tente novamente em instantes.');
      setState('ERROR');
    }
  }

  if (!summary && state !== 'ERROR') {
    return (
      <div className={styles.loading} role="status">
        Preparando seu checkout seguro…
      </div>
    );
  }

  if (!summary) {
    return (
      <div className={styles.fatal} role="alert">
        {error}
      </div>
    );
  }

  const expired = secondsLeft === 0;
  const waitingForAsaas = state === 'REDIRECTING' || state === 'CONFIRMING';
  const repurchaseAt = server?.repurchaseAt ? new Date(server.repurchaseAt) : null;

  return (
    <form className={styles.checkoutGrid} onSubmit={submit} noValidate={false}>
      <section className={styles.planColumn} aria-labelledby="checkout-title">
        <p className={styles.eyebrow}>Seu plano MOVIVO</p>
        <h1 id="checkout-title">Seu próximo passo começa aqui.</h1>
        <p className={styles.seal}>{SEAL}</p>

        <fieldset
          className={styles.planPicker}
          disabled={state === 'SUBMITTING' || waitingForAsaas}
        >
          <legend>Escolha seu plano</legend>
          {SUBSCRIPTION_PLANS.map((option) => (
            <label
              key={option.id}
              className={styles.planOption}
              data-selected={summary.plan === option.id}
            >
              <input
                type="radio"
                name="plan"
                value={option.id}
                checked={summary.plan === option.id}
                onChange={() => {
                  setSelectedPlan(option.id);
                  setError('');
                  // Trocou de plano com um pagamento aberto: o valor mudou, então volta ao formulário.
                  if (state === 'ERROR' || state === 'PENDING') backToForm();
                }}
              />
              <span className={styles.planOptionText}>
                <strong>{option.label}</strong>
                {option.discountPercent > 0 ? <small>{option.discountPercent}% OFF</small> : null}
              </span>
              <span className={styles.planOptionPrice}>
                <strong>{formatBRL(option.monthlyCents)}</strong>/mês
              </span>
            </label>
          ))}
        </fieldset>

        <div className={styles.planCard}>
          <div className={styles.planHeading}>
            <div>
              <span>Plano {summary.label}</span>
              <strong>{formatBRL(summary.monthlyCents)}</strong>
              <small>por mês equivalente</small>
            </div>
            <span className={styles.period}>
              {summary.months} {summary.months === 1 ? 'mês' : 'meses'}
            </span>
          </div>
          <dl className={styles.planFacts}>
            <div>
              <dt>Compromisso</dt>
              <dd>
                {summary.months} {summary.months === 1 ? 'mês' : 'meses'}
              </dd>
            </div>
            <div>
              <dt>Total do contrato</dt>
              <dd>{formatBRL(summary.totalCents)}</dd>
            </div>
            <div>
              <dt>Pagamento</dt>
              <dd>{paymentExplanation(method, summary)}</dd>
            </div>
            <div>
              <dt>Renovação</dt>
              <dd>{renewalExplanation(method, summary)}</dd>
            </div>
          </dl>
        </div>

        <ul className={styles.benefits} aria-label="Benefícios incluídos">
          <li>
            <Check aria-hidden="true" /> Protocolo individualizado
          </li>
          <li>
            <Check aria-hidden="true" /> Acompanhamento pelo WhatsApp
          </li>
          <li>
            <Check aria-hidden="true" /> Cancele quando quiser, sem burocracia
          </li>
        </ul>
      </section>

      <section ref={paymentRef} className={styles.paymentCard} aria-labelledby="payment-title">
        {state === 'SUCCESS' ? (
          <Success />
        ) : waitingForAsaas ? (
          <Waiting
            confirming={state === 'CONFIRMING'}
            slow={slowConfirmation}
            checkoutUrl={result?.checkoutUrl}
          />
        ) : result?.checkoutUrl && state === 'PENDING' ? (
          <div className={styles.methodNotice} role="status">
            <h2 id="payment-title">Finalize o pagamento</h2>
            {notice ? <p>{notice}</p> : null}
            <p>
              O pagamento com cartão está em andamento no ambiente seguro do Asaas. Seu acesso é
              liberado assim que ele for confirmado.
            </p>
            <Button asChild size="lg" className={styles.submit}>
              <a href={result.checkoutUrl} rel="noopener noreferrer">
                Continuar para o pagamento seguro
              </a>
            </Button>
            <div className={styles.secondaryActions}>
              <button
                type="button"
                onClick={() => {
                  setRegenerateCard(true);
                  backToForm();
                }}
              >
                Gerar novo link de pagamento
              </button>
              <button type="button" onClick={backToForm}>
                Escolher outra forma de pagamento
              </button>
            </div>
          </div>
        ) : result?.qrCode && state === 'PENDING' ? (
          <PixPending
            result={result}
            secondsLeft={secondsLeft}
            copied={copied}
            onCopy={copyPix}
            onRegenerate={expired ? () => void regeneratePix() : undefined}
            onChangeMethod={backToForm}
          />
        ) : repurchaseAt ? (
          <div className={styles.methodNotice} role="status">
            <h2 id="payment-title">Sua assinatura foi cancelada</h2>
            <p>
              Seu acesso segue até {repurchaseAt.toLocaleDateString('pt-BR')}. Você poderá assinar
              novamente a partir dessa data.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.secureTitle}>
              <div>
                <span className={styles.lock}>
                  <LockKeyhole aria-hidden="true" />
                </span>
                <div>
                  <h2 id="payment-title">Pagamento seguro</h2>
                  <p>Processado pelo Asaas</p>
                </div>
              </div>
            </div>

            <fieldset className={styles.methods}>
              <legend>Forma de pagamento</legend>
              <div className={styles.methodGrid}>
                {METHODS.filter((candidate) => summary.methods.includes(candidate.id)).map(
                  (item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={method === item.id}
                        onClick={() => {
                          setMethod(item.id);
                          setState('FORM');
                          setError('');
                        }}
                      >
                        <Icon aria-hidden="true" />
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                      </button>
                    );
                  },
                )}
              </div>
            </fieldset>

            <div className={styles.fields}>
              <p className={styles.fieldsTitle}>Seus dados</p>
              <Field name="name" label="Nome completo" autoComplete="name" />
              <Field name="email" label="E-mail" type="email" autoComplete="email" />
              <div className={styles.twoColumns}>
                <Field
                  name="cpfCnpj"
                  label="CPF"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="000.000.000-00"
                  pattern="[0-9]{3}[.][0-9]{3}[.][0-9]{3}-[0-9]{2}"
                  minLength={14}
                  maxLength={14}
                  mask={maskCpf}
                />
                <Field
                  name="phone"
                  label="Celular"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(00) 90000-0000"
                  pattern="\([0-9]{2}\) 9[0-9]{4}-[0-9]{4}"
                  minLength={15}
                  maxLength={15}
                  mask={maskPhone}
                />
              </div>
              <div className={styles.addressRow}>
                <Field
                  name="postalCode"
                  label="CEP"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="00000-000"
                  pattern="[0-9]{5}-[0-9]{3}"
                  minLength={9}
                  maxLength={9}
                  mask={maskPostalCode}
                />
                <Field name="addressNumber" label="Número" autoComplete="address-line2" />
                <Field
                  name="addressComplement"
                  label="Complemento"
                  required={false}
                  autoComplete="address-line3"
                />
              </div>

              {method === 'CARD' ? (
                <div className={styles.methodNotice} key="hosted-card">
                  <strong>Cartão no ambiente seguro do Asaas</strong>
                  <p>
                    {summary.months === 1
                      ? 'Cobrança mensal recorrente no cartão, até você cancelar. '
                      : `Valor total de ${formatBRL(summary.totalCents)}, parcelável em até ${summary.maxInstallments}x. `}
                    Você digita os dados do cartão na página do Asaas, e a MOVIVO nunca os vê.
                  </p>
                </div>
              ) : (
                <div className={styles.methodNotice} key="pix">
                  <strong>Pix à vista</strong>
                  <p>
                    Você pagará {formatBRL(summary.totalCents)} por QR Code, sem sair desta página.
                    O acesso é liberado após a confirmação do seu banco.
                  </p>
                </div>
              )}
            </div>

            {notice ? (
              <p className={styles.error} role="status">
                {notice}
              </p>
            ) : null}

            {checkoutOpen ? (
              <div className={styles.terms}>
                <label>
                  <input name="acceptTerms" type="checkbox" required />
                  <span>Li e aceito os documentos legais vigentes da MOVIVO.</span>
                </label>
                <p>
                  Consulte os{' '}
                  <a
                    href={LEGAL_LINKS.terms ?? '/termos'}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Termos de Uso
                  </a>{' '}
                  e a{' '}
                  <a
                    href={LEGAL_LINKS.privacy ?? '/privacidade'}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Política de Privacidade
                  </a>{' '}
                  antes de confirmar.
                </p>
              </div>
            ) : (
              <p className={styles.error} role="status">
                A contratação paga está temporariamente indisponível durante o teste beta.
              </p>
            )}

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <Button
              className={styles.submit}
              size="lg"
              disabled={state === 'SUBMITTING' || !checkoutOpen}
            >
              {state === 'SUBMITTING' ? 'Processando com segurança…' : ctaLabel(method)}
            </Button>
            <p className={styles.chargeSummary}>
              {method === 'CARD'
                ? summary.months === 1
                  ? `${formatBRL(summary.monthlyCents)} por mês, até o cancelamento`
                  : `Até ${summary.maxInstallments}x no cartão · total ${formatBRL(summary.totalCents)}`
                : `Cobrança única de ${formatBRL(summary.totalCents)}`}
            </p>
          </>
        )}
      </section>
    </form>
  );
}

function Field({
  label,
  required = true,
  mask,
  onChange,
  ...props
}: React.ComponentProps<'input'> & { label: string; mask?: (value: string) => string }) {
  return (
    <label className={styles.field}>
      <span>
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        required={required}
        {...props}
        onChange={(event) => {
          if (mask) event.currentTarget.value = mask(event.currentTarget.value);
          onChange?.(event);
        }}
      />
    </label>
  );
}

function PixPending({
  result,
  secondsLeft,
  copied,
  onCopy,
  onRegenerate,
  onChangeMethod,
}: {
  result: CheckoutPaymentResult;
  secondsLeft?: number;
  copied: boolean;
  onCopy: () => void;
  onRegenerate?: () => void;
  onChangeMethod: () => void;
}) {
  const qr = result.qrCode;
  if (!qr) return null;
  return (
    <div className={styles.pixState} aria-live="polite">
      <span className={styles.pendingPulse} aria-hidden="true" />
      <h2 id="payment-title">Pague com Pix</h2>
      <p>Aguardando confirmação segura do seu banco.</p>
      <Image
        src={`data:image/png;base64,${qr.encodedImage}`}
        alt="QR Code Pix para pagamento"
        width={240}
        height={240}
        unoptimized
      />
      <div className={styles.pixCode}>
        <span>{qr.payload}</span>
        <Button type="button" variant="outline" onClick={onCopy}>
          <Copy aria-hidden="true" />
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <p className={styles.timer}>
        {secondsLeft === 0 ? 'Este QR Code expirou.' : `Expira em ${formatDuration(secondsLeft)}`}
      </p>
      {onRegenerate ? (
        <Button type="button" variant="outline" onClick={onRegenerate}>
          <RefreshCw aria-hidden="true" />
          Gerar novo QR Code
        </Button>
      ) : null}
      <div className={styles.secondaryActions}>
        <button type="button" onClick={onChangeMethod}>
          Pagar com cartão
        </button>
      </div>
    </div>
  );
}

/** Aguardando o Asaas: indo para a página dele (cartão) ou confirmando o pagamento na volta. */
function Waiting({
  confirming,
  slow,
  checkoutUrl,
}: {
  confirming: boolean;
  slow: boolean;
  checkoutUrl?: string;
}) {
  return (
    <div className={styles.pixState} role="status" aria-live="polite">
      <span className={styles.pendingPulse} aria-hidden="true" />
      <h2 id="payment-title">
        {confirming ? 'Confirmando seu pagamento…' : 'Abrindo o pagamento seguro…'}
      </h2>
      {confirming ? (
        <p>
          {slow
            ? 'A confirmação do banco está demorando um pouco. Pode fechar esta página: você receberá uma mensagem no WhatsApp assim que o pagamento for confirmado.'
            : 'Estamos aguardando a confirmação do Asaas. Isso costuma levar poucos segundos.'}
        </p>
      ) : (
        <>
          <p>Você será levado ao ambiente seguro do Asaas para digitar os dados do cartão.</p>
          {checkoutUrl ? (
            <Button asChild size="lg" className={styles.submit}>
              <a href={checkoutUrl} rel="noopener noreferrer">
                Se nada acontecer, toque aqui
              </a>
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function Success() {
  return (
    <div className={styles.success} role="status">
      <span>
        <Check aria-hidden="true" />
      </span>
      <h2 id="payment-title">Pagamento confirmado</h2>
      <p>Seu acesso está ativo. A confirmação também será enviada pelo WhatsApp.</p>
    </div>
  );
}

function ctaLabel(method: PaymentMethodId) {
  return method === 'PIX' ? 'Gerar Pix' : 'Continuar para o pagamento seguro';
}

/**
 * Resumo do plano escolhido na tela. O plano persistido usa o snapshot do contrato (preço
 * que o aluno viu); outro plano usa o catálogo — o mesmo que o backend aplica ao trocar.
 */
function summaryFor(server: CheckoutSummary, plan: SubscriptionPlanId): CheckoutSummary {
  if (plan === server.plan) return server;
  const option = SUBSCRIPTION_PLANS.find((candidate) => candidate.id === plan);
  if (!option) return server;
  return {
    ...server,
    plan: option.id,
    label: option.label,
    monthlyCents: option.monthlyCents,
    totalCents: option.priceCents,
    months: option.months,
    maxInstallments: option.months,
  };
}

function paymentExplanation(method: PaymentMethodId, summary: CheckoutSummary): string {
  if (method === 'PIX') return `${formatBRL(summary.totalCents)} à vista`;
  return summary.months === 1
    ? `${formatBRL(summary.monthlyCents)} mensal recorrente`
    : `até ${summary.maxInstallments}x no cartão`;
}

function renewalExplanation(method: PaymentMethodId, summary: CheckoutSummary): string {
  if (method === 'CARD' && summary.months === 1) return 'Mensal, até cancelamento';
  return 'Não renova sem nova autorização';
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return '—';
  // Acima de uma hora, "2673:52" não diz nada: mostra horas e minutos.
  if (seconds >= 3_600) {
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    return `${hours} h ${minutes.toString().padStart(2, '0')} min`;
  }
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}
