/**
 * Testes do painel Agente (navegação por etapa).
 *
 * As quatro telas já têm testes próprios; aqui o que importa é o comportamento que só
 * existe neste componente: uma etapa por vez, `aria-selected` acompanhando a seleção e —
 * o ponto de segurança — as capabilities chegando à etapa certa, sem que trocar de aba
 * altere o que cada tela autoriza. Por isso os filhos são substituídos por marcadores que
 * imprimem as props recebidas.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./ai-persona', () => ({
  AiPersonaDashboard: ({ canWrite }: { canWrite: boolean }) => (
    <p>{`persona canWrite=${String(canWrite)}`}</p>
  ),
}));
vi.mock('./ai-rules', () => ({
  AiRulesDashboard: ({ canWrite }: { canWrite: boolean }) => (
    <p>{`regras canWrite=${String(canWrite)}`}</p>
  ),
}));
vi.mock('./ai-knowledge', () => ({
  AiKnowledgeDashboard: ({
    canUpload,
    canApprove,
  }: {
    canUpload: boolean;
    canApprove: boolean;
  }) => <p>{`conhecimento canUpload=${String(canUpload)} canApprove=${String(canApprove)}`}</p>,
}));
vi.mock('./ai-faq', () => ({
  AiFaqDashboard: ({ canWrite }: { canWrite: boolean }) => (
    <p>{`faq canWrite=${String(canWrite)}`}</p>
  ),
}));

import { AiAgentDashboard } from './ai-agent-dashboard';

const renderAgent = (props: Partial<React.ComponentProps<typeof AiAgentDashboard>> = {}) =>
  render(
    <AiAgentDashboard
      canWriteConfig={false}
      canUploadKnowledge={false}
      canApproveKnowledge={false}
      {...props}
    />,
  );

describe('AiAgentDashboard', () => {
  it('abre na persona e mantém só uma etapa visível por vez', () => {
    renderAgent();
    expect(screen.getByRole('tab', { name: 'Persona & Tom de voz' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText(/^persona/)).toBeVisible();
    expect(screen.queryByText(/^regras/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^conhecimento/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^faq/)).not.toBeInTheDocument();
  });

  it('troca de etapa pelo clique e move a seleção acessível junto', async () => {
    const user = userEvent.setup();
    renderAgent();

    await user.click(screen.getByRole('tab', { name: 'Regras invioláveis' }));
    expect(screen.getByText(/^regras/)).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Persona & Tom de voz' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'agent-tab-regras');

    await user.click(screen.getByRole('tab', { name: 'FAQ' }));
    expect(screen.getByText(/^faq/)).toBeVisible();
    expect(screen.queryByText(/^regras/)).not.toBeInTheDocument();
  });

  it('entrega a cada etapa apenas a capability que lhe pertence', async () => {
    const user = userEvent.setup();
    renderAgent({ canWriteConfig: true, canApproveKnowledge: true });

    expect(screen.getByText('persona canWrite=true')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Conhecimento (RAG)' }));
    expect(screen.getByText('conhecimento canUpload=false canApprove=true')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'FAQ' }));
    expect(screen.getByText('faq canWrite=true')).toBeVisible();
  });
});
