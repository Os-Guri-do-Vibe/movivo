import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { complianceResponse } from '../../../test/control-center-fixtures';

const { getComplianceSummary } = vi.hoisted(() => ({ getComplianceSummary: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getComplianceSummary,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { ComplianceDashboard } from './compliance-dashboard';

const [event] = complianceResponse.data.recentAuditEvents;
if (!event) throw new Error('fixture sem eventos de auditoria');

beforeEach(() => getComplianceSummary.mockReset());

describe('ComplianceDashboard', () => {
  it('mostra os indicadores de consentimento e marca o que não tem fonte', async () => {
    getComplianceSummary.mockResolvedValue(complianceResponse);
    render(<ComplianceDashboard />);
    expect(await screen.findByRole('heading', { name: 'Compliance e auditoria' })).toBeVisible();
    expect(screen.getByLabelText('Consentimentos ativos: 40')).toBeVisible();
    expect(screen.getByLabelText('Leituras de saúde auditadas: 118')).toBeVisible();
    expect(screen.getByLabelText('Solicitações de privacidade: —')).toBeVisible();
  });

  it('exibe a trilha de auditoria com identificadores encurtados, nunca o UUID inteiro', async () => {
    getComplianceSummary.mockResolvedValue(complianceResponse);
    render(<ComplianceDashboard />);
    const rows = within(await screen.findByRole('table')).getAllByRole('row');
    const row = rows[1];
    if (!row) throw new Error('tabela sem linha de dados');
    expect(within(row).getByText('11/08/2026, 11:30')).toBeVisible();
    expect(within(row).getByText('HEALTH_DATA_READ')).toBeVisible();
    expect(within(row).getByText(`#${event.actorId.slice(0, 8)}`)).toBeVisible();
    expect(within(row).getByText(`#${event.subjectId.slice(0, 8)}`)).toBeVisible();
    expect(screen.queryByText(event.actorId)).not.toBeInTheDocument();
    expect(screen.queryByText(event.subjectId)).not.toBeInTheDocument();
  });

  it('mostra o vazio da trilha quando não há evento recente', async () => {
    getComplianceSummary.mockResolvedValue({
      ...complianceResponse,
      data: { ...complianceResponse.data, recentAuditEvents: [] },
    });
    render(<ComplianceDashboard />);
    expect(await screen.findByRole('heading', { name: 'Sem eventos recentes' })).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('em 403 não oferece nova tentativa', async () => {
    getComplianceSummary.mockRejectedValueOnce(
      new ControlCenterApiError(403, 'Sem acesso a compliance.'),
    );
    render(<ComplianceDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('avisa falha de atualização preservando a trilha já carregada', async () => {
    getComplianceSummary
      .mockResolvedValueOnce(complianceResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<ComplianceDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor indisponível.');
    expect(screen.getByRole('table')).toBeVisible();
  });
});
