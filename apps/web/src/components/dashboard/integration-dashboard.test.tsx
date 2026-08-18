import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import {
  integrationConnectedResponse,
  integrationConnectingResponse,
  integrationNotConfiguredResponse,
} from '../../../test/control-center-fixtures';

const { getIntegration, createWhatsappInstance } = vi.hoisted(() => ({
  getIntegration: vi.fn(),
  createWhatsappInstance: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getIntegration,
  createWhatsappInstance,
}));

import { IntegrationDashboard } from './integration-dashboard';

beforeEach(() => {
  getIntegration.mockReset();
  createWhatsappInstance.mockReset();
  vi.useRealTimers();
});

describe('IntegrationDashboard', () => {
  it('sem instância: mostra "Como configurar", o formulário e o badge "Não configurado"', async () => {
    getIntegration.mockResolvedValue(integrationNotConfiguredResponse);
    render(<IntegrationDashboard />);
    expect(await screen.findByText('Não configurado')).toBeVisible();
    expect(screen.getByText('Como configurar:')).toBeVisible();
    expect(screen.getByLabelText('Nome da instância')).toHaveValue('minha-empresa');
    expect(screen.getByRole('button', { name: 'Criar Instância' })).toBeEnabled();
  });

  it('cria a instância, mostra o QR code e passa a badge "Conectando…"', async () => {
    const user = userEvent.setup();
    getIntegration.mockResolvedValue(integrationNotConfiguredResponse);
    createWhatsappInstance.mockResolvedValue(integrationConnectingResponse);
    render(<IntegrationDashboard />);
    await screen.findByRole('button', { name: 'Criar Instância' });

    await user.clear(screen.getByLabelText('Nome da instância'));
    await user.type(screen.getByLabelText('Nome da instância'), 'meu-teste');
    await user.click(screen.getByRole('button', { name: 'Criar Instância' }));

    expect(createWhatsappInstance).toHaveBeenCalledWith({ instanceName: 'meu-teste' });
    expect(await screen.findByAltText('QR Code para conectar o WhatsApp')).toHaveAttribute(
      'src',
      'data:image/png;base64,abc',
    );
  });

  it('erro ao criar: mostra a mensagem sem travar o formulário', async () => {
    const user = userEvent.setup();
    getIntegration.mockResolvedValue(integrationNotConfiguredResponse);
    createWhatsappInstance.mockRejectedValue(new Error('EvolutionAPI respondeu 500'));
    render(<IntegrationDashboard />);
    await user.click(await screen.findByRole('button', { name: 'Criar Instância' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('EvolutionAPI respondeu 500');
    expect(screen.getByRole('button', { name: 'Criar Instância' })).toBeEnabled();
  });

  it('conectado: mostra o nome da instância, sem QR nem formulário', async () => {
    getIntegration.mockResolvedValue(integrationConnectedResponse);
    render(<IntegrationDashboard />);
    expect(await screen.findByText('Conectado')).toBeVisible();
    expect(screen.getByText('minha-empresa')).toBeVisible();
    expect(screen.queryByLabelText('Nome da instância')).not.toBeInTheDocument();
    expect(screen.queryByAltText('QR Code para conectar o WhatsApp')).not.toBeInTheDocument();
  });

  it('faz polling a cada 3s só enquanto "Conectando…"', async () => {
    vi.useFakeTimers();
    getIntegration.mockResolvedValue(integrationConnectingResponse);
    render(<IntegrationDashboard />);
    await act(async () => Promise.resolve());
    expect(getIntegration).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(getIntegration).toHaveBeenCalledTimes(2);

    getIntegration.mockResolvedValue(integrationConnectedResponse);
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(getIntegration).toHaveBeenCalledTimes(3);

    // Já conectou — não deve mais fazer polling.
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(getIntegration).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
