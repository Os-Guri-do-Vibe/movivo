import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { goToStep } = vi.hoisted(() => ({ goToStep: vi.fn() }));

vi.mock('./agent-persona-context', () => ({
  AgentPersonaProvider: ({ children }: { children: React.ReactNode }) => children,
  useAgentPersona: () => ({ goToStep }),
}));
vi.mock('./agent-summary-card', () => ({
  AgentSummaryCard: ({ onOpenPersona }: { onOpenPersona: (step: string) => void }) => (
    <button type="button" onClick={() => onOpenPersona('fala')}>
      Editar jeito de falar
    </button>
  ),
}));
vi.mock('./ai-persona', () => ({
  AiPersonaDashboard: () => <p>configuração do agente</p>,
}));
vi.mock('./ai-faq', () => ({
  AiFaqDashboard: ({ canWrite }: { canWrite: boolean }) => (
    <p>{`faq canWrite=${String(canWrite)}`}</p>
  ),
}));

import { AiAgentDashboard } from './ai-agent-dashboard';

const renderAgent = (props: Partial<React.ComponentProps<typeof AiAgentDashboard>> = {}) =>
  render(<AiAgentDashboard canWriteConfig={false} canApproveGuardrails={false} {...props} />);

describe('AiAgentDashboard', () => {
  beforeEach(() => {
    window.location.hash = '';
    goToStep.mockReset();
  });

  it('mantém um único h1 e abre na configuração', () => {
    renderAgent();
    expect(screen.getByRole('heading', { name: 'Agente', level: 1 })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Configuração' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('configuração do agente')).toBeVisible();
    expect(screen.getByText(/^faq canWrite/)).not.toBeVisible();
  });

  it('abre FAQ, preserva a capability e atualiza o deep-link', async () => {
    const user = userEvent.setup();
    renderAgent({ canWriteConfig: true });

    await user.click(screen.getByRole('tab', { name: 'FAQ' }));
    expect(screen.getByText('faq canWrite=true')).toBeVisible();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'agent-tab-faq');
    expect(window.location.hash).toBe('#faq');
  });

  it('abre o deep-link de FAQ e ignora hashes antigos ou desconhecidos', () => {
    window.location.hash = '#faq';
    const { unmount } = renderAgent();
    expect(screen.getByRole('tab', { name: 'FAQ' })).toHaveAttribute('aria-selected', 'true');
    unmount();

    window.location.hash = '#conhecimento';
    renderAgent();
    expect(screen.getByRole('tab', { name: 'Configuração' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('permite navegar pelas abas com setas, Home e End', () => {
    renderAgent();
    const configuration = screen.getByRole('tab', { name: 'Configuração' });
    const faq = screen.getByRole('tab', { name: 'FAQ' });

    configuration.focus();
    fireEvent.keyDown(configuration, { key: 'ArrowRight' });
    expect(faq).toHaveFocus();
    expect(faq).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(faq, { key: 'Home' });
    expect(configuration).toHaveFocus();
    fireEvent.keyDown(configuration, { key: 'End' });
    expect(faq).toHaveFocus();
  });

  it('atalho do cartão abre a configuração na etapa pedida', async () => {
    const user = userEvent.setup();
    window.location.hash = '#faq';
    renderAgent();

    await user.click(screen.getByRole('button', { name: 'Editar jeito de falar' }));
    expect(goToStep).toHaveBeenCalledWith('fala');
    expect(screen.getByRole('tab', { name: 'Configuração' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
