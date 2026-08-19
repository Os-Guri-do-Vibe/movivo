import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  anamnesisAnswers,
  CHECKIN_ID,
  checkinItem,
  HANDOFF_ID,
  handoffItem,
  PARQ_ID,
  parqItem,
  protocolDetail,
  PROTOCOL_ID,
} from '../../../test/dashboard-fixtures';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

const api = vi.hoisted(() => ({
  getQueueDetail: vi.fn(),
  getAnamnesisAnswers: vi.fn(),
  signProtocol: vi.fn(),
  releaseParq: vi.fn(),
  resolveHandoff: vi.fn(),
  saveProtocol: vi.fn(),
  captureDashboardEvent: vi.fn(),
}));
vi.mock('@/lib/dashboard-api', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  ...api,
}));

import { DashboardApiError } from '@/lib/dashboard-api';

import { QueueDetail } from './queue-detail';

const parqDetail = {
  item: parqItem,
  context: { goal: 'Condicionamento' },
  parq: { flags: ['Resposta de risco Q2'], state: 'BLOCKED_PENDING_CLEARANCE' },
};

const handoffDetail = {
  item: handoffItem,
  context: { reason: 'Relato anonimizado que exige revisão.' },
  handoff: { reason: 'Relato anonimizado', level: 'SAFETY', status: 'OPEN' },
  replay: protocolDetail.replay,
};

const checkinDetail = {
  item: checkinItem,
  context: { checkinEffort: 'Dor relatada' },
  handoff: { reason: checkinItem.summary, level: 'SAFETY', status: 'OPEN' },
};

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  navigation.replace.mockReset();
  api.signProtocol.mockResolvedValue({ status: 'SIGNED' });
  api.releaseParq.mockResolvedValue({ status: 'RELEASED' });
  api.resolveHandoff.mockResolvedValue({ status: 'RESOLVED' });
  api.getAnamnesisAnswers.mockResolvedValue(anamnesisAnswers);
});

