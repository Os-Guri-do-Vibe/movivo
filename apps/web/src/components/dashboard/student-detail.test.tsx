import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { studentDetailResponse } from '../../../test/control-center-fixtures';

const { getStudent } = vi.hoisted(() => ({ getStudent: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/control-center-api')>()),
  getStudent,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { StudentDetail } from './student-detail';

const studentId = studentDetailResponse.data.student.id;

beforeEach(() => getStudent.mockReset());

describe('StudentDetail', () => {
  it('carrega o aluno pedido e mostra cadastro, rotina e protocolo vigente', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    expect(getStudent).toHaveBeenCalledWith(studentId, expect.any(AbortSignal));
    expect(screen.getByText('ana@teste.com')).toBeVisible();
    expect(screen.getByText('Hipertrofia')).toBeVisible();
    expect(screen.getByText('SEG, QUA')).toBeVisible();
    expect(screen.getByText('Semana 3 de 8')).toBeVisible();
    expect(screen.getByText('01/08/2026, 09:00')).toBeVisible();
    expect(screen.getByText('Sem pendência')).toBeVisible();
  });

  it('declara o histórico de treinos como indisponível, sem número fabricado', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByRole('heading', { name: 'Histórico de treinos' })).toBeVisible();
    expect(
      screen.getByText('A execução dos treinos ainda não é registrada pelo produto.'),
    ).toBeVisible();
    expect(screen.getByText('Indisponível')).toBeVisible();
  });

  it('destaca a exigência de revisão CREF quando o aluno está bloqueado', async () => {
    getStudent.mockResolvedValue({
      data: {
        student: {
          ...studentDetailResponse.data.student,
          requiresProfessionalReview: true,
          parqState: 'BLOCKED',
        },
      },
      meta: studentDetailResponse.meta,
    });
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByText(/requer revisão de um profissional CREF/)).toBeVisible();
    expect(screen.getByText('Necessária')).toBeVisible();
  });

  it('trata rotina, protocolo e nome ausentes como não informados', async () => {
    getStudent.mockResolvedValue({
      data: {
        student: {
          ...studentDetailResponse.data.student,
          name: null,
          email: null,
          subscriptionStatus: null,
          protocolStatus: null,
          anamnesisStatus: null,
          parqState: null,
          routine: null,
          currentProtocol: null,
        },
      },
      meta: studentDetailResponse.meta,
    });
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByText('Rotina ainda não preenchida.')).toBeVisible();
    expect(screen.getByText('Nenhum protocolo vigente.')).toBeVisible();
    expect(screen.getAllByText('Não informado').length).toBeGreaterThan(4);
  });

  it('mostra "Não assinado" quando o protocolo ainda não tem assinatura CREF', async () => {
    getStudent.mockResolvedValue({
      data: {
        student: {
          ...studentDetailResponse.data.student,
          currentProtocol: {
            ...studentDetailResponse.data.student.currentProtocol!,
            signedAt: null,
          },
        },
      },
      meta: studentDetailResponse.meta,
    });
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByText('Não assinado')).toBeVisible();
  });

  it('em 403 não oferece nova tentativa', async () => {
    getStudent.mockRejectedValueOnce(new ControlCenterApiError(403, 'Aluno fora do seu escopo.'));
    render(<StudentDetail id={studentId} />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('avisa a falha da atualização mantendo o dado anterior na tela', async () => {
    getStudent
      .mockResolvedValueOnce(studentDetailResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<StudentDetail id={studentId} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor indisponível.');
    expect(screen.getByText('Semana 3 de 8')).toBeVisible();
  });
});
