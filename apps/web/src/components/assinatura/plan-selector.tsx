'use client';

import * as React from 'react';
import { Check, Copy, CreditCard, LockKeyhole, QrCode, RefreshCw } from 'lucide-react';
import Image from 'next/image';

import type {
  CheckoutPaymentResult,
  CheckoutPayer,
  CheckoutSummary,
  CreateCheckoutBody,
  PaymentMethodId,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { formatBRL, getCheckoutSummary, startCheckoutPayment } from '@/lib/subscription-api';

import styles from './plan-selector.module.css';

const METHODS: {
  id: PaymentMethodId;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  { id: 'CARD', label: 'Cartão', description: 'Crédito seguro', icon: CreditCard },
  { id: 'PIX', label: 'Pix à vista', description: 'QR Code imediato', icon: QrCode },
  {
    id: 'PIX_AUTOMATIC',
    label: 'Pix Automático',
    description: 'Autorização no banco',
    icon: RefreshCw,
  },
];

type CheckoutState = 'FORM' | 'SUBMITTING' | 'PENDING' | 'SUCCESS' | 'ERROR';
type CardBrand = 'VISA' | 'MASTERCARD' | 'AMEX' | 'ELO' | 'HIPERCARD' | 'DISCOVER' | 'JCB';

const CARD_BRAND_LABEL: Record<CardBrand, string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  AMEX: 'American Express',
  ELO: 'Elo',
  HIPERCARD: 'Hipercard',
  DISCOVER: 'Discover',
  JCB: 'JCB',
};

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

