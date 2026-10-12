import { render, screen, within } from '@testing-library/react';
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
    expect(screen.getByText('+55 (11) 99999-0001')).toBeVisible();
    expect(screen.getByText('Hipertrofia')).toBeVisible();
    expect(screen.getByText('Seg, Qua')).toBeVisible();
    expect(screen.getByText('Semana 3 de 8')).toBeVisible();
    expect(screen.getByText('01/08/2026, 09:00')).toBeVisible();
    expect(screen.getByText('Sem pendência')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Editar protocolo' })).toHaveAttribute(
      'href',
      `/dashboard/fila/protocol/${studentDetailResponse.data.student.currentProtocol?.id}`,
    );
  });

  it('mostra o rótulo em português e nunca o código gravado no banco', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    const { container } = render(<StudentDetail id={studentId} />);
    await screen.findByRole('heading', { name: 'Ana Souza' });

    const registration = screen.getByRole('region', { name: 'Cadastro e plano' });
    expect(within(registration).getByText('Em teste')).toBeVisible();

    const strip = screen.getByRole('list', { name: 'Situação do aluno' });
    expect(within(strip).getByText('Ativo')).toBeVisible();
    expect(within(strip).getByText('Em teste')).toBeVisible();
    expect(within(strip).getByText('Vigente')).toBeVisible();

    const forms = screen.getByRole('region', { name: 'Formulários e segurança' });
    expect(within(forms).getByText('Enviada')).toBeVisible();
    expect(within(forms).getByText('Liberado')).toBeVisible();

    const routine = screen.getByRole('region', { name: 'Rotina informada' });
    expect(within(routine).getByText('Treino regularmente')).toBeVisible();
    expect(within(routine).getByText('Intermediário')).toBeVisible();
    expect(within(routine).getByText('4 dias por semana')).toBeVisible();
    expect(within(routine).getByText('Academia completa')).toBeVisible();
    expect(within(routine).getByText('Manhã')).toBeVisible();

    const evolution = screen.getByRole('region', { name: 'Adesão declarada' });
    expect(within(evolution).getByText('Extremamente feliz')).toBeVisible();
    expect(within(evolution).getByText('Ótima')).toBeVisible();

    expect(container.textContent).not.toMatch(
      /SUBMITTED|TRIALING|MONTHLY|GAIN_MUSCLE|FULL_GYM|MUITO_FELIZ|OTIMA|LIBERADO|VALIDATOR_FLAG/,
    );
  });

  it('monta a frase da linha do tempo a partir do código e dos parâmetros', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    const timeline = await screen.findByRole('region', { name: 'Linha do tempo do aluno' });
    expect(within(timeline).getByText('Assinatura mensal criada')).toBeVisible();
    expect(within(timeline).getByText('Atendimento humano aberto (alerta)')).toBeVisible();
    expect(within(timeline).getByText('Sinalizado pela validação de segurança')).toBeVisible();
    expect(
      within(timeline).getByText(/Sono: ótima · Humor: extremamente feliz · Alimentação: 9\/10/),
    ).toBeVisible();
  });

  it('recolhe a linha do tempo longa e deixa expandir', async () => {
    const { timeline } = studentDetailResponse.data.student;
    const base = timeline[0];
    if (!base) throw new Error('fixture sem timeline');
    const long = Array.from({ length: 12 }, (_, index) => ({
      ...base,
      at: `2026-08-${String(20 - index).padStart(2, '0')}T12:00:00.000Z`,
    }));
    getStudent.mockResolvedValue({
      data: { student: { ...studentDetailResponse.data.student, timeline: long } },
      meta: studentDetailResponse.meta,
    });
    render(<StudentDetail id={studentId} />);
    const region = await screen.findByRole('region', { name: 'Linha do tempo do aluno' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(8);
    const toggle = within(region).getByRole('button', { name: 'Mostrar mais 4' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(within(region).getAllByRole('listitem')).toHaveLength(12);
    expect(within(region).getByRole('button', { name: 'Mostrar menos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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
    const { health } = studentDetailResponse.data.student;
    if (!health) throw new Error('fixture sem dado de saúde');
    getStudent.mockResolvedValue({
      data: {
        student: {
          ...studentDetailResponse.data.student,
          requiresProfessionalReview: true,
          health: { ...health, parqState: 'BLOQUEADO_AGUARDANDO_CLEARANCE' },
        },
      },
      meta: studentDetailResponse.meta,
    });
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByText(/requer revisão de um profissional CREF/)).toBeVisible();
    expect(screen.getByText('Necessária')).toBeVisible();
    expect(screen.getByText('Bloqueado: aguarda CREF')).toBeVisible();
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
    const strip = screen.getByRole('list', { name: 'Situação do aluno' });
    expect(within(strip).getAllByText('Não informado')).toHaveLength(2);
    const registration = screen.getByRole('region', { name: 'Cadastro e plano' });
    expect(within(registration).getByText('Não informado')).toBeVisible();
    const forms = screen.getByRole('region', { name: 'Formulários e segurança' });
    expect(within(forms).getByText('Não informado')).toBeVisible();
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
    const region = await screen.findByRole('region', { name: 'Linha do tempo do aluno' });
    const items = within(region).getAllByRole('listitem');
    const rendered = items.map((item) => item.textContent ?? '');
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
    const times = items.map((item) => {
      const time = item.querySelector('time');
      if (!time) throw new Error('item da timeline sem <time>');
      return time.dateTime;
    });
    expect(times).toEqual([...times].sort().reverse());
  });

  it('rotula a adesão como declarada e nomeia a dependência do treino verificado', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={studentId} />);
    expect(await screen.findByRole('heading', { name: 'Adesão declarada' })).toBeVisible();
    expect(screen.getByText(/Declarado via check-in/)).toHaveTextContent('workout_completions');
    expect(screen.getByText('75%')).toBeVisible();
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
