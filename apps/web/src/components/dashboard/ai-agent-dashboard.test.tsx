/**
 * Teste de integração da página "Agente" com os DOIS cartões de persona montados.
 *
 * Aqui os providers são os de verdade (só a camada de API é dublê): o que precisa de
 * prova neste arquivo é justamente a interação entre eles — rascunho que sobrevive a
 * fechar/abrir a edição do cartão, publicação que não vaza para o slot vizinho e escrita
 * que viaja com o slot certo. Com `useAgentPersona` mockado, nada disso seria observável.
 *
 * Achado 2026-09-04 (a pedido do fundador): os dois cartões ficam sempre visíveis, um
 * embaixo do outro — não há mais aba "Persona feminina/masculina" nem aba "Configuração".
 * O lápis de cada cartão abre o formulário daquele slot INLINE, no lugar do resumo do
 * próprio cartão — nunca modal (mesmo padrão do lápis de edição de Protocolo). Fechar a
 * edição nunca desmonta o `AgentPersonaProvider` (que continua montado o tempo todo),
 * então o rascunho sobrevive fechar-e-reabrir do mesmo jeito que antes sobrevivia trocar
 * de aba.
 */
import { DEFAULT_AGENT_PERSONA, type BiologicalSex } from '@movivo/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const api = vi.hoisted(() => ({
  getAgentPersona: vi.fn(),
  getAgentConfigHistory: vi.fn(),
  getForbiddenTopics: vi.fn(),
  getInviolableRules: vi.fn(),
  publishAgentPersona: vi.fn(),
  rollbackAgentPersona: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  ...api,
}));

import { AiAgentDashboard } from './ai-agent-dashboard';

const meta = {
  generatedAt: '2026-08-21T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const rules = {
  data: {
    blocks: [
      {
        id: 'INVIOLABLE_RULES',
        layer: 'L0' as const,
        title: 'Regras que a agente nunca quebra',
        editable: false,
        rationale: 'Proteção clínica, regulatória e de escopo.',
        content: 'Nunca diagnostica nem promete resultado.',
      },
    ],
  },
  meta,
};

/** Nomes carregados distintos por slot — só assim os dois botões "Editar {nome}" são únicos. */
const LOADED_NAME: Record<BiologicalSex, string> = { FEMALE: 'Mariana', MALE: 'Leonardo' };

function personaFor(targetSex: BiologicalSex) {
  return { ...DEFAULT_AGENT_PERSONA, agentName: LOADED_NAME[targetSex] };
}

/** Histórico do slot: a numeração é POR SLOT, então v1/v2 existem nos dois. */
function historyOf(targetSex: BiologicalSex) {
  return {
    data: {
      versions: [
        {
          targetSex,
          version: 2,
          status: 'PUBLISHED' as const,
          changeNote: 'tom mais direto',
          createdAt: '2026-08-20T12:00:00.000Z',
          createdBy: 'Rodrigo',
          current: true,
          payload: personaFor(targetSex),
        },
        {
          targetSex,
          version: 1,
          status: 'PUBLISHED' as const,
          changeNote: 'configuração inicial',
          createdAt: '2026-08-19T12:00:00.000Z',
          createdBy: 'Pedro',
          current: false,
          payload: { ...personaFor(targetSex), agentName: 'MOVITA' },
        },
      ],
    },
    meta,
  };
}

function personaOf(
  targetSex: BiologicalSex,
  options: { version?: number | null; servedFromSex?: BiologicalSex | null } = {},
) {
  const { version = 2, servedFromSex = targetSex } = options;
  return { data: { targetSex, persona: personaFor(targetSex), version, servedFromSex }, meta };
}

const topics = {
  data: {
    versions: [],
    activeLabels: [],
    limits: { maxActiveTopics: 12, maxPhrasesPerTopic: 20, maxPhraseLength: 300 },
  },
  meta,
};

const renderAgent = (props: { canWriteConfig?: boolean; canApproveGuardrails?: boolean } = {}) =>
  render(<AiAgentDashboard canWriteConfig={true} canApproveGuardrails={false} {...props} />);

