'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { MoonIcon, SunIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Alternador de tema claro/escuro.
 *
 * Acessibilidade: o botão nunca fica sem nome acessível — os ícones são
 * `aria-hidden` e o rótulo real vem do `aria-label`, que descreve a AÇÃO
 * ("Ativar tema escuro"), não o estado. `aria-pressed` comunica o estado.
 *
 * Antes da hidratação o tema resolvido é desconhecido no servidor; renderizar o
 * ícone direto causaria divergência de hidratação. O botão nasce desabilitado e
 * neutro, e só assume ícone/rótulo depois de montado.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';
  const label = isDark ? 'Ativar tema claro' : 'Ativar tema escuro';

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={mounted ? label : 'Alternar tema'}
      aria-pressed={mounted ? isDark : undefined}
      disabled={!mounted}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {mounted && isDark ? (
        <SunIcon aria-hidden="true" focusable="false" />
      ) : (
        <MoonIcon aria-hidden="true" focusable="false" />
      )}
    </Button>
  );
}
