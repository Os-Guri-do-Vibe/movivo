/**
 * Teste de integração da página "Agente" com os DOIS slots de persona montados.
 *
 * Aqui os providers são os de verdade (só a camada de API e o painel de FAQ são dublês):
 * o que precisa de prova neste arquivo é justamente a interação entre eles — rascunho que
 * sobrevive à troca de aba, publicação que não vaza para o slot vizinho e escrita que viaja
 * com o slot certo. Com `useAgentPersona` mockado, nada disso seria observável.
 *
 * As consultas usam `getByRole`, que ignora subárvore com `hidden` — ou seja, elas sempre
 * alcançam a aba VISÍVEL, e um vazamento entre abas aparece como elemento duplicado.
 */
import { DEFAULT_AGENT_PERSONA, type BiologicalSex } from '@movivo/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  simulateAgentConfig: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  ...api,
}));

vi.mock('./ai-faq', () => ({
  AiFaqDashboard: ({ canWrite }: { canWrite: boolean }) => (
    <p>{`faq canWrite=${String(canWrite)}`}</p>
  ),
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
          payload: DEFAULT_AGENT_PERSONA,
        },
        {
          targetSex,
          version: 1,
          status: 'PUBLISHED' as const,
          changeNote: 'configuração inicial',
          createdAt: '2026-08-19T12:00:00.000Z',
          createdBy: 'Pedro',
          current: false,
          payload: { ...DEFAULT_AGENT_PERSONA, agentName: 'MOVITA' },
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
  return { data: { targetSex, persona: DEFAULT_AGENT_PERSONA, version, servedFromSex }, meta };
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

/** A aba de persona visível. As duas ficam no DOM; só uma não está `hidden`. */
function visiblePersonaPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('[id^="persona-panel-"]:not([hidden])');
  if (!panel) throw new Error('nenhuma aba de persona visível');
  return panel;
}

function personaPanel(slug: 'feminina' | 'masculina'): HTMLElement {
  const panel = document.querySelector<HTMLElement>(`#persona-panel-${slug}`);
  if (!panel) throw new Error(`aba ${slug} ausente`);
  return panel;
}

/**
 * Renderiza e espera os DOIS slots terminarem de carregar.
 *
 * Esperar só a aba visível deixaria o teste correr enquanto a escondida ainda mostra o
 * esqueleto — e uma asserção sobre ela passaria ou falharia conforme a ordem em que as duas
 * promessas resolvem. `hidden: true` é necessário porque a aba inativa está, de fato, oculta.
 */
async function renderReady(
  props: { canWriteConfig?: boolean; canApproveGuardrails?: boolean } = {},
) {
  const result = renderAgent(props);
  await within(personaPanel('feminina')).findByRole('heading', {
    name: 'Persona feminina',
    hidden: true,
  });
  await within(personaPanel('masculina')).findByRole('heading', {
    name: 'Persona masculina',
    hidden: true,
  });
  return result;
}

/** Campo "Nome da agente" da aba VISÍVEL — role query não enxerga subárvore `hidden`. */
const visibleNameField = () => screen.getByRole('textbox', { name: 'Nome da agente' });

const openSlot = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(screen.getByRole('tab', { name: label }));

/**
 * O trilho de etapas fica DENTRO da aba: "Revisar e publicar" também é o nome do botão do
 * cartão-resumo, e uma busca global acertaria o botão errado.
 */
const goToStep = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(within(visiblePersonaPanel()).getByRole('button', { name }));

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
  api.simulateAgentConfig.mockResolvedValue({
    data: {
      kind: 'PERSONA',
      passed: true,
      candidateHash: 'a'.repeat(64),
      checks: [
        { id: 'SCHEMA', title: 'Contrato fechado', passed: true, cases: 1, failures: [] },
        { id: 'GOLDEN_INPUT', title: 'Golden de entrada', passed: true, cases: 14, failures: [] },
        { id: 'GOLDEN_OUTPUT', title: 'Golden de saída', passed: true, cases: 8, failures: [] },
        { id: 'PROMPT_INTEGRITY', title: 'Integridade L0', passed: true, cases: 9, failures: [] },
      ],
    },
    meta,
  });
});

