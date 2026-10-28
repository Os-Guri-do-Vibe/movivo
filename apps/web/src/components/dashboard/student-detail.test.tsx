import { render, screen, within } from '@testing-library/react';
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

const ID = studentDetailResponse.data.student.id;

beforeEach(() => getStudent.mockReset());

function withStudent(patch: Record<string, unknown>) {
  return {
    ...studentDetailResponse,
    data: { student: { ...studentDetailResponse.data.student, ...patch } },
  };
}

describe('StudentDetail — ficha do Estado do Aluno', () => {
  it('mostra quem é, plano, adesão, saúde e a linha do tempo do mais recente ao mais antigo', async () => {
    getStudent.mockResolvedValue(studentDetailResponse);
    render(<StudentDetail id={ID} />);

    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    expect(screen.getByText('ana@teste.com')).toBeVisible();
    expect(screen.getByText('Hipertrofia com consistência')).toBeVisible();
    expect(screen.getByRole('link', { name: /Voltar para a base de alunos/ })).toHaveAttribute(
      'href',
      '/dashboard/alunos',
    );
    // Sinal de risco vem nomeado: número sozinho não gera ação.
    expect(screen.getByText('Check-in enviado há 4 dias e ainda sem resposta')).toBeVisible();

    const labels = [
      'Anamnese enviada',
      'Plano de treino v2 publicado',
      'Assinatura mensal criada',
      '12 mensagens trocadas no dia',
      'Check-in respondido',
      'Caso aberto na fila de exceções',
    ];
    for (const label of labels) expect(screen.getByText(label)).toBeVisible();
    const history = screen.getByText('Do mais recente para o mais antigo.').closest('section');
    const order = within(history as HTMLElement)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
    expect(order.findIndex((t) => t.includes('Caso aberto'))).toBeLessThan(
      order.findIndex((t) => t.includes('Anamnese enviada')),
    );
  });

  it('sem plano nem estratégia diz que ainda não foi definido, nunca "undefined"', async () => {
    getStudent.mockResolvedValue(
      withStudent({
        plan: { training: null, nutrition: null, strategy: null, goal: null },
        timeline: [],
        exceptions: [],
        decisions: [],
        executions: [],
      }),
    );
    const { container } = render(<StudentDetail id={ID} />);
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByText('Ainda não definida')).toBeVisible();
    expect(container.textContent).not.toContain('undefined');
  });

  it('sem permissão ou com erro mostra o estado do recurso, não a ficha', async () => {
    getStudent.mockRejectedValueOnce(new ControlCenterApiError(403, 'Sem acesso aos alunos.'));
    render(<StudentDetail id={ID} />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ana Souza' })).not.toBeInTheDocument();
  });
});
