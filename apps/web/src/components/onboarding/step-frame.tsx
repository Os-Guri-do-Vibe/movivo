'use client';

import * as React from 'react';
import { Info } from 'lucide-react';

import { FieldHelp, FieldLabel, QuestionField, QuestionStack } from './fields';

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
  children: React.ReactNode;
}) {
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <QuestionStack>
      <div className="pb-1 text-center">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-balance text-h2 font-bold text-petroleo outline-none sm:text-[1.75rem] sm:leading-[1.2] sm:tracking-[-0.015em]"
        >
          {title}
        </h1>
        {description && (
          <p className="mx-auto mt-2.5 max-w-[34rem] text-pretty text-body text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {notice && (
        <p className="flex items-start gap-2.5 rounded-xl bg-nevoa px-4 py-3 text-label text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-petroleo" />
          {notice}
        </p>
      )}
      {children}
      <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex flex-col gap-2 border-t border-border bg-white/95 px-5 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={saving}
              className="h-[52px] shrink-0 rounded-xl border border-input bg-white px-6 text-body font-semibold text-petroleo transition-colors hover:bg-secondary disabled:opacity-50 sm:flex-1"
            >
              Voltar
            </button>
          )}
          <button
            type="button"
            disabled={!canContinue || saving}
            onClick={onContinue}
            className="h-[52px] shrink-0 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground sm:flex-1"
          >
            {saving ? 'Salvando…' : continueLabel}
          </button>
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
  optional,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  /** Resposta opcional (marcada como "Opcional"); sem isto a pergunta é obrigatória. */
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <QuestionField>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      {help && <FieldHelp>{help}</FieldHelp>}
      {children}
    </QuestionField>
  );
}
