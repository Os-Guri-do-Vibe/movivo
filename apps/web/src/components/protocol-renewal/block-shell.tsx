'use client';

import * as React from 'react';

/**
 * Cabeçalho de pergunta compartilhado pelos 5 blocos do formulário de troca de
 * protocolo — mesmo padrão visual/estrutural de `onboarding/step3-parq.tsx`
 * ("Pergunta N de M" + título focável ao entrar na tela, pra leitor de tela anunciar
 * a pergunta nova a cada navegação).
 */
export function QuestionHeader({
  index,
  total,
  titleId,
  titleRef,
  children,
}: {
  index: number;
  total: number;
  titleId: string;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-label text-muted-foreground">
        Pergunta {index} de {total}
      </p>
      <h1
        ref={titleRef}
        id={titleId}
        tabIndex={-1}
        className="text-body font-semibold text-foreground outline-none"
      >
        {children}
      </h1>
    </div>
  );
}

/**
 * Navegação fixa Voltar/Continuar — mesmas classes do rodapé sticky do onboarding
 * (`step3-parq.tsx`/`step2-anamnesis.tsx`), reaproveitada nos 5 blocos.
 */
export function BlockFooter({
  onBack,
  onContinue,
  backLabel = 'Voltar',
  continueLabel = 'Continuar',
  savingLabel = 'Salvando…',
  disabled = false,
  saving = false,
}: {
  onBack?: () => void;
  onContinue: () => void;
  backLabel?: string;
  continueLabel?: string;
  savingLabel?: string;
  disabled?: boolean;
  saving?: boolean;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex flex-col-reverse gap-3 border-t border-border bg-white/95 px-5 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="min-h-[52px] flex-1 rounded-xl border border-input bg-white px-6 text-body font-semibold text-petroleo transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {backLabel}
        </button>
      )}
      <button
        type="button"
        disabled={disabled || saving}
        onClick={onContinue}
        className="min-h-[52px] flex-1 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
      >
        {saving ? savingLabel : continueLabel}
      </button>
    </div>
  );
}
