'use client';

import type * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Provider de tema claro/escuro (US-0.5 / TASK-0.5.2).
 *
 * É o **único** client component que embrulha a árvore inteira, e de propósito: ele
 * não renderiza marcação nenhuma, apenas injeta um script inline que aplica a classe
 * `.dark` no `<html>` antes da primeira pintura. Sem isso haveria flash de tema errado
 * (FOUC) em quem escolheu o escuro. Os filhos continuam sendo Server Components.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
