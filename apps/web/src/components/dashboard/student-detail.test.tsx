import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { studentDetailResponse } from '../../../test/control-center-fixtures';

const { getStudent } = vi.hoisted(() => ({ getStudent: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
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
          health: { ...studentDetailResponse.data.student.health!, parqState: 'BLOCKED' },
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
          health: null,
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
    const { currentProtocol } = studentDetailResponse.data.student;
    if (!currentProtocol) throw new Error('fixture sem protocolo vigente');
    getStudent.mockResolvedValue({
      data: {
        student: {
          ...studentDetailResponse.data.student,
          currentProtocol: { ...currentProtocol, signedAt: null },
        },
      },
      meta: studentDetailResponse.meta,
    });
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByText('Não assinado')).toBeVisible();
  });

  it('mescla as 6 origens numa timeline única em ordem cronológica decrescente', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByRole('heading', { name: 'Linha do tempo do aluno' })).toBeVisible();
    const items = screen
      .getByRole('heading', { name: 'Linha do tempo do aluno' })
      .parentElement!.querySelectorAll('ol > li');
    const rendered = [...items].map((item) => item.textContent ?? '');
    expect(rendered).toHaveLength(studentDetailResponse.data.student.timeline.length);
    for (const kind of [
      'Anamnese',
      'Protocolo',
      'Check-in',
      'Conversa',
      'Assinatura',
      'Atendimento humano',
    ]) {
      expect(rendered.some((entry) => entry.includes(kind))).toBe(true);
    }
    const times = [...items].map((item) => item.querySelector('time')!.dateTime);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('rotula a adesão como declarada e nomeia a dependência do treino verificado', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByRole('heading', { name: 'Adesão declarada' })).toBeVisible();
    expect(screen.getByText(/Declarado via check-in/)).toHaveTextContent('workout_completions');
    expect(screen.getByText('75.0%')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Evolução declarada por semana' })).toBeVisible();
  });

  it('mostra o sinal de qualidade da IA com a ocorrência já anonimizada', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    expect(
      await screen.findByRole('heading', { name: 'Qualidade das respostas da IA' }),
    ).toBeVisible();
    expect(screen.getByText(/Resposta bloqueada para \[nome\]/)).toBeVisible();
  });

  it('sem a capacidade de saúde, a ficha existe e a seção de saúde não vem do servidor', async () => {
    const { health, ...student } = studentDetailResponse.data.student;
    expect(health).not.toBeNull();
    getStudent.mockResolvedValue({
      data: {
        student: { ...student, health: null, aiQuality: { ...student.aiQuality, occurrences: [] } },
      },
      meta: studentDetailResponse.meta,
    });
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    expect(screen.getByText(/Seu acesso não inclui informações de saúde/)).toBeVisible();
    expect(screen.queryByText('PAR-Q')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Relatos de desconforto' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Evolução declarada por semana' }),
    ).not.toBeInTheDocument();
  });

  it('nomeia o risco de cancelamento em termos comerciais, com os sinais que dispararam', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByRole('heading', { name: 'Risco de cancelamento' })).toBeVisible();
    expect(screen.getByText('Check-in enviado há 4 dias e ainda sem resposta')).toBeVisible();
  });

  /** Guardrail de linguagem (Sofia §13, inegociável): checagem literal na copy da tela. */
  it('não usa termo clínico nem promessa de resultado em nenhum ponto da tela', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    const { container } = render(<StudentDetail id={studentId} />);
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(container.textContent).not.toMatch(
      /diagn[óo]stic|tratamento|quadro cl[íi]nic|resultado garantido/i,
    );
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
