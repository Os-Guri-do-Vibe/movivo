import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { marketingResponse } from '../../../test/control-center-fixtures';

const { getMarketing } = vi.hoisted(() => ({ getMarketing: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getMarketing,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { MarketingDashboard } from './marketing-dashboard';

beforeEach(() => getMarketing.mockReset());

describe('MarketingDashboard', () => {
  it('numera as etapas do funil e não inventa zero na etapa sem amostra', async () => {
    getMarketing.mockResolvedValue(marketingResponse);
    render(<MarketingDashboard />);
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeVisible();

    const steps = screen.getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('Etapa 1');
    expect(steps[0]).toHaveTextContent('Formulário iniciado');
    expect(steps[0]).toHaveTextContent('310');
    expect(steps[3]).toHaveTextContent('Assinatura ativa');
    expect(steps[3]).toHaveTextContent('—');
    expect(steps[3]).not.toHaveTextContent(/\b0\b/);
  });

  it('publica só segmentos acima do mínimo e declara os suprimidos', async () => {
    getMarketing.mockResolvedValue(marketingResponse);
    render(<MarketingDashboard />);
    expect(await screen.findByRole('heading', { name: 'Hipertrofia' })).toBeVisible();
    expect(screen.getByText('Objetivo principal')).toBeVisible();
    expect(screen.getByText('Local de treino')).toBeVisible();
    expect(screen.getByText(/menos de 10 pessoas são ocultados/)).toBeVisible();
    expect(screen.getByText('3 segmentos suprimidos')).toBeVisible();
    expect(screen.getByText('Faixa etária')).toBeVisible();
    expect(screen.getByRole('heading', { name: '25-34' })).toBeVisible();
  });

  it('mostra o vazio de público quando nenhum grupo é publicável', async () => {
    getMarketing.mockResolvedValue({
      ...marketingResponse,
      data: { ...marketingResponse.data, segments: [], suppressedSegments: 8 },
    });
    render(<MarketingDashboard />);
    expect(await screen.findByRole('heading', { name: 'Sem segmentos publicáveis' })).toBeVisible();
    expect(screen.getByText('8 segmentos suprimidos')).toBeVisible();
  });

  it('destaca a etapa de maior abandono e nomeia o ponto de parada', async () => {
    getMarketing.mockResolvedValue(marketingResponse);
    render(<MarketingDashboard />);
    expect(await screen.findByRole('heading', { name: 'Onde o cadastro se perde' })).toBeVisible();
    expect(screen.getByText('Maior queda do funil')).toBeVisible();
    expect(screen.getByText('38,7%')).toBeVisible();
    expect(screen.getByText(/Código de verificação do WhatsApp \(74 sessões\)/)).toBeVisible();
  });

  it('suprime o funil inteiro quando o backend não publica etapas', async () => {
    getMarketing.mockResolvedValue({
      ...marketingResponse,
      data: {
        ...marketingResponse.data,
        anamnesisFunnel: {
          settledSessions: 0,
          steps: [],
          worstStep: null,
          exitPoint: {
            status: 'UNAVAILABLE' as const,
            step: null,
            checkpoint: null,
            count: null,
            reason: 'Amostra insuficiente: alguma etapa ficaria com menos de 10 sessões.',
          },
        },
      },
    });
    render(<MarketingDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Funil suprimido por privacidade' }),
    ).toBeVisible();
    expect(screen.queryByText('Maior queda do funil')).not.toBeInTheDocument();
  });

  it('exibe CAC/ROAS por canal e nunca R$ 0,00 em canal sem investimento (US-8.6)', async () => {
    getMarketing.mockResolvedValue(marketingResponse);
    render(<MarketingDashboard />);
    expect(await screen.findByRole('heading', { name: 'Aquisição & Canais' })).toBeVisible();
    // Janela de atribuição declarada na tela, nunca implícita.
    expect(screen.getByText(/convertidos em até 60 dias após o cadastro/i)).toBeVisible();
    // Canal com investimento: CAC em reais.
    expect(screen.getByText('R$ 100,00')).toBeVisible();
    // Canal orgânico: rótulo textual, jamais um valor monetário zerado.
    expect(screen.getByText('sem investimento direto')).toBeVisible();
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
    // Maturidade do LTV declarada quando há menos de 3 coortes maduras.
    expect(screen.getByText(/baixa confiança/i)).toBeVisible();
  });

  it('renderiza a sazonalidade de cadastro, não de mensagens', async () => {
    getMarketing.mockResolvedValue(marketingResponse);
    render(<MarketingDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Cadastros iniciados por dia e hora' }),
    ).toBeVisible();
  });

  it('em 403 não oferece nova tentativa', async () => {
    getMarketing.mockRejectedValueOnce(new ControlCenterApiError(403, 'Sem acesso a Analytics.'));
    render(<MarketingDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('permite recarregar após falha de rede', async () => {
    getMarketing
      .mockRejectedValueOnce(new ControlCenterApiError(502, 'Contrato inválido.'))
      .mockResolvedValueOnce(marketingResponse);
    render(<MarketingDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByRole('heading', { name: 'Funil de aquisição' })).toBeVisible();
  });
});