/** Renderiza e espera os DOIS cartões terminarem de carregar (nome real, não mais "Agente"). */
async function renderReady(
  props: { canWriteConfig?: boolean; canApproveGuardrails?: boolean } = {},
) {
  const result = renderAgent(props);
  await screen.findByRole('heading', { name: LOADED_NAME.FEMALE });
  await screen.findByRole('heading', { name: LOADED_NAME.MALE });
  return result;
}

/** Abre a edição INLINE do cartão daquele slot e espera o formulário aparecer. */
async function openEditor(user: ReturnType<typeof userEvent.setup>, targetSex: BiologicalSex) {
  await user.click(screen.getByRole('button', { name: `Editar ${LOADED_NAME[targetSex]}` }));
  const heading = targetSex === 'FEMALE' ? 'Persona feminina' : 'Persona masculina';
  return within(await screen.findByRole('region', { name: new RegExp(heading, 'i') }));
}

/** Fecha a edição aberta no momento (o lápis vira X "Fechar edição"). */
const closeEditor = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Fechar edição' }));

/** Campo "Nome da agente" DENTRO do formulário aberto. */
const nameField = () => screen.getByRole('textbox', { name: 'Nome da agente' });

const goToStep = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('button', { name }));

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard/ia/agente');
  for (const mock of Object.values(api)) mock.mockReset();
  api.getAgentPersona.mockImplementation((targetSex: BiologicalSex) =>
    Promise.resolve(personaOf(targetSex)),
  );
  api.getAgentConfigHistory.mockImplementation((targetSex: BiologicalSex) =>
    Promise.resolve(historyOf(targetSex)),
  );
  api.getInviolableRules.mockResolvedValue(rules);
  api.getForbiddenTopics.mockResolvedValue(topics);
  api.publishAgentPersona.mockImplementation((input: { targetSex: BiologicalSex }) =>
    Promise.resolve(personaOf(input.targetSex, { version: 3 })),
  );
  api.rollbackAgentPersona.mockImplementation((input: { targetSex: BiologicalSex }) =>
    Promise.resolve(personaOf(input.targetSex, { version: 4 })),
  );
});

