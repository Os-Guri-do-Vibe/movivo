/**
 * Testes do `Dialog` do design system "O Pulso" — só o contrato de `showCloseButton`,
 * que decide se o "x" de fechar aparece (o resto é comportamento do Radix Dialog).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

describe('Dialog', () => {
  it('por padrão mostra o botão de fechar', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Título</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeVisible();
  });

  it('com showCloseButton=false, não mostra o botão de fechar', () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Título</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  });
});