describe('AiAgentDashboard — seções', () => {
  it('mantém um único h1 e abre na configuração', async () => {
    renderAgent();
    expect(screen.getByRole('heading', { name: 'Agente', level: 1 })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Configuração' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Persona feminina' })).toBeVisible();
    expect(screen.getByText(/^faq canWrite/)).not.toBeVisible();
  });

  it('abre FAQ, preserva a capability e atualiza o deep-link', async () => {
    const user = userEvent.setup();
    renderAgent({ canWriteConfig: true });

    await user.click(screen.getByRole('tab', { name: 'FAQ' }));
    expect(screen.getByText('faq canWrite=true')).toBeVisible();
    expect(window.location.hash).toBe('#faq');
    // A configuração inteira (as duas personas junto) sai de vista, sem desmontar.
    expect(screen.queryByRole('heading', { name: 'Persona feminina' })).not.toBeInTheDocument();
  });

  it('abre o deep-link de FAQ e ignora hashes antigos ou desconhecidos', () => {
    window.location.hash = '#faq';
    const { unmount } = renderAgent();
    expect(screen.getByRole('tab', { name: 'FAQ' })).toHaveAttribute('aria-selected', 'true');
    unmount();

    window.location.hash = '#conhecimento';
    renderAgent();
    expect(screen.getByRole('tab', { name: 'Configuração' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('permite navegar pelas abas com setas, Home e End', () => {
    renderAgent();
    const configuration = screen.getByRole('tab', { name: 'Configuração' });
    const faq = screen.getByRole('tab', { name: 'FAQ' });

    configuration.focus();
    fireEvent.keyDown(configuration, { key: 'ArrowRight' });
    expect(faq).toHaveFocus();
    expect(faq).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(faq, { key: 'Home' });
    expect(configuration).toHaveFocus();
    fireEvent.keyDown(configuration, { key: 'End' });
    expect(faq).toHaveFocus();
  });

  it('atalho do cartão abre a configuração na etapa pedida', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(screen.getByRole('tab', { name: 'FAQ' }));

    await user.click(screen.getByRole('button', { name: 'Revisar e publicar' }));
    expect(screen.getByRole('tab', { name: 'Configuração' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Revisar e publicar' })).toBeVisible();
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

  it('troca de aba troca o formulário visível sem desmontar o escondido', async () => {
    const user = userEvent.setup();
    await renderReady();

    await openSlot(user, 'Persona masculina');
    expect(screen.getByRole('heading', { name: 'Persona masculina' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Persona masculina' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Continua no DOM (apenas `hidden`), que é o que preserva o rascunho da outra aba.
    expect(document.querySelector('#persona-panel-feminina #feminina-agent-name')).not.toBeNull();
    // E cada aba tem os seus próprios ids: `<label for>` repetido roubaria o campo da outra.
    expect(document.querySelectorAll('#masculina-agent-name')).toHaveLength(1);
  });

  /*
   * O caso que motivou montar as duas instâncias ao mesmo tempo: um rascunho não publicado
   * não pode desaparecer porque alguém clicou na outra aba.
   */
  it('mantém rascunhos independentes nas duas abas', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.clear(visibleNameField());
    await user.type(visibleNameField(), 'MOVITA');

    await openSlot(user, 'Persona masculina');
    expect(visibleNameField()).toHaveValue(DEFAULT_AGENT_PERSONA.agentName);
    await user.clear(visibleNameField());
    await user.type(visibleNameField(), 'MOVITO');

    await openSlot(user, 'Persona feminina');
    expect(visibleNameField()).toHaveValue('MOVITA');

    await openSlot(user, 'Persona masculina');
    expect(visibleNameField()).toHaveValue('MOVITO');
  });

  it('publicar em uma aba não mexe no rascunho nem no estado da outra', async () => {
    const user = userEvent.setup();
    await renderReady();

    // Rascunho pendente na aba masculina, deixado para trás de propósito.
    await openSlot(user, 'Persona masculina');
    await user.clear(visibleNameField());
    await user.type(visibleNameField(), 'MOVITO');

    // Publicação completa na aba feminina.
    await openSlot(user, 'Persona feminina');
    await user.clear(visibleNameField());
    await user.type(visibleNameField(), 'MOVITA');
    await goToStep(user, 'Revisar e publicar');
    await user.type(screen.getByRole('textbox', { name: 'Motivo da alteração' }), 'novo nome');
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));
    await screen.findByText('Integridade L0');
    await user.click(screen.getByRole('button', { name: 'Publicar configuração' }));

    await waitFor(() =>
      expect(api.publishAgentPersona).toHaveBeenCalledWith({
        targetSex: 'FEMALE',
        payload: { ...DEFAULT_AGENT_PERSONA, agentName: 'MOVITA' },
        changeNote: 'novo nome',
      }),
    );
    expect(api.publishAgentPersona).toHaveBeenCalledOnce();

    await openSlot(user, 'Persona masculina');
    expect(visibleNameField()).toHaveValue('MOVITO');
  });

  it('erro genérico (não da API) no publish e no simulador cai na mensagem padrão', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.clear(visibleNameField());
    await user.type(visibleNameField(), 'MOVITA');
    api.simulateAgentConfig.mockRejectedValueOnce(new Error('falha de rede'));

    await goToStep(user, 'Revisar e publicar');
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));
    await screen.findByText('Não foi possível executar o simulador.');

    api.publishAgentPersona.mockRejectedValueOnce(new Error('falha de rede'));
    await user.click(screen.getByRole('button', { name: 'Executar teste' }));
    await screen.findByText('Integridade L0');
    await user.type(screen.getByRole('textbox', { name: 'Motivo da alteração' }), 'novo nome');
    await user.click(screen.getByRole('button', { name: 'Publicar configuração' }));

    await screen.findByText('Não foi possível concluir a publicação.');
  });

  it('rollback envia o slot da aba ativa, não o outro', async () => {
    const user = userEvent.setup();
    await renderReady();

    await openSlot(user, 'Persona masculina');
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

    const feminina = document.querySelector('#persona-panel-feminina');
    const masculina = document.querySelector('#persona-panel-masculina');
    expect(feminina).not.toBeNull();
    expect(masculina).not.toBeNull();
    if (!feminina || !masculina) throw new Error('painéis de persona ausentes');

    expect(
      within(feminina as HTMLElement).queryByText(/Ainda não há persona publicada/),
    ).not.toBeInTheDocument();
    expect(
      within(masculina as HTMLElement).getByText(/Ainda não há persona publicada/),
    ).toBeInTheDocument();
    expect(
      within(masculina as HTMLElement).getByText(/recebe a persona feminina/),
    ).toBeInTheDocument();

    // O cartão-resumo conta a verdade dos dois slots no lugar do antigo "vN" no singular.
    // `findByText` (não `getByText`): os dois slots resolvem via promises independentes
    // (uma por sexo) e o cartão-resumo é um consumer separado do mesmo contexto — sob
    // carga (ex.: suíte completa em paralelo), o commit dele pode ficar um tick atrás dos
    // painéis checados acima, então a asserção precisa tolerar esse atraso.
    expect(await screen.findByText(/1 de 2 personas publicadas/)).toBeVisible();

    await openSlot(user, 'Persona masculina');
    expect(screen.getByText(/Persona masculina · usa a persona feminina/)).toBeVisible();
  });

  it('lê a aba ativa da URL no carregamento', async () => {
    window.history.replaceState(null, '', '/dashboard/ia/agente?agente=masculina');
    renderAgent();

    expect(await screen.findByRole('heading', { name: 'Persona masculina' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Persona masculina' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('espelha a aba escolhida na URL, preservando a seção no hash', async () => {
    const user = userEvent.setup();
    await renderReady();

    await openSlot(user, 'Persona masculina');
    expect(window.location.search).toBe('?agente=masculina');

    await openSlot(user, 'Persona feminina');
    expect(window.location.search).toBe('?agente=feminina');
    expect(window.location.pathname).toBe('/dashboard/ia/agente');
  });

  it('rascunho da aba escondida vira aviso com atalho no cartão-resumo', async () => {
    const user = userEvent.setup();
    await renderReady();

    await openSlot(user, 'Persona masculina');
    await user.clear(visibleNameField());
    await user.type(visibleNameField(), 'MOVITO');
    await openSlot(user, 'Persona feminina');

    expect(
      screen.getByText('A persona masculina também tem 1 alteração não publicada.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Abrir persona masculina' }));
    expect(screen.getByRole('tab', { name: 'Persona masculina' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Revisar e publicar' })).toBeVisible();
  });
});