describe('AiAgentDashboard — layout', () => {
  it('mantém um único h1 e os dois cartões sempre visíveis, sem abas', async () => {
    await renderReady();
    expect(screen.getByRole('heading', { name: 'Agente', level: 1 })).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('a edição começa fechada (nunca modal) e o lápis abre o formulário do slot certo inline', async () => {
    const user = userEvent.setup();
    await renderReady();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Persona masculina' })).not.toBeInTheDocument();

    const editor = await openEditor(user, 'MALE');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(editor.getByRole('heading', { name: 'Persona masculina' })).toBeVisible();
  });
});

describe('AiAgentDashboard — dois slots de persona', () => {
  it('carrega os dois slots ao montar, cada um com o seu targetSex', async () => {
    await renderReady();

    expect(api.getAgentPersona).toHaveBeenCalledWith('FEMALE', expect.anything());
    expect(api.getAgentPersona).toHaveBeenCalledWith('MALE', expect.anything());
    expect(api.getAgentConfigHistory).toHaveBeenCalledWith('MALE', expect.anything());
    expect(api.getInviolableRules).toHaveBeenCalledWith('MALE', expect.anything());
    // Temas proibidos valem para os dois públicos: uma chamada só, no workspace.
    expect(api.getForbiddenTopics).toHaveBeenCalledOnce();
  });

  /*
   * O caso que motivou manter os dois `AgentPersonaProvider` montados o tempo todo: um
   * rascunho não publicado não pode desaparecer só porque a edição daquele cartão foi
   * fechada — quem guarda o estado é o provider, não o formulário em si.
   */
  it('mantém rascunhos independentes nos dois cartões, mesmo fechando e reabrindo a edição', async () => {
    const user = userEvent.setup();
    await renderReady();

    await openEditor(user, 'FEMALE');
    await user.clear(nameField());
    await user.type(nameField(), 'MOVITA');
    await closeEditor(user);

    await openEditor(user, 'MALE');
    expect(nameField()).toHaveValue(LOADED_NAME.MALE);
    await user.clear(nameField());
    await user.type(nameField(), 'MOVITO');
    await closeEditor(user);

    await openEditor(user, 'FEMALE');
    expect(nameField()).toHaveValue('MOVITA');
    await closeEditor(user);

    await openEditor(user, 'MALE');
    expect(nameField()).toHaveValue('MOVITO');
  });

  it('publicar em um cartão não mexe no rascunho nem no estado do outro', async () => {
    const user = userEvent.setup();
    await renderReady();

    // Rascunho pendente no cartão masculino, deixado para trás de propósito.
    await openEditor(user, 'MALE');
    await user.clear(nameField());
    await user.type(nameField(), 'MOVITO');
    await closeEditor(user);

    // Publicação completa no cartão feminino.
    await openEditor(user, 'FEMALE');
    await user.clear(nameField());
    await user.type(nameField(), 'MOVITA');
    await goToStep(user, 'Revisar e publicar');
    await user.click(screen.getByRole('button', { name: 'Salvar e ativar' }));

    await waitFor(() =>
      expect(api.publishAgentPersona).toHaveBeenCalledWith({
        targetSex: 'FEMALE',
        payload: { ...personaFor('FEMALE'), agentName: 'MOVITA' },
        changeNote: 'Configuração salva e ativada pelo painel.',
      }),
    );
    expect(api.publishAgentPersona).toHaveBeenCalledOnce();
    await closeEditor(user);

    await openEditor(user, 'MALE');
    expect(nameField()).toHaveValue('MOVITO');
  });

  it('erro genérico (não da API) no publish cai na mensagem padrão', async () => {
    const user = userEvent.setup();
    await renderReady();
    await openEditor(user, 'FEMALE');
    await user.clear(nameField());
    await user.type(nameField(), 'MOVITA');
    api.publishAgentPersona.mockRejectedValueOnce(new Error('falha de rede'));

    await goToStep(user, 'Revisar e publicar');
    await user.click(screen.getByRole('button', { name: 'Salvar e ativar' }));

    await screen.findByText('Não foi possível concluir a publicação.');
  });

  it('rollback envia o slot do cartão aberto, não o outro', async () => {
    const user = userEvent.setup();
    await renderReady();

    await openEditor(user, 'MALE');
    await goToStep(user, 'Revisar e publicar');
    await user.click(screen.getByRole('button', { name: 'Restaurar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar restauração' }));

    await waitFor(() =>
      expect(api.rollbackAgentPersona).toHaveBeenCalledWith({
        targetSex: 'MALE',
        targetVersion: 1,
        changeNote: 'Rollback para a versão 1',
      }),
    );
  });

  it('avisa apenas no slot que ainda é atendido pela persona do outro', async () => {
    const user = userEvent.setup();
    api.getAgentPersona.mockImplementation((targetSex: BiologicalSex) =>
      Promise.resolve(
        targetSex === 'MALE'
          ? personaOf('MALE', { version: null, servedFromSex: 'FEMALE' })
          : personaOf('FEMALE'),
      ),
    );
    await renderReady();

    const female = await openEditor(user, 'FEMALE');
    expect(female.queryByText(/Ainda não há persona publicada/)).not.toBeInTheDocument();
    await closeEditor(user);

    const male = await openEditor(user, 'MALE');
    expect(male.getByText(/Ainda não há persona publicada/)).toBeVisible();
    expect(male.getByText(/recebe a persona feminina/)).toBeVisible();
  });

  it('rascunho pendente aparece no cartão mesmo com a edição fechada', async () => {
    const user = userEvent.setup();
    await renderReady();

    await openEditor(user, 'MALE');
    await user.clear(nameField());
    await user.type(nameField(), 'MOVITO');
    await closeEditor(user);

    expect(screen.getByText('1 alteração não publicada')).toBeVisible();
    // O cartão feminino não foi tocado — nenhum aviso de rascunho nele.
    expect(screen.getAllByText('1 alteração não publicada')).toHaveLength(1);
  });
});
