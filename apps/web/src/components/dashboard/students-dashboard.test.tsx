import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { studentsResponse } from '../../../test/control-center-fixtures';

const { getStudents } = vi.hoisted(() => ({ getStudents: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getStudents,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { StudentsDashboard } from './students-dashboard';

beforeEach(() => getStudents.mockReset());

describe('StudentsDashboard', () => {
  it('lista os alunos do escopo e rotula ausência de dado em vez de deixar vazio', async () => {
    const [firstStudent] = studentsResponse.data.students;
    if (!firstStudent) throw new Error('fixture sem alunos');
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard canReadHealth />);
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Nome não informado' })).toBeVisible();
    expect(screen.getAllByText('Não informado')).toHaveLength(2);
    expect(screen.getByText('+5511999990002')).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Abrir ficha do aluno' })[0]).toHaveAttribute(
      'href',
      `/dashboard/alunos/${firstStudent.id}`,
    );
  });

  it('sem `canReadHealth` (recorte de suporte) a ficha continua acessível, sem promessa de saúde', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Abrir ficha do aluno' })).toHaveLength(2);
    expect(screen.getByText(/Dados de saúde não fazem parte deste acesso/)).toBeVisible();
  });

  it('nomeia os sinais de risco de cancelamento em vez de mostrar só um número', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    expect(await screen.findByText('Risco de cancelamento: 2 de 3 sinais')).toBeVisible();
    expect(screen.getByText('Sem mensagem do aluno há 9 dias')).toBeVisible();
    expect(screen.getByText('Trial ou período pago termina em 2 dias')).toBeVisible();
    expect(screen.getByText('Sem sinal de risco de cancelamento no momento.')).toBeVisible();
  });

  it('filtra a lista pela busca e explica quando nada corresponde', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const search = await screen.findByRole('searchbox');

    await userEvent.type(search, 'ana@');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeVisible();

    await userEvent.clear(search);
    await userEvent.type(search, 'ninguém');
    expect(await screen.findByRole('heading', { name: 'Nenhum aluno encontrado' })).toBeVisible();
    expect(screen.getByText('Ajuste a busca para ver outros resultados.')).toBeVisible();
  });

  it('busca também por status, ignorando caixa', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await userEvent.type(await screen.findByRole('searchbox'), 'pending');
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Nome não informado' })).toBeVisible();
  });

  it('mostra o vazio de escopo quando não há aluno atribuído', async () => {
    getStudents.mockResolvedValue({
      ...studentsResponse,
      data: { ...studentsResponse.data, students: [] },
    });
    render(<StudentsDashboard />);
    expect(await screen.findByRole('heading', { name: 'Nenhum aluno neste escopo' })).toBeVisible();
  });

  it('em 403 não oferece nova tentativa', async () => {
    getStudents.mockRejectedValueOnce(new ControlCenterApiError(403, 'Sem acesso aos alunos.'));
    render(<StudentsDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('preserva a última lista concluída quando a atualização falha', async () => {
    getStudents
      .mockResolvedValueOnce(studentsResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<StudentsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Os dados abaixo são da última atualização concluída.',
    );
    expect(screen.getByRole('heading', { name: 'Ana Souza' })).toBeVisible();
  });
});
