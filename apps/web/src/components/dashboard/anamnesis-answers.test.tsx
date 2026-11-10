import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnamnesisAnswersView } from '@movivo/shared';

import * as ControlCenterApi from '@/lib/control-center-api';

const { getExceptionAnamnesis } = vi.hoisted(() => ({ getExceptionAnamnesis: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExceptionAnamnesis,
}));

import { AnamnesisAnswersButton, AnamnesisAnswersContent } from './anamnesis-answers';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const VIEW: AnamnesisAnswersView = {
  studentName: 'Ana Souza',
  submittedAt: '2026-11-01T12:00:00.000Z',
  flow: 'COMPLEMENTARY',
  steps: [
    {
      step: 2,
      title: 'Objetivos',
      data: {
        goal: {
          primary: 'FAT_LOSS',
          secondary: ['HYPERTROPHY', 'BODY_DEFINITION', 'RUNNING_PERFORMANCE'],
          emphasis: 'AESTHETICS',
        },
      },
    },
    {
      step: 4,
      title: 'Sua semana',
      data: {
        externalSports: [
          {
            sport: 'SWIMMING',
            label: 'Natação',
            sessionsPerWeek: 2,
            minutesPerSession: 60,
            typicalRpe: 5,
            fixedDays: ['TUE'],
          },
        ],
        windows: [{ weekday: 'MON', slot: 'EVENING', maxMinutes: 45 }],
        variesWeekly: false,
        lifeContext: {},
      },
    },
    {
      step: 5,
      title: 'Preferências de treino e saúde geral',
      data: { medications: 'Losartana', preferences: { priority: 'BALANCED' } },
    },
    {
      step: 6,
      title: 'Dores e limitações',
      data: {
        pain: {
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 4 }],
          trend: 'STABLE',
          hasProfessionalExplanation: false,
          underMedicalFollowUp: false,
          hasAvoidanceRecommendation: false,
        },
      },
    },
    {
      step: 9,
      title: 'PAR-Q',
      data: {
        parq: {
          version: 'parq-2026-07-v1',
          answers: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map((questionId) => ({
            questionId,
            answer: questionId === 'Q4',
            ...(questionId === 'Q4' ? { detail: 'Desmaiei uma vez em jejum' } : {}),
          })),
        },
        declarationsVersion: 'parq-declaracoes-2026-08-v1',
        declarations: ['TRUTHFUL', 'WILL_REPORT_CHANGES', 'MAY_REQUIRE_REVIEW'],
      },
    },
  ],
};

beforeEach(() => getExceptionAnamnesis.mockReset());

