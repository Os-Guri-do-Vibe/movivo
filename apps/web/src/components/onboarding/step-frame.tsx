'use client';

import * as React from 'react';

import { QuestionStack } from './fields';

/**
 * Quadro comum das etapas 2–8: título, texto de apoio aqui em cima e a barra de ações embaixo
 * (voltar, pular quando a etapa é opcional, continuar). O botão fica colado ao rodapé no celular.
 */
export function StepFrame({
  title,
  description,
  notice,
  canContinue,
  saving,
  continueLabel = 'Continuar',
  onContinue,
  onBack,
  onSkip,
  children,
}: {
  title: string;
  description?: string;
  /** Aviso fixo (ex.: respostas sensíveis não são reexibidas ao retomar). */
  notice?: string;
  canContinue: boolean;
  saving: boolean;
  continueLabel?: string;
  onContinue: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  children: React.ReactNode;
}) {
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <QuestionStack>
      <div>
        <h1 ref={titleRef} tabIndex={-1} className="text-h2 font-bold outline-none">
          {title}
        </h1>
        {description && <p className="mt-2 text-body text-muted-foreground">{description}</p>}
      </div>
      {notice && (
        <p className="rounded-xl border border-border bg-muted/40 p-3 text-label text-muted-foreground">
          {notice}
        </p>
      )}
      {children}
      <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex flex-col gap-2 border-t border-border bg-white/95 px-5 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <button
          type="button"
          disabled={!canContinue || saving}
          onClick={onContinue}
          className="h-[52px] w-full rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {saving ? 'Salvando…' : continueLabel}
        </button>
        <div className="flex justify-between gap-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="h-11 px-2 text-label font-semibold underline underline-offset-4"
            >
              Voltar
            </button>
          ) : (
            <span />
          )}
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={saving}
              className="h-11 px-2 text-label font-semibold text-muted-foreground underline underline-offset-4"
            >
              Pular esta etapa
            </button>
          )}
        </div>
      </div>
    </QuestionStack>
  );
}

/** Rótulo + entrada de um campo simples. */
export function Labeled({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-body font-semibold">
        {label}
      </label>
      {help && <p className="text-label text-muted-foreground">{help}</p>}
      {children}
    </div>
  );
}
