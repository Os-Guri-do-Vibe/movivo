import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmAction } from './confirm-action';

describe('ConfirmAction', () => {
  it('exige uma segunda ação explícita antes de executar', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmAction
        triggerLabel="Liberar"
        title="Confirmar liberação?"
        description="A decisão será auditada."
        confirmLabel="Confirmar agora"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Liberar' }));
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar agora' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it('mantém erro visível e não fecha a confirmação quando a ação falha', async () => {
    render(
      <ConfirmAction
        triggerLabel="Resolver"
        title="Confirmar?"
        description="Descrição"
        confirmLabel="Confirmar resolução"
        onConfirm={vi.fn().mockRejectedValue(new Error('A API recusou a ação.'))}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A API recusou');
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
  });

  it('mostra a mensagem genérica quando a falha não é uma instância de Error', async () => {
    render(
      <ConfirmAction
        triggerLabel="Resolver"
        title="Confirmar?"
        description="Descrição"
        confirmLabel="Confirmar resolução"
        onConfirm={vi.fn().mockRejectedValue('falha crua, sem Error')}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível concluir a ação.');
  });
});