describe('AnamnesisAnswersButton', () => {
  it('só busca ao abrir, mostra tudo em PT-BR e devolve o foco ao fechar com Esc', async () => {
    getExceptionAnamnesis.mockResolvedValue(VIEW);
    render(<AnamnesisAnswersButton caseId={CASE_ID} />);
    expect(getExceptionAnamnesis).not.toHaveBeenCalled();

    const trigger = screen.getByRole('button', { name: /Ver anamnese/ });
    await userEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: /Ana Souza/ });
    expect(getExceptionAnamnesis).toHaveBeenCalledWith(CASE_ID, expect.anything());
    expect(await within(dialog).findByText('Emagrecimento')).toBeVisible();
    expect(within(dialog).getByText('Hipertrofia')).toBeVisible();
    expect(within(dialog).getByText('Estética e composição corporal')).toBeVisible();
    expect(
      within(dialog).getByText(/Anamnese complementar · Enviada em 01\/11\/2026/),
    ).toBeVisible();
    expect(within(dialog).getByText(/a leitura fica registrada na auditoria/)).toBeVisible();
    // Nenhum código técnico na tela.
    expect(dialog.textContent).not.toMatch(/FAT_LOSS|HYPERTROPHY|AESTHETICS|secondary|emphasis/);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('a variante da Fila é o olho, com o mesmo nome acessível', async () => {
    getExceptionAnamnesis.mockResolvedValue(VIEW);
    render(<AnamnesisAnswersButton caseId={CASE_ID} variant="icon" />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver anamnese' }));
    expect(await screen.findByRole('dialog', { name: /Ana Souza/ })).toBeInTheDocument();
  });

  it('mostra o esqueleto ao carregar e, no erro, tenta de novo', async () => {
    let fail: (reason: Error) => void = () => undefined;
    getExceptionAnamnesis.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    render(<AnamnesisAnswersButton caseId={CASE_ID} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver anamnese/ }));
    expect(await screen.findByRole('status', { name: 'Carregando a anamnese' })).toBeVisible();

    fail(new Error('Falha de rede.'));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Não foi possível carregar a anamnese')).toBeVisible();

    getExceptionAnamnesis.mockResolvedValueOnce(VIEW);
    await userEvent.click(within(alert).getByRole('button', { name: /Tentar novamente/ }));
    expect(await screen.findByText('Emagrecimento')).toBeVisible();
    expect(getExceptionAnamnesis).toHaveBeenCalledTimes(2);
  });

  it('sem anamnese enviada (404) é um estado vazio, não um erro', async () => {
    getExceptionAnamnesis.mockRejectedValueOnce(
      new ControlCenterApi.ControlCenterApiError(404, 'O aluno não tem anamnese enviada.'),
    );
    render(<AnamnesisAnswersButton caseId={CASE_ID} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver anamnese/ }));
    expect(await screen.findByText('Sem anamnese enviada')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sem permissão de saúde, explica e não oferece tentar de novo', async () => {
    getExceptionAnamnesis.mockRejectedValueOnce(
      new ControlCenterApi.ControlCenterApiError(403, 'Sem permissão.'),
    );
    render(<AnamnesisAnswersButton caseId={CASE_ID} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver anamnese/ }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('A anamnese não faz parte do seu acesso')).toBeVisible();
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('AnamnesisAnswersContent', () => {
  it('agrupa nas etapas do formulário, com atalhos e o título de cada etapa', () => {
    render(<AnamnesisAnswersContent view={VIEW} />);
    const nav = screen.getByRole('navigation', { name: 'Etapas da anamnese' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      '02Objetivos',
      '03Seu treino com a MOVIVO(sem respostas)',
      '04Sua semana',
      '05Preferências de treino e saúde geral',
      '06Dores e limitações',
      '07Alimentação(sem respostas)',
      '08Corpo(sem respostas)',
      '09PAR-Q',
    ]);
    const week = screen.getByRole('region', { name: 'Sua semana' });
    expect(within(week).getByText('Natação')).toBeVisible();
    expect(within(week).getByText('Terça-feira')).toBeVisible();
    expect(within(week).getByText('1 h')).toBeVisible();
    expect(within(week).getByText('Noite')).toBeVisible();
    expect(within(week).getByText('Cerca de 45 minutos')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Corpo' })).getByText(
        'Etapa opcional: o aluno não registrou medidas.',
      ),
    ).toBeVisible();
  });

  it('põe o PAR-Q de risco e a saúde no topo e marca as etapas sensíveis', async () => {
    render(<AnamnesisAnswersContent view={VIEW} />);
    const attention = screen.getByRole('region', { name: 'Pontos de atenção' });
    expect(within(attention).getByText('PAR-Q com 1 resposta “Sim”')).toBeVisible();
    expect(within(attention).getByText('PAR-Q: tontura/desmaio')).toBeVisible();
    expect(within(attention).getByText('Medicamento em uso')).toBeVisible();
    expect(within(attention).getByText(/Joelho 4 de 10/)).toBeVisible();

    const parq = screen.getByRole('region', { name: 'PAR-Q' });
    expect(within(parq).getByText('Dado de saúde')).toBeVisible();
    expect(within(parq).getByText('Desmaiei uma vez em jejum')).toBeVisible();
    expect(within(parq).getByText('Aceitou as 3 declarações')).toBeVisible();

    // O atalho leva o foco ao título da etapa.
    await userEvent.click(within(attention).getByRole('button', { name: /tontura/ }));
    expect(within(parq).getByRole('heading', { name: 'PAR-Q' })).toHaveFocus();
  });

  it('esconde as perguntas opcionais em branco até o profissional pedir', async () => {
    render(<AnamnesisAnswersContent view={VIEW} />);
    const week = screen.getByRole('region', { name: 'Sua semana' });
    expect(within(week).queryByText('Horas de sono')).not.toBeInTheDocument();
    const toggle = within(week).getByRole('button', { name: 'Mostrar 2 perguntas sem resposta' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(week).getByText('Horas de sono')).toBeVisible();
    expect(within(week).getByText('Estresse no dia a dia')).toBeVisible();
  });
});