function maskCardExpiry(value: string): string {
  const digits = onlyDigits(value, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function detectCardBrand(value: string): CardBrand | null {
  const digits = onlyDigits(value, 19);
  if (!digits) return null;

  // Elo compartilha prefixos com Visa e Discover, então precisa ser verificado primeiro.
  if (
    /^(401178|401179|431274|438935|451416|457393|457631|457632|504175|5066|5067|509|627780|636297|636368|65003|65004|65005|6504|6505|6507|6509|6516|6550)/.test(
      digits,
    )
  )
    return 'ELO';
  if (/^(606282|3841)/.test(digits)) return 'HIPERCARD';
  if (/^4/.test(digits)) return 'VISA';
  if (/^3[47]/.test(digits)) return 'AMEX';
  if (/^5[1-5]/.test(digits)) return 'MASTERCARD';

  const firstFour = Number(digits.slice(0, 4));
  if (digits.length >= 4 && firstFour >= 2221 && firstFour <= 2720) return 'MASTERCARD';
  if (/^(6011|64[4-9]|65)/.test(digits)) return 'DISCOVER';
  if (digits.length >= 4 && firstFour >= 3528 && firstFour <= 3589) return 'JCB';
  return null;
}

export function PlanSelector({ token }: { token: string }) {
  const [summary, setSummary] = React.useState<CheckoutSummary>();
  const [method, setMethod] = React.useState<PaymentMethodId>('CARD');
  const [installments, setInstallments] = React.useState(1);
  const [state, setState] = React.useState<CheckoutState>('FORM');
  const [result, setResult] = React.useState<CheckoutPaymentResult>();
  const [lastBody, setLastBody] = React.useState<CreateCheckoutBody>();
  const [error, setError] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const [secondsLeft, setSecondsLeft] = React.useState<number>();

  const loadSummary = React.useCallback(async () => {
    const current = await getCheckoutSummary(token);
    setSummary(current);
    setInstallments((value) => Math.min(value, current.maxInstallments));
    if (current.status === 'ACTIVE') setState('SUCCESS');
    return current;
  }, [token]);

  React.useEffect(() => {
    loadSummary().catch(() => {
      setError('Este link é inválido ou expirou. Solicite um novo link pelo WhatsApp.');
      setState('ERROR');
    });
  }, [loadSummary]);

  React.useEffect(() => {
    if (state !== 'PENDING') return;
    const timer = window.setInterval(() => void loadSummary().catch(() => undefined), 3_000);
    return () => window.clearInterval(timer);
  }, [loadSummary, state]);

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

  async function submit(event: React.FormEvent<HTMLFormElement>, regenerate = false) {
    event.preventDefault();
    if (!summary) return;
    setState('SUBMITTING');
    setError('');
    const data = new FormData(event.currentTarget);
    const expiry = onlyDigits(String(data.get('cardExpiry') ?? ''), 4);
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
      const body =
        method === 'CARD'
          ? {
              method,
              payer,
              card: {
                holderName: String(data.get('holderName') ?? ''),
                number: onlyDigits(String(data.get('cardNumber') ?? ''), 19),
                expiryMonth: expiry.slice(0, 2),
                expiryYear: expiry.length === 4 ? `20${expiry.slice(2)}` : '',
                ccv: onlyDigits(String(data.get('ccv') ?? ''), 4),
              },
              installments,
              acceptTerms: true as const,
            }
          : { method, payer, acceptTerms: true as const, regenerate };
      setLastBody(body);
      const next = await startCheckoutPayment(token, body);
      setResult(next);
      setState(next.status === 'REFUSED' || next.status === 'EXPIRED' ? 'ERROR' : 'PENDING');
      if (next.status === 'REFUSED') setError('O pagamento não foi aprovado. Revise os dados.');
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.endsWith('_409')
          ? 'Já existe uma tentativa em processamento. Aguarde alguns segundos.'
          : 'Não foi possível iniciar o pagamento. Revise os dados e tente novamente.',
      );
      setState('ERROR');
    }
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

  return (
    <form className={styles.checkoutGrid} onSubmit={submit} noValidate={false}>
      <section className={styles.planColumn} aria-labelledby="checkout-title">
        <p className={styles.eyebrow}>Seu plano MOVIVO</p>
        <h1 id="checkout-title">Seu próximo passo começa aqui.</h1>
        <p className={styles.subtitle}>Escolha como deseja continuar sua evolução.</p>

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
            <Check aria-hidden="true" /> Supervisão de profissional CREF
          </li>
        </ul>
      </section>

      <section className={styles.paymentCard} aria-labelledby="payment-title">
        {state === 'SUCCESS' ? (
          <Success />
        ) : result?.qrCode && state === 'PENDING' ? (
          <PixPending
            result={result}
            secondsLeft={secondsLeft}
            copied={copied}
            onCopy={copyPix}
            onRegenerate={expired ? () => void regeneratePix() : undefined}
          />
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
              <span>Sandbox</span>
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
                  pattern="[(][0-9]{2}[)] 9[0-9]{4}-[0-9]{4}"
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
                <div className={styles.contextFields} key="card">
                  <Field name="holderName" label="Nome impresso no cartão" autoComplete="cc-name" />
                  <CardNumberField />
                  <div className={styles.cardRow}>
                    <Field
                      name="cardExpiry"
                      label="Validade"
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      placeholder="MM/AA"
                      pattern="(0[1-9]|1[0-2])/[0-9]{2}"
                      minLength={5}
                      maxLength={5}
                      mask={maskCardExpiry}
                    />
                    <Field
                      name="ccv"
                      label="CVV"
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      minLength={3}
                      maxLength={4}
                    />
                  </div>
                  <label className={styles.selectLabel}>
                    Parcelas
                    <select
                      value={installments}
                      onChange={(event) => setInstallments(Number(event.target.value))}
                    >
                      {Array.from({ length: summary.maxInstallments }, (_, index) => index + 1).map(
                        (count) => (
                          <option key={count} value={count}>
                            {installmentOption(summary.totalCents, count)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
              ) : method === 'PIX_AUTOMATIC' ? (
                <div className={styles.methodNotice} key="auto">
                  <strong>Autorize no app do seu banco</strong>
                  <p>
                    {summary.months} {summary.months === 1 ? 'débito mensal' : 'débitos mensais'} de{' '}
                    {formatBRL(summary.monthlyCents)}. A autorização termina com o período
                    contratado.
                  </p>
                </div>
              ) : (
                <div className={styles.methodNotice} key="pix">
                  <strong>Pix à vista</strong>
                  <p>
                    Você pagará {formatBRL(summary.totalCents)} por QR Code. O acesso só é ativado
                    após a confirmação bancária.
                  </p>
                </div>
              )}
            </div>

            <label className={styles.terms}>
              <input name="acceptTerms" type="checkbox" required />
              <span>Li e aceito os Termos de Assinatura vigentes e a Política de Privacidade.</span>
            </label>

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <Button className={styles.submit} size="lg" disabled={state === 'SUBMITTING'}>
              {state === 'SUBMITTING' ? 'Processando com segurança…' : ctaLabel(method)}
            </Button>
            <p className={styles.chargeSummary}>
              {method === 'CARD'
                ? `${installmentOption(summary.totalCents, installments)} · total exato ${formatBRL(summary.totalCents)}`
                : method === 'PIX'
                  ? `Cobrança única de ${formatBRL(summary.totalCents)}`
                  : `${summary.months} cobrança${summary.months === 1 ? '' : 's'} de ${formatBRL(summary.monthlyCents)}`}
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

function CardNumberField() {
  const [brand, setBrand] = React.useState<CardBrand | null>(null);

  return (
    <label className={styles.field}>
      <span>Número do cartão *</span>
      <span className={styles.cardNumberControl}>
        <input
          name="cardNumber"
          required
          inputMode="numeric"
          autoComplete="cc-number"
          minLength={13}
          maxLength={19}
          onChange={(event) => {
            event.currentTarget.value = onlyDigits(event.currentTarget.value, 19);
            setBrand(detectCardBrand(event.currentTarget.value));
          }}
        />
        <CardBrandMark brand={brand} />
      </span>
    </label>
  );
}

function CardBrandMark({ brand }: { brand: CardBrand | null }) {
  if (!brand) {
    return (
      <span className={`${styles.cardBrand} ${styles.cardBrandGeneric}`} aria-hidden="true">
        <CreditCard />
      </span>
    );
  }

  return (
    <span
      className={`${styles.cardBrand} ${styles[`cardBrand${brand}`]}`}
      role="status"
      aria-label={`Bandeira ${CARD_BRAND_LABEL[brand]} detectada`}
    >
      {brand === 'MASTERCARD' ? (
        <span className={styles.mastercardMark} aria-hidden="true">
          <i />
          <i />
        </span>
      ) : (
        <span aria-hidden="true">{brand === 'HIPERCARD' ? 'HIPER' : brand}</span>
      )}
    </span>
  );
}

function PixPending({
  result,
  secondsLeft,
  copied,
  onCopy,
  onRegenerate,
}: {
  result: CheckoutPaymentResult;
  secondsLeft?: number;
  copied: boolean;
  onCopy: () => void;
  onRegenerate?: () => void;
}) {
  const qr = result.qrCode;
  if (!qr) return null;
  return (
    <div className={styles.pixState} aria-live="polite">
      <span className={styles.pendingPulse} aria-hidden="true" />
      <h2>{result.method === 'PIX_AUTOMATIC' ? 'Autorize o Pix Automático' : 'Pague com Pix'}</h2>
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
    </div>
  );
}

function Success() {
  return (
    <div className={styles.success} role="status">
      <span>
        <Check aria-hidden="true" />
      </span>
      <h2>Pagamento confirmado</h2>
      <p>Seu acesso está ativo. A confirmação também será enviada pelo WhatsApp.</p>
    </div>
  );
}

function ctaLabel(method: PaymentMethodId) {
  if (method === 'PIX') return 'Pagar com Pix';
  if (method === 'PIX_AUTOMATIC') return 'Autorizar Pix Automático';
  return 'Confirmar assinatura';
}

function paymentExplanation(method: PaymentMethodId, summary: CheckoutSummary): string {
  if (method === 'PIX_AUTOMATIC')
    return `${summary.months}x mensais de ${formatBRL(summary.monthlyCents)}`;
  if (method === 'PIX') return `${formatBRL(summary.totalCents)} à vista`;
  return summary.months === 1
    ? `${formatBRL(summary.monthlyCents)} mensal recorrente`
    : `até ${summary.maxInstallments}x no cartão`;
}

function renewalExplanation(method: PaymentMethodId, summary: CheckoutSummary): string {
  if (method === 'CARD' && summary.months === 1) return 'Mensal, até cancelamento';
  return 'Não renova sem nova autorização';
}

function installmentOption(totalCents: number, count: number): string {
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;
  return remainderCents === 0
    ? `${count}x de ${formatBRL(baseCents)} sem juros`
    : `${count}x a partir de ${formatBRL(baseCents)} sem juros (última ajustada)`;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return '—';
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}
