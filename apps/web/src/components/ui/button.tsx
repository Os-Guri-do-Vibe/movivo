import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Botão do design system "O Pulso" (shadcn/ui, estilo new-york).
 *
 * Mapeamento das variantes ao que Sofia especificou (`09-relatorio-sofia.md` §15):
 *   `default`     botão primário — preenchimento Verde Pulso, texto Petróleo (8,4:1)
 *   `outline`     botão secundário — contorno Musgo sobre a superfície clara
 *   `destructive` Coral Vivo — "alerta gentil"/"puxado", texto Petróleo (5,06:1)
 *
 * É um Server Component: não tem `'use client'` e não usa hook nenhum. Só vira
 * client component quem o embrulhar com handler de evento.
 */
const buttonVariants = cva(
  /*
   * O anel de foco usa `--ring` em opacidade cheia e um offset de 2px contra o
   * `--background`: WCAG 2.2 (2.4.11/1.4.11) exige 3:1 no indicador de foco, e
   * qualquer transparência derrubaria essa razão silenciosamente.
   */
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-label font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:ring-ring focus-visible:ring-[3px] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:ring-destructive aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline:
          'border border-input bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        // Sem cor própria: Verde Pulso como texto sobre fundo claro dá 1,59:1 (Kimura).
        link: 'text-foreground underline underline-offset-4 hover:opacity-80',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-9 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-11 rounded-lg px-6 has-[>svg]:px-4',
        icon: 'size-10 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Renderiza no elemento filho (`<a>`, `<Link>`) em vez de num `<button>`. */
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
