'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { AnamnesisApiError, sendPhoneCode, verifyPhoneCode } from '@/lib/anamnesis-api';

/**
 * Verificação de posse do WhatsApp por código (US-6.5, Sofia §4).
 *
 * Um único `<input>` real (`autocomplete="one-time-code"`, preenchimento automático de
 * SMS/WhatsApp funciona) por baixo de 6 caixas visuais — 6 inputs separados quebram
 * colar/autofill/leitor de tela (Sofia §4.2). Auto-submit no 6º dígito. Reenvio a partir
 * de 60s; após a 3ª tentativa de reenvio, oferece saída de suporte.
 */
const CODE_LENGTH = 6;
const RESEND_MAX_ATTEMPTS = 3;

export function PhoneOtp({
  token,
  phoneNumber,
  onVerified,
}: {
  token: string;
  phoneNumber: string;
  onVerified: () => void;
}) {
  const [sent, setSent] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [resendAvailableAt, setResendAvailableAt] = React.useState<number | null>(null);
  const [resendCount, setResendCount] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const sendCode = React.useCallback(async () => {
    setError(null);
    try {
      const res = await sendPhoneCode(token, phoneNumber);
      setSent(true);
      setResendAvailableAt(new Date(res.resendAvailableAt).getTime());
      setResendCount((c) => c + 1);
      setCode('');
      inputRef.current?.focus();
    } catch {
      setError('Não conseguimos enviar o código agora. Tente de novo em instantes.');
    }
  }, [token, phoneNumber]);

  React.useEffect(() => {
    void sendCode();
    // Só no primeiro número informado — reenvio é ação explícita do usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneNumber]);

  async function verify(candidate: string) {
    if (candidate.length !== CODE_LENGTH || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      await verifyPhoneCode(token, candidate);
      onVerified();
    } catch (err) {
      if (err instanceof AnamnesisApiError && err.status === 410) {
        setError('Esse código expirou. Peça um novo.');
      } else {
        setError('Código incorreto. Confira e tente de novo.');
      }
      setCode('');
    } finally {
      setVerifying(false);
    }
  }

  function handleCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void verify(digits);
  }

  const resendSecondsLeft = resendAvailableAt
    ? Math.max(0, Math.ceil((resendAvailableAt - now) / 1000))
    : 0;
  const canResend = sent && resendSecondsLeft === 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-input p-4">
      <div>
        <p className="text-body font-semibold">Confirme seu WhatsApp</p>
        <p className="text-label text-muted-foreground">
          Enviamos um código de 6 dígitos para {phoneNumber} pelo WhatsApp. É por esse número que
          você vai receber e conversar sobre o seu treino.
        </p>
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Código de verificação de 6 dígitos"
          value={code}
          onChange={(e) => handleCodeChange(e.target.value)}
          disabled={verifying}
          maxLength={CODE_LENGTH}
          className="absolute inset-0 h-full w-full opacity-0"
        />
        <div className="pointer-events-none flex gap-2" aria-hidden="true">
          {Array.from({ length: CODE_LENGTH }, (_, i) => (
            <div
              key={i}
              className={cn(
                'flex h-12 w-10 items-center justify-center rounded-lg border text-h3 font-semibold',
                code[i] ? 'border-primary' : 'border-input',
              )}
            >
              {code[i] ?? ''}
            </div>
          ))}
        </div>
      </div>

      <FieldFeedback verifying={verifying} error={error} />

      <div className="flex items-center gap-3 text-label">
        {canResend ? (
          resendCount >= RESEND_MAX_ATTEMPTS ? (
            <p className="text-muted-foreground">
              Ainda não chegou? Fale com a gente pelo WhatsApp da MOVIVO para continuar.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void sendCode()}
              className="font-semibold text-foreground underline underline-offset-4"
            >
              Reenviar código
            </button>
          )
        ) : sent ? (
          <p className="text-muted-foreground">Reenviar em {resendSecondsLeft}s</p>
        ) : null}
      </div>
    </div>
  );
}

function FieldFeedback({ verifying, error }: { verifying: boolean; error: string | null }) {
  if (verifying) {
    return (
      <p className="text-label text-muted-foreground" role="status">
        Verificando…
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-label text-destructive">
        {error}
      </p>
    );
  }
  return null;
}