describe('QueueDetail', () => {
  it('renderiza protocolo e exige confirmação para assinar', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('heading', { name: /Protocolo · versão 1/i })).toBeVisible();
    expect(screen.getByText('[PESSOA] relatou dificuldade.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Assinar protocolo' }));
    expect(api.signProtocol).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e assinar' }));
    await waitFor(() => expect(api.signProtocol).toHaveBeenCalledWith(PROTOCOL_ID));
    expect(await screen.findByRole('status')).toHaveTextContent('auditoria registrada');
  });

  // Achado 2026-08-19 (a pedido do fundador): "Contexto autorizado" só repetia a versão
  // (já no título) e um booleano sempre `true` — sem valor pro RT nesta tela.
  it('não mostra "Contexto autorizado" pra protocolo', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });
    expect(screen.queryByText('Contexto autorizado')).not.toBeInTheDocument();
  });

  it('mostra "Contexto autorizado" pras outras telas (ex.: PAR-Q)', async () => {
    api.getQueueDetail.mockResolvedValue(parqDetail);
    render(<QueueDetail kind="PARQ" id={PARQ_ID} />);
    expect(await screen.findByText('Contexto autorizado')).toBeVisible();
  });

  // Achado 2026-08-19 (a pedido do fundador): editar acontece DENTRO do próprio card
  // "Protocolo · versão N" — o mesmo componente vira formulário, sem trocar de layout.
  it('edita o protocolo dentro do próprio card e salva com o motivo de auditoria', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('heading', { name: /Protocolo · versão 1/i })).toBeVisible();
    expect(screen.getByText('Agachamento goblet')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));
    const nameInput = screen.getByLabelText('Nome');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Supino reto');
    await userEvent.type(screen.getByLabelText(/motivo da edição/i), 'Ajuste de exercício');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [expect.objectContaining({ name: 'Supino reto' })],
            }),
          ],
        }),
        'Ajuste de exercício',
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Edição validada no servidor');
    // Volta pro card de leitura, ainda dentro do mesmo componente.
    expect(screen.getByRole('button', { name: 'Editar Protocolo' })).toBeVisible();
  });

  it('cancela a edição do protocolo sem persistir mudanças', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    const nameInput = screen.getByLabelText('Nome');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Outro nome');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }));
    expect(screen.getByText('Agachamento goblet')).toBeVisible();
    expect(api.saveProtocol).not.toHaveBeenCalled();
  });

  it('exige motivo auditável antes de salvar a edição do protocolo', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('auditoria');
    expect(api.saveProtocol).not.toHaveBeenCalled();
  });

  // Achado 2026-08-18 (decisão do fundador): título da sessão vira
  // `DIA DA SEMANA | NOME DO TREINO | FASE` em vez de `dayLabel · focus` cru.
  it('título da sessão: dia da semana real | nome do treino | fase', async () => {
    const baseProtocol = protocolDetail.protocol;
    const baseSession = baseProtocol?.content.sessions[0];
    if (!baseProtocol || !baseSession) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          phase: 'HIPERTROFIA',
          sessions: [{ ...baseSession, weekday: 'TUE' }],
        },
      },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText('Terça | Membros inferiores | Hipertrofia')).toBeVisible();
  });

  it('sem weekday (protocolo antigo): cai pro dayLabel cru, sem quebrar', async () => {
    const session = protocolDetail.protocol?.content.sessions[0]; // fixture não tem weekday
    if (!session) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(
      await screen.findByText(`${session.dayLabel} | ${session.focus} | Hipertrofia`),
    ).toBeVisible();
  });

  it('libera PAR-Q somente após a decisão humana confirmada', async () => {
    api.getQueueDetail.mockResolvedValue(parqDetail);
    render(<QueueDetail kind="PARQ" id={PARQ_ID} />);
    expect(await screen.findByText('Resposta de risco Q2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Registrar liberação' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/registro profissional/i), 'Revisão concluída.');
    expect(screen.getByRole('button', { name: 'Registrar liberação' })).toBeDisabled();
    await userEvent.selectOptions(
      screen.getByLabelText('Decisão'),
      'Liberar após revisão profissional',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Registrar liberação' }));
    expect(api.releaseParq).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar liberação' }));
    await waitFor(() =>
      expect(api.releaseParq).toHaveBeenCalledWith(PARQ_ID, 'Revisão concluída.'),
    );
  });

  it('registra a resolução de handoff SAFETY com confirmação', async () => {
    api.getQueueDetail.mockResolvedValue(handoffDetail);
    render(<QueueDetail kind="HANDOFF" id={HANDOFF_ID} />);
    expect(await screen.findByText('SEGURANÇA · PRIORIDADE')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Marcar como resolvido' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Observações'), 'Registro profissional.');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como resolvido' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));
    await waitFor(() =>
      expect(api.resolveHandoff).toHaveBeenCalledWith(
        HANDOFF_ID,
        'Contato realizado e orientação registrada.',
        'Registro profissional.',
      ),
    );
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard/educacao-fisica');
  });

  it('resolve sinalização de CHECKIN SAFETY pelo endpoint de handoff e atualiza a fila', async () => {
    api.getQueueDetail.mockResolvedValue(checkinDetail);
    render(<QueueDetail kind="CHECKIN" id={CHECKIN_ID} />);
    expect(await screen.findByText('SEGURANÇA · PRIORIDADE')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Resolver sinalização de check-in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resolver sinalização' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Observações'), 'Revisão profissional registrada.');
    await userEvent.click(screen.getByRole('button', { name: 'Resolver sinalização' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar resolução' }));
    await waitFor(() =>
      expect(api.resolveHandoff).toHaveBeenCalledWith(
        CHECKIN_ID,
        'Contato realizado e orientação registrada.',
        'Revisão profissional registrada.',
      ),
    );
    expect(navigation.replace).toHaveBeenCalledWith('/dashboard/educacao-fisica');
  });

  it('oferece recuperação quando o detalhe falha', async () => {
    api.getQueueDetail
      .mockRejectedValueOnce(new Error('Caso indisponível'))
      .mockResolvedValueOnce(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Caso indisponível');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByRole('heading', { name: 'Protocolo para Revisão' })).toBeVisible();
  });

  // Achado 2026-08-19 (a pedido do fundador): card do topo vira o perfil estruturado do
  // aluno, cruzando o protocolo (fase/duração) com a anamnese (idade/peso/altura/PAR-Q).
  it('mostra o card "Protocolo para Revisão" com o perfil do aluno', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('heading', { name: 'Protocolo para Revisão' })).toBeVisible();
    expect(await screen.findByText('Rodrigo de Barros')).toBeVisible();
    expect(screen.getByText(/36 anos/)).toBeVisible();
    expect(screen.getByText(/80kg/)).toBeVisible();
    expect(screen.getByText(/178 cm/)).toBeVisible();
    expect(screen.getByText(/Masculino/)).toBeVisible();
    expect(screen.getByText(/3x por semana \| Segunda, Quarta, Sexta/)).toBeVisible();
    expect(screen.getByText('Nenhum fator de risco identificado.')).toBeVisible();
    // Objetivo (GAIN_MUSCLE) e Mesociclo (fase HIPERTROFIA) coincidem no rótulo nesta
    // fixture — as duas linhas do card aparecem, cada uma com seu "Hipertrofia".
    expect(screen.getAllByText('Hipertrofia')).toHaveLength(2);
  });

  it('edita todos os campos do protocolo (sessão, exercício e observações gerais) e salva', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });

    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));

    const phaseSelect = screen.getAllByRole('combobox')[0];
    if (!phaseSelect) throw new Error('select de fase não encontrado');
    await userEvent.selectOptions(phaseSelect, 'FORCA');

    const weeklyFrequency = screen.getByRole('spinbutton', { name: /Frequência semanal/i });
    await userEvent.clear(weeklyFrequency);
    await userEvent.type(weeklyFrequency, '4');

    // Os inputs de dayLabel/foco fazem `preventDefault` no click (pra não abrir/fechar o
    // <details>), o que também bloqueia a seleção usada por `userEvent.clear`/`type` —
    // por isso o valor é setado direto via `fireEvent.change`.
    fireEvent.change(screen.getByLabelText('Identificação do dia — sessão 1'), {
      target: { value: 'Treino Z' },
    });
    fireEvent.change(screen.getByLabelText('Foco — sessão 1'), {
      target: { value: 'Posterior de coxa' },
    });

    const nameInput = screen.getByLabelText('Nome');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Supino reto');
    const notes = screen.getByLabelText('Observação');
    await userEvent.clear(notes);
    await userEvent.type(notes, 'Cuidado com a lombar');

    const sets = screen.getByLabelText('Séries');
    await userEvent.clear(sets);
    await userEvent.type(sets, '5');
    const repsMin = screen.getByLabelText('Repetições mín.');
    await userEvent.clear(repsMin);
    await userEvent.type(repsMin, '6');
    const repsMax = screen.getByLabelText('Repetições máx.');
    await userEvent.clear(repsMax);
    await userEvent.type(repsMax, '9');
    const rest = screen.getByLabelText('Descanso (s)');
    await userEvent.clear(rest);
    await userEvent.type(rest, '120');

    const rir = screen.getByLabelText('Repetições em Reserva (RIR)');
    await userEvent.clear(rir);
    await userEvent.type(rir, '3');

    await userEvent.selectOptions(screen.getByLabelText('Estratégia de carga'), 'RPE');

    const videoUrl = screen.getByLabelText('Link de vídeo de execução');
    await userEvent.clear(videoUrl);
    await userEvent.type(videoUrl, 'https://example.com/supino');

    const generalNotes = screen.getByLabelText(/Observações gerais/i);
    await userEvent.clear(generalNotes);
    await userEvent.type(generalNotes, 'Nova observação geral');

    await userEvent.type(
      screen.getByLabelText(/motivo da edição/i),
      'Ajuste completo do protocolo',
    );
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          phase: 'FORCA',
          weeklyFrequency: 4,
          generalNotes: 'Nova observação geral',
          sessions: [
            expect.objectContaining({
              dayLabel: 'Treino Z',
              focus: 'Posterior de coxa',
              exercises: [
                expect.objectContaining({
                  name: 'Supino reto',
                  notes: 'Cuidado com a lombar',
                  sets: 5,
                  reps: { min: 6, max: 9 },
                  restSeconds: 120,
                  rir: 3,
                  loadStrategy: 'RPE',
                  videoUrl: 'https://example.com/supino',
                }),
              ],
            }),
          ],
        }),
        'Ajuste completo do protocolo',
      ),
    );
  });

  it('exercício por duração: exibe/edita "Duração (s)" em vez de repetições, e "—" quando RIR/vídeo/notas ausentes', async () => {
    const baseProtocol = protocolDetail.protocol;
    if (!baseProtocol) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          sessions: [
            {
              dayLabel: 'Treino B',
              focus: 'Cardio',
              exercises: [
                {
                  exerciseId: 'plank',
                  name: 'Prancha',
                  sets: 3,
                  durationSeconds: 45,
                  loadStrategy: 'BODYWEIGHT',
                  restSeconds: 60,
                },
              ],
            },
          ],
        },
      },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });

    expect(screen.getByText('45s')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Assistir' })).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('—')).toHaveLength(2); // RIR e vídeo ausentes

    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));
    expect(screen.queryByLabelText('Repetições mín.')).not.toBeInTheDocument();
    const duration = screen.getByLabelText('Duração (s)');
    await userEvent.clear(duration);
    await userEvent.type(duration, '90');

    await userEvent.type(screen.getByLabelText(/motivo da edição/i), 'Ajuste de duração');
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [expect.objectContaining({ durationSeconds: 90 })],
            }),
          ],
        }),
        'Ajuste de duração',
      ),
    );
  });

  it('bloqueia salvar quando a edição deixa o protocolo inválido, mostrando as mensagens do schema', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.clear(screen.getByRole('spinbutton', { name: /Frequência semanal/i }));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('precisa de revisão');
    expect(api.saveProtocol).not.toHaveBeenCalled();
  });

  it('mostra as mensagens de erro do servidor ao salvar em cada formato possível', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.type(screen.getByLabelText(/motivo da edição/i), 'Motivo válido');

    const arrayError = new DashboardApiError(502, 'mensagem', ['Erro de validação 1']);
    api.saveProtocol.mockRejectedValueOnce(arrayError);
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro de validação 1');

    const issuesError = new DashboardApiError(502, 'mensagem', { issues: ['Campo obrigatório'] });
    api.saveProtocol.mockRejectedValueOnce(issuesError);
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Campo obrigatório');

    api.saveProtocol.mockRejectedValueOnce(new Error('Falha de rede'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede');

    api.saveProtocol.mockRejectedValueOnce('erro-desconhecido');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível salvar o protocolo.',
    );
  });

  it('"Contexto autorizado": mostra aviso vazio quando não há entradas, e trata chave desconhecida e valor nulo', async () => {
    api.getQueueDetail.mockResolvedValueOnce({ ...handoffDetail, context: {} });
    const { unmount } = render(<QueueDetail kind="HANDOFF" id={HANDOFF_ID} />);
    expect(await screen.findByText('Nenhum contexto adicional foi disponibilizado.')).toBeVisible();
    unmount();

    api.getQueueDetail.mockResolvedValueOnce({
      ...checkinDetail,
      context: { unknownField: 'valor', nullField: null },
    });
    render(<QueueDetail kind="CHECKIN" id={CHECKIN_ID} />);
    expect(await screen.findByText('unknown Field')).toBeVisible();
    expect(screen.getByText('Não informado')).toBeVisible();
  });

  it('protocolo assinado mostra o hash e a data (ou "data não informada" quando ausente)', async () => {
    const baseProtocol = protocolDetail.protocol;
    if (!baseProtocol) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValueOnce({
      ...protocolDetail,
      protocol: { ...baseProtocol, signatureHash: 'abc123', signedAt: '2026-08-10T10:00:00.000Z' },
    });
    const { unmount } = render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText(/hash/)).toHaveTextContent('abc123');
    expect(
      screen.queryByRole('heading', { name: 'Assinatura profissional' }),
    ).not.toBeInTheDocument();
    unmount();

    api.getQueueDetail.mockResolvedValueOnce({
      ...protocolDetail,
      protocol: { ...baseProtocol, signatureHash: 'def456', signedAt: null },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText(/data não informada/)).toBeVisible();
  });

  it('rótulos desconhecidos de fase/dia caem pro valor cru, sem quebrar a tela', async () => {
    const baseProtocol = protocolDetail.protocol;
    const baseSession = baseProtocol?.content.sessions[0];
    if (!baseProtocol || !baseSession) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          phase: 'DESCONHECIDA' as never,
          sessions: [{ ...baseSession, weekday: 'XXX' as never }],
        },
      },
    });
    api.getAnamnesisAnswers.mockResolvedValue({
      ...anamnesisAnswers,
      routine: { ...anamnesisAnswers.routine, preferredDays: ['ZZZ'] },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText('XXX | Membros inferiores | DESCONHECIDA')).toBeVisible();
    expect(await screen.findByText(/ZZZ/)).toBeVisible();
    expect(screen.getAllByText(/DESCONHECIDA/).length).toBeGreaterThan(0);
  });
});
