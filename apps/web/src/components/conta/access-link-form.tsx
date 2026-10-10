'use client';

import * as React from 'react';
import { MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { renewExpiredLink, requestAccessLink } from '@/lib/subscription-api';

import styles from './access-link-form.module.css';

type Status = 'IDLE' | 'SENDING' | 'SENT' | 'ERROR';

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const local = digits.slice(2);
  return `(${digits.slice(0, 2)}) ${local.length <= 5 ? local : `${local.slice(0, 5)}-${local.slice(5)}`}`;
}

/** A resposta é sempre a mesma, exista ou não assinatura: a página nunca revela quem é cliente. */
function Sent() {
  return (
    <p className={styles.sent} role="status">
      Se este número tiver uma assinatura, enviamos agora um link para o seu WhatsApp. Ele chega em
      poucos instantes.
    </p>
  );
}

/** Página pública `/conta`: pede um link novo de gerenciamento pelo celular cadastrado. */
export function AccessLinkForm() {
  const [status, setStatus] = React.useState<Status>('IDLE');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = String(new FormData(event.currentTarget).get('phone') ?? '').replace(/\D/g, '');
    setStatus('SENDING');
    try {
      await requestAccessLink(phone);
      setStatus('SENT');
    } catch {
      setStatus('ERROR');
    }
  }

  if (status === 'SENT') return <Sent />;

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>
        <span>Celular cadastrado na MOVIVO</span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(00) 90000-0000"
          required
          pattern="\([0-9]{2}\) [0-9]{4,5}-[0-9]{4}"
          minLength={14}
          maxLength={15}
          onChange={(event) => {
            event.currentTarget.value = maskPhone(event.currentTarget.value);
          }}
        />
      </label>
      {status === 'ERROR' ? (
        <p className={styles.error} role="alert">
          Não foi possível enviar agora. Tente novamente em instantes.
        </p>
      ) : null}
      <Button size="lg" disabled={status === 'SENDING'}>
        <MessageCircle aria-hidden="true" />
        {status === 'SENDING' ? 'Enviando…' : 'Receber link no WhatsApp'}
      </Button>
    </form>
  );
}

/** Link curto vencido: um toque reenvia um link novo ao WhatsApp do dono. */
export function RenewLinkButton({ code }: { code: string }) {
  const [status, setStatus] = React.useState<Status>('IDLE');

  async function renew() {
    setStatus('SENDING');
    try {
      await renewExpiredLink(code);
      setStatus('SENT');
    } catch {
      setStatus('ERROR');
    }
  }

  if (status === 'SENT') {
    return (
      <div className={styles.sent} role="status">
        Se o link for de uma assinatura sua, enviamos um novo agora para o seu WhatsApp.
      </div>
    );
  }

  return (
    <div className={styles.form}>
      {status === 'ERROR' ? (
        <p className={styles.error} role="alert">
          Não foi possível enviar agora. Tente novamente em instantes.
        </p>
      ) : null}
      <Button size="lg" onClick={() => void renew()} disabled={status === 'SENDING'}>
        <MessageCircle aria-hidden="true" />
        {status === 'SENDING' ? 'Enviando…' : 'Receber novo link no WhatsApp'}
      </Button>
    </div>
  );
}
