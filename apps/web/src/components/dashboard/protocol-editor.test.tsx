import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { protocolContent, PROTOCOL_ID } from '../../../test/dashboard-fixtures';

const { saveProtocol, capture } = vi.hoisted(() => ({ saveProtocol: vi.fn(), capture: vi.fn() }));
vi.mock('@/lib/dashboard-api', () => ({
  DashboardApiError: class DashboardApiError extends Error {},
  saveProtocol,
  captureDashboardEvent: capture,
}));

import { ProtocolEditor } from './protocol-editor';

beforeEach(() => {
  saveProtocol.mockReset();
  capture.mockReset();
});

describe('ProtocolEditor', () => {
  it('exige motivo auditável antes de chamar o ValidationService do servidor', async () => {
    render(
      <ProtocolEditor
        protocolId={PROTOCOL_ID}
        content={protocolContent}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /validar e salvar edição/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('auditoria');
    expect(saveProtocol).not.toHaveBeenCalled();
  });

  it('envia o contrato estruturado e confirma a validação autoritativa', async () => {
    saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(
      <ProtocolEditor
        protocolId={PROTOCOL_ID}
        content={protocolContent}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />,
    );
    await userEvent.clear(screen.getByLabelText(/motivo da edição/i));
    await userEvent.type(
      screen.getByLabelText(/motivo da edição/i),
      'Ajuste de volume após revisão profissional',
    );
    await userEvent.click(screen.getByRole('button', { name: /validar e salvar edição/i }));
    await waitFor(() =>
      expect(saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({ phase: 'HIPERTROFIA' }),
        'Ajuste de volume após revisão profissional',
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('permite cancelar sem persistir mudanças', async () => {
    const onCancel = vi.fn();
    render(
      <ProtocolEditor
        protocolId={PROTOCOL_ID}
        content={protocolContent}
        onCancel={onCancel}
        onSaved={vi.fn()}
      />,
    );
    await userEvent.clear(screen.getByLabelText('Foco'));
    await userEvent.type(screen.getByLabelText('Foco'), 'Outro foco');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }));
    expect(onCancel).toHaveBeenCalled();
    expect(saveProtocol).not.toHaveBeenCalled();
  });

  it('edita todos os campos estruturados e omite textos opcionais vazios', async () => {
    saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(
      <ProtocolEditor
        protocolId={PROTOCOL_ID}
        content={protocolContent}
        onCancel={vi.fn()}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText('Fase'), 'FORCA');
    await userEvent.clear(screen.getByLabelText(/frequência semanal/i));
    await userEvent.type(screen.getByLabelText(/frequência semanal/i), '4');
    await userEvent.clear(screen.getByLabelText(/identificação do dia/i));
    await userEvent.type(screen.getByLabelText(/identificação do dia/i), 'Treino B');
    await userEvent.clear(screen.getByLabelText('Foco'));
    await userEvent.type(screen.getByLabelText('Foco'), 'Força geral');
    await userEvent.clear(screen.getByLabelText('Nome'));
    await userEvent.type(screen.getByLabelText('Nome'), 'Agachamento ajustado');
    await userEvent.clear(screen.getByLabelText('Séries'));
    await userEvent.type(screen.getByLabelText('Séries'), '4');
    await userEvent.clear(screen.getByLabelText(/descanso/i));
    await userEvent.type(screen.getByLabelText(/descanso/i), '120');
    await userEvent.clear(screen.getByLabelText(/repetições mín/i));
    await userEvent.type(screen.getByLabelText(/repetições mín/i), '6');
    await userEvent.clear(screen.getByLabelText(/repetições máx/i));
    await userEvent.type(screen.getByLabelText(/repetições máx/i), '8');
    await userEvent.selectOptions(screen.getByLabelText(/estratégia de carga/i), 'RPE');
    await userEvent.clear(screen.getByLabelText('Observação'));
    await userEvent.clear(screen.getByLabelText(/observações gerais/i));
    await userEvent.type(screen.getByLabelText(/motivo da edição/i), 'Ajuste profissional');
    await userEvent.click(screen.getByRole('button', { name: /validar e salvar edição/i }));

    await waitFor(() => expect(saveProtocol).toHaveBeenCalledTimes(1));
    expect(saveProtocol.mock.calls[0]?.[1]).toMatchObject({
      phase: 'FORCA',
      weeklyFrequency: 4,
      generalNotes: undefined,
      sessions: [
        expect.objectContaining({
          dayLabel: 'Treino B',
          focus: 'Força geral',
          exercises: [
            expect.objectContaining({
              name: 'Agachamento ajustado',
              sets: 4,
              restSeconds: 120,
              reps: { min: 6, max: 8 },
              loadStrategy: 'RPE',
              notes: undefined,
            }),
          ],
        }),
      ],
    });
  });

  it('bloqueia contrato local inválido sem enviar ao servidor', async () => {
    render(
      <ProtocolEditor
        protocolId={PROTOCOL_ID}
        content={protocolContent}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await userEvent.clear(screen.getByLabelText(/frequência semanal/i));
    await userEvent.type(screen.getByLabelText(/frequência semanal/i), '9');
    await userEvent.type(screen.getByLabelText(/motivo da edição/i), 'Revisão profissional');
    await userEvent.click(screen.getByRole('button', { name: /validar e salvar edição/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(saveProtocol).not.toHaveBeenCalled();
  });

  it('exibe falha segura devolvida pelo servidor e libera nova tentativa', async () => {
    saveProtocol.mockRejectedValue(new Error('Falha transitória segura.'));
    render(
      <ProtocolEditor
        protocolId={PROTOCOL_ID}
        content={protocolContent}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/motivo da edição/i), 'Revisão profissional');
    await userEvent.click(screen.getByRole('button', { name: /validar e salvar edição/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha transitória segura.');
    expect(screen.getByRole('button', { name: /validar e salvar edição/i })).toBeEnabled();
  });
});
