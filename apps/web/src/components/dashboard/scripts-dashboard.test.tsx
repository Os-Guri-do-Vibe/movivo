import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlCenterScript, ControlCenterScriptsResponse } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { controlCenterMeta } from '../../../test/control-center-fixtures';

const { getSystemScripts, runSystemScript } = vi.hoisted(() => ({
  getSystemScripts: vi.fn(),
  runSystemScript: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getSystemScripts,
  runSystemScript,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { ScriptsDashboard } from './scripts-dashboard';

function script(overrides: Partial<ControlCenterScript>): ControlCenterScript {
  return {
    id: 'workout-daily-scan',
    name: 'Link diário de treino',
    description: 'Envia por WhatsApp o link do treino do dia.',
    kind: 'CRON',
    schedule: 'Todo dia às 04:00 (fuso de cada aluno)',
    runEffect: 'Envia agora o link de treino de hoje aos alunos elegíveis.',
    runnable: true,
    command: null,
    notRunnableReason: null,
    lastRun: null,
    ...overrides,
  };
}

function response(scripts: ControlCenterScript[]): ControlCenterScriptsResponse {
  return { data: { scripts }, meta: controlCenterMeta };
}

const CRON = script({});
const TERMINAL = script({
  id: 'reset-staff-mfa',
  name: 'Zerar MFA de conta interna',
  description: 'Remove o segundo fator de uma conta interna.',
  kind: 'TERMINAL',
  schedule: null,
  runEffect: null,
  runnable: false,
  command: 'node dist/scripts/reset-staff-mfa.js <email>',
  notRunnableReason: 'Recuperação de acesso: por desenho, não existe caminho pela interface.',
});

beforeEach(() => {
  getSystemScripts.mockReset();
  runSystemScript.mockReset();
  vi.useRealTimers();
});

describe('ScriptsDashboard', () => {
  it('lista nome, descrição, agendamento e um botão de seta por script', async () => {
    getSystemScripts.mockResolvedValue(response([CRON, TERMINAL]));
    render(<ScriptsDashboard />);

    expect(await screen.findByRole('heading', { name: 'Link diário de treino' })).toBeVisible();
    expect(screen.getByText('Envia por WhatsApp o link do treino do dia.')).toBeVisible();
    expect(screen.getByText('Todo dia às 04:00 (fuso de cada aluno)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Executar Link diário de treino' })).toBeEnabled();
  });

  it('script de terminal aparece com o comando e o botão desabilitado', async () => {
    getSystemScripts.mockResolvedValue(response([CRON, TERMINAL]));
    render(<ScriptsDashboard />);

    expect(await screen.findByText('node dist/scripts/reset-staff-mfa.js <email>')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Executar Zerar MFA de conta interna' }),
    ).toBeDisabled();
    expect(screen.getByText(/não existe caminho pela interface/)).toBeVisible();
  });

  it('só executa depois da confirmação, avisa que o agendamento não muda e atualiza a lista', async () => {
    const user = userEvent.setup();
    getSystemScripts.mockResolvedValueOnce(response([CRON])).mockResolvedValue(
      response([
        script({
          lastRun: {
            state: 'COMPLETED',
            at: '2026-10-12T21:00:00.000Z',
            summary: '10 elegíveis · 4 enviados',
          },
        }),
      ]),
    );
    runSystemScript.mockResolvedValue({
      data: {
        id: 'workout-daily-scan',
        status: 'ENQUEUED',
        message: 'Execução enfileirada (job-1).',
      },
      meta: controlCenterMeta,
    });
    render(<ScriptsDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Executar Link diário de treino' }));
    expect(runSystemScript).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { hidden: true });
    expect(within(dialog).getByText(/O agendamento padrão não é alterado/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Executar agora' }));

    expect(runSystemScript).toHaveBeenCalledWith('workout-daily-scan');
    expect(await screen.findByText('Execução enfileirada (job-1).')).toBeVisible();
    expect(await screen.findByText('10 elegíveis · 4 enviados')).toBeVisible();
    expect(screen.getByText('Concluído')).toBeVisible();
  });

  it('desabilita o botão e faz polling enquanto a execução manual está em andamento', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = response([
      script({ lastRun: { state: 'RUNNING', at: '2026-10-12T21:00:00.000Z', summary: null } }),
    ]);
    const done = response([
      script({
        lastRun: { state: 'COMPLETED', at: '2026-10-12T21:00:05.000Z', summary: '1 elegíveis' },
      }),
    ]);
    getSystemScripts.mockResolvedValueOnce(running).mockResolvedValue(done);
    render(<ScriptsDashboard />);

    expect(await screen.findByText('Executando')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Executar Link diário de treino' })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(await screen.findByText('Concluído')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Executar Link diário de treino' })).toBeEnabled();
  });

  it('mostra o erro do backend dentro da confirmação (ex.: já em execução)', async () => {
    const user = userEvent.setup();
    getSystemScripts.mockResolvedValue(response([CRON]));
    runSystemScript.mockRejectedValue(
      new Error('Este script já está em execução. Aguarde terminar.'),
    );
    render(<ScriptsDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Executar Link diário de treino' }));
    const dialog = await screen.findByRole('dialog', { hidden: true });
    await user.click(within(dialog).getByRole('button', { name: 'Executar agora' }));

    expect(await within(dialog).findByText(/já está em execução/)).toBeInTheDocument();
  });

  it('sem acesso: mostra o estado de setor fora do papel', async () => {
    getSystemScripts.mockRejectedValue(
      new ControlCenterApiError(403, 'Seu papel não pode acessar este setor.'),
    );
    render(<ScriptsDashboard />);
    expect(await screen.findByText('Este setor não faz parte do seu acesso')).toBeVisible();
  });
});
