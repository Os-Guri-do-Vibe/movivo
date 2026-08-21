'use client';

/**
 * Primitivos de campo do assistente de persona.
 *
 * ## O bug de contraste que estes componentes corrigem
 * A mensagem de erro do painel era `text-coral` sobre fundo claro: 2,84:1, abaixo do
 * mínimo de 4,5:1 da WCAG 1.4.3 — ou seja, a informação mais crítica da tela era a menos
 * legível. Aqui o Coral fica na **borda e no ícone** (elementos gráficos, mínimo 3:1) e o
 * texto vai em `--foreground`. A cor deixa de ser o canal da mensagem e passa a ser o
 * reforço dela, que é a regra da 1.4.1 de qualquer forma.
 */
import { AlertTriangle, Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-body ' +
  'focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

/** Erro que impede publicar. `role="alert"` porque aparece em resposta à digitação. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p
      id={id}
      role="alert"
      className="mt-2 flex items-start gap-2 rounded-lg border border-coral bg-card px-3 py-2 text-label text-foreground"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coral" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Aviso que **não** bloqueia. Mesmo tratamento visual do erro de propósito: para quem lê,
 * os dois são "olha isto aqui". A diferença de consequência está no texto e no fato de
 * "Próximo" continuar habilitado — não em um segundo vocabulário de cor para decorar.
 */
export function FieldWarning({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="mt-2 flex items-start gap-2 rounded-lg border border-coral bg-card px-3 py-2 text-label text-foreground"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coral" />
      <span>{children}</span>
    </p>
  );
}

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  /** Exemplo concreto do efeito da opção — reconhecer bate recordação. */
  hint: string;
}

/**
 * Grupo de rádio em cartões. Substitui `<select>` onde as opções cabem na tela: um menu
 * fechado obriga o leitor a lembrar o que "Moderado" significa; três cartões mostram.
 */
export function RadioCards<T extends string>({
  legend,
  description,
  name,
  value,
  options,
  disabled = false,
  onChange,
}: {
  legend: string;
  description?: string;
  name: string;
  value: T;
  options: ReadonlyArray<RadioCardOption<T>>;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-label font-semibold">{legend}</legend>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-label',
                'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-verde-pulso',
                checked ? 'border-verde-pulso bg-accent' : 'border-border bg-card',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <input
                  type="radio"
                  className="size-4"
                  name={name}
                  value={option.value}
                  checked={checked}
                  onChange={() => onChange(option.value)}
                />
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Interruptor. `role="switch"` num `<button>` real: o `aria-checked` é o estado, o rótulo
 * visível é o nome acessível, e Espaço/Enter funcionam sem handler de teclado próprio.
 */
export function SwitchField({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
      <span className="min-w-0">
        <span className="block text-label font-semibold" id={labelId}>
          {label}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
          'focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
          checked ? 'border-verde-pulso bg-verde-pulso' : 'border-input bg-muted',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex size-5 items-center justify-center rounded-full bg-card transition-transform',
            checked ? 'translate-x-[1.375rem]' : 'translate-x-0.5',
          )}
        >
          {checked ? <Check aria-hidden="true" className="size-3 text-petroleo" /> : null}
        </span>
      </button>
    </div>
  );
}

/**
 * Bloco travado em código. Mesma linguagem de `ai-rules.tsx`: cadeado + a frase que diz a
 * verdade inteira ("nenhum painel muda isto, em nenhuma versão"), nunca um campo cinza —
 * campo desabilitado comunica "você não pode agora", que é outra coisa.
 */
export function LockedBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-secondary p-4">
      <h3 className="flex items-center gap-2 text-label font-semibold">
        <AlertTriangle className="hidden" aria-hidden="true" />
        <LockIcon />
        {title}
      </h3>
      <p className="mt-2 text-label text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

function LockIcon() {
  return (
    <svg
      aria-label="Travado em código"
      role="img"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Bolha de WhatsApp ilustrativa. Nunca é saída real do modelo — e o rótulo diz isso. */
export function WhatsappBubble({
  agentName,
  text,
  caption = 'Exemplo ilustrativo — não é uma resposta real do modelo.',
}: {
  agentName: string;
  text: string;
  caption?: string;
}) {
  return (
    <figure className="mt-3">
      <div className="rounded-xl rounded-tl-sm border border-border bg-secondary p-3">
        <p className="text-xs font-semibold text-muted-foreground">{agentName}</p>
        <p className="mt-1 text-label whitespace-pre-line text-foreground">{text}</p>
      </div>
      <figcaption className="mt-1 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
