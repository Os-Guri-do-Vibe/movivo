'use client';

/**
 * Estado de UM slot de persona do painel "Agente" (redesenho 2026-08-20, spec da Sofia;
 * dois slots desde a Sprint 11).
 *
 * ## Por que existe um contexto, e não estado local em `AiPersonaDashboard`
 * O cartão do agente fica acima das seções Configuração/FAQ e precisa do
 * mesmo rascunho que o formulário: quantas alterações estão pendentes, qual a versão
 * vigente, como descartar, como saltar para a etapa de publicação. Duplicar esse estado
 * faria o chip do topo divergir do formulário — que é exatamente o tipo de mentira que
 * este painel não pode contar sobre a configuração da IA.
 *
 * ## Um provider POR SLOT (`targetSex`)
 * A MOVIVO publica duas personas simultâneas, uma por público, cada uma com histórico e
 * numeração de versão próprios (`UNIQUE(target_sex, version)` no banco). Existe, portanto,
 * uma instância deste provider para cada slot, **montadas ao mesmo tempo** — trocar de aba
 * apenas esconde uma delas via `hidden`, nunca desmonta, porque um rascunho não publicado
 * não pode desaparecer por causa de um clique de navegação.
 *
 * `AiPersonaDashboard` não recebe o slot por prop: ele lê `useAgentPersona()` e o slot vem
 * de qual instância está acima dele na árvore. O que é global (temas proibidos, sessão,
 * aba ativa) mora em `agent-persona-workspace.tsx`.
 *
 * ## Simulador e motivo de publicação — removidos (decisão do fundador, 2026-09-04)
 * Existia um simulador obrigatório ("Teste de segurança e consistência") e um campo de
 * "Motivo da alteração" como pré-requisito de publicação, os dois também reforçados pelo
 * servidor (`ai-config.service.ts::insertVersion`). Ambos os gates foram removidos, cliente
 * e servidor: publicar (`publish`, botão "Salvar e ativar") exige só uma alteração
 * pendente e o payload validar contra `agentPersonaSchema` — nenhum teste prévio, nenhum
 * motivo digitado. O `changeNote` que o servidor grava para auditoria agora é um texto
 * fixo (ver `publish` abaixo), não mais escolha do usuário.
 */
import {
  agentPersonaSchema,
  type AgentConfigVersion,
  type AgentPersona,
  type BiologicalSex,
  type PromptBlockView,
} from '@movivo/shared';
import { Ban, MessagesSquare, ShieldCheck, UserRound, UserRoundCheck } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  ControlCenterApiError,
  getAgentConfigHistory,
  getAgentPersona,
  getInviolableRules,
  publishAgentPersona,
  rollbackAgentPersona,
} from '@/lib/control-center-api';

import {
  OTHER_SLOT,
  slotSlug,
  useAgentPersonaWorkspace,
  type AgentSlotSummary,
} from './agent-persona-workspace';
import { useControlCenterResource, type ControlCenterMeta } from './control-center-ui';

export type PersonaStepId = 'identidade' | 'fala' | 'limites' | 'handoff' | 'revisao';

export interface PersonaStep {
  id: PersonaStepId;
  label: string;
  icon: typeof UserRound;
  /** Campos da persona que esta etapa edita — base do marcador "editado" do trilho. */
  fields: ReadonlyArray<keyof AgentPersona>;
}

/**
 * As cinco etapas. "Limites" não tem campo de persona de propósito: temas proibidos são
 * uma entidade própria, com workflow e publicação separados (contrato do Leonardo,
 * `forbidden-topic.schema.ts`) — o trilho não pode marcá-los como "alteração pendente
 * desta publicação" porque eles não viajam no payload da persona.
 */
export const PERSONA_STEPS: readonly PersonaStep[] = [
  {
    id: 'identidade',
    label: 'Identidade',
    icon: UserRound,
    fields: ['agentName', 'agentSelfIntro'],
  },
  {
    id: 'fala',
    label: 'Jeito de falar',
    icon: MessagesSquare,
    fields: ['toneDescriptors', 'personaTraits', 'emojiPolicy', 'formatting', 'voiceExample'],
  },
  { id: 'limites', label: 'Limites', icon: Ban, fields: [] },
  {
    id: 'handoff',
    label: 'Passagem para o profissional',
    icon: UserRoundCheck,
    fields: ['humanHandoffMessage'],
  },
  { id: 'revisao', label: 'Revisar e publicar', icon: ShieldCheck, fields: [] },
];

export const FIELD_LABEL: Record<keyof AgentPersona, string> = {
  agentName: 'Nome da agente',
  agentSelfIntro: 'Como ela se apresenta',
  toneDescriptors: 'Tom de voz',
  personaTraits: 'Comportamentos',
  emojiPolicy: 'Uso de emoji',
  formatting: 'Formato da mensagem',
  voiceExample: 'Exemplo real de fala',
  humanHandoffMessage: 'Mensagem de passagem',
};

export const BLOCK_SIZE_LABEL: Record<AgentPersona['formatting']['blockSize'], string> = {
  CURTO: 'Blocos curtos',
  MEDIO: 'Blocos médios',
  LIVRE: 'Blocos amplos (até 3 parágrafos)',
};

export const BOLD_LABEL: Record<AgentPersona['formatting']['boldPolicy'], string> = {
  NENHUM: 'sem negrito',
  UMA_PALAVRA: 'negrito em uma palavra',
  MODERADO: 'negrito moderado',
};

export const EMOJI_LABEL: Record<AgentPersona['emojiPolicy'], string> = {
  NENHUM: 'Nenhum emoji',
  RARO: 'Raro (no máximo um por mensagem)',
  MODERADO: 'Moderado',
};

export const PERSONA_TRAIT_LABEL: Record<AgentPersona['personaTraits'][number], string> = {
  ACOLHE_ANTES_DE_ORIENTAR: 'Acolhe antes de orientar',
  EXPLICA_O_PORQUE: 'Explica o porquê',
  UMA_PERGUNTA_POR_VEZ: 'Uma pergunta por vez',
  FOCA_NO_PROXIMO_PASSO: 'Foca no próximo passo',
  CELEBRA_PROGRESSO: 'Celebra o progresso',
};

export const TONE_DESCRIPTION_LABEL: Record<AgentPersona['toneDescriptors'][number], string> = {
  caloroso: 'Caloroso',
  direto: 'Direto',
  'bem-humorado': 'Bem-humorado',
  tecnico: 'Técnico',
  motivacional: 'Motivacional',
  sem_hype: 'Sem hype',
  informal: 'Informal',
  formal: 'Formal',
};

/** Valor de um campo em texto — usado no diff e na leitura por leitor de tela. */
export function describeField(field: keyof AgentPersona, persona: AgentPersona): string {
  if (field === 'formatting') {
    const { blockSize, allowLists, boldPolicy } = persona.formatting;
    return `${BLOCK_SIZE_LABEL[blockSize]} · ${allowLists ? 'com listas' : 'sem listas'} · ${BOLD_LABEL[boldPolicy]}`;
  }
  if (field === 'emojiPolicy') return EMOJI_LABEL[persona.emojiPolicy];
  if (field === 'personaTraits') {
    return persona.personaTraits.map((trait) => PERSONA_TRAIT_LABEL[trait]).join(', ');
  }
  if (field === 'toneDescriptors') {
    return persona.toneDescriptors.map((tone) => TONE_DESCRIPTION_LABEL[tone]).join(', ');
  }
  const value = persona[field];
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Etapa a que um campo pertence — usada nos atalhos "Corrigir na etapa N". */
export function stepOfField(field: keyof AgentPersona): PersonaStep | undefined {
  return PERSONA_STEPS.find((step) => step.fields.includes(field));
}

export interface AiPersonaData {
  /** Slot pedido — o público que este formulário edita. */
  targetSex: BiologicalSex;
  persona: AgentPersona;
  version: number | null;
  /**
   * Slot de onde o payload servido veio de fato. Diferente de `targetSex` quando este
   * público ainda não tem persona própria e está sendo atendido pela do outro; `null`
   * quando nenhum dos dois publicou e vale o default compilado.
   */
  servedFromSex: BiologicalSex | null;
  versions: AgentConfigVersion[];
  blocks: PromptBlockView[];
  meta: ControlCenterMeta;
}

async function loadAiPersona(
  targetSex: BiologicalSex,
  signal?: AbortSignal,
): Promise<AiPersonaData> {
  const [persona, history, rules] = await Promise.all([
    getAgentPersona(targetSex, signal),
    getAgentConfigHistory(targetSex, signal),
    getInviolableRules(targetSex, signal),
  ]);
  return {
    targetSex,
    persona: persona.data.persona,
    version: persona.data.version,
    servedFromSex: persona.data.servedFromSex,
    versions: history.data.versions,
    blocks: rules.data.blocks,
    meta: persona.meta,
  };
}

interface AgentPersonaState {
  /** Slot deste provider. Toda escrita daqui viaja com ele. */
  targetSex: BiologicalSex;
  /**
   * Prefixa um `id`/`name` de formulário com o slot.
   *
   * Não é cosmético: os DOIS formulários ficam montados ao mesmo tempo, e id repetido tem
   * duas consequências reais — `<label for>` do segundo passa a apontar para o campo do
   * primeiro (o campo perde nome acessível) e dois `<input type="radio">` de mesmo `name`
   * viram UM grupo, então marcar uma opção numa aba desmarca a da outra no DOM.
   */
  slotId: (suffix: string) => string;
  /**
   * `true` quando o público deste slot ainda não tem persona própria e recebe a do outro.
   * O formulário mostra o aviso; o rascunho e a publicação continuam sendo deste slot.
   */
  borrowed: boolean;
  canWrite: boolean;
  canApprove: boolean;
  data: AiPersonaData | null;
  loading: boolean;
  error: string;
  forbidden: boolean;
  refresh: () => Promise<void>;
  /** Persona vigente (publicada ou default de código). */
  current: AgentPersona | null;
  /** Rascunho em edição — cai para `current` enquanto ninguém tocou em nada. */
  form: AgentPersona | null;
  update: (patch: Partial<AgentPersona>) => void;
  discard: () => void;
  step: PersonaStepId;
  goToStep: (id: PersonaStepId) => void;
  fieldErrors: Map<string, string>;
  validation: ReturnType<typeof agentPersonaSchema.safeParse> | null;
  changedFields: Array<keyof AgentPersona>;
  changedInStep: (step: PersonaStep) => Array<keyof AgentPersona>;
  erroredInStep: (step: PersonaStep) => Array<keyof AgentPersona>;
  publishing: boolean;
  feedback: string;
  writeError: string;
  publish: () => Promise<void>;
  rollback: (version: number) => Promise<void>;
  canPublish: boolean;
}

const AgentPersonaContext = createContext<AgentPersonaState | null>(null);

export function useAgentPersona(): AgentPersonaState {
  const value = useContext(AgentPersonaContext);
  if (!value) throw new Error('useAgentPersona exige <AgentPersonaProvider> acima na árvore.');
  return value;
}

export function AgentPersonaProvider({
  targetSex,
  children,
}: {
  /** Slot deste formulário. Uma instância por público, as duas montadas ao mesmo tempo. */
  targetSex: BiologicalSex;
  children: ReactNode;
}) {
  const { canWrite, canApprove, registerSlot, forgetSlot, refreshSlot } =
    useAgentPersonaWorkspace();
  const load = useCallback((signal?: AbortSignal) => loadAiPersona(targetSex, signal), [targetSex]);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const [draft, setDraft] = useState<AgentPersona | null>(null);
  const [step, setStep] = useState<PersonaStepId>('identidade');
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');

  const current = data?.persona ?? null;
  const form = draft ?? current;

  const update = useCallback(
    (patch: Partial<AgentPersona>) => {
      setFeedback('');
      setWriteError('');
      setDraft((previous) => {
        const base = previous ?? current;
        return base ? { ...base, ...patch } : base;
      });
    },
    [current],
  );

  const reset = useCallback(() => {
    setDraft(null);
  }, []);

  const discard = useCallback(() => {
    reset();
    setWriteError('');
    setFeedback('As alterações não publicadas foram descartadas.');
  }, [reset]);

  const validation = useMemo(() => (form ? agentPersonaSchema.safeParse(form) : null), [form]);

  const fieldErrors = useMemo(() => {
    const map = new Map<string, string>();
    if (validation && !validation.success) {
      for (const issue of validation.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (!map.has(key)) map.set(key, issue.message);
      }
    }
    return map;
  }, [validation]);

  const changedFields = useMemo(() => {
    if (!form || !current) return [] as Array<keyof AgentPersona>;
    return (Object.keys(FIELD_LABEL) as Array<keyof AgentPersona>).filter(
      (field) => describeField(field, form) !== describeField(field, current),
    );
  }, [form, current]);

  const changedInStep = useCallback(
    (target: PersonaStep) => changedFields.filter((field) => target.fields.includes(field)),
    [changedFields],
  );

  const erroredInStep = useCallback(
    (target: PersonaStep) => target.fields.filter((field) => fieldErrors.has(field)),
    [fieldErrors],
  );

  const runWrite = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setPublishing(true);
      setWriteError('');
      setFeedback('');
      try {
        await action();
        reset();
        setFeedback(success);
        await refresh();
        /*
         * O slot vizinho também recarrega: enquanto ele não tem persona própria, ele exibe
         * a DESTE slot por empréstimo — publicar aqui muda o que está valendo lá. Sem isso
         * a outra aba continuaria mostrando o payload antigo como se fosse o vigente. O
         * rascunho de lá não é tocado: `refresh` só troca `current`.
         */
        await refreshSlot(OTHER_SLOT[targetSex]);
      } catch (caught) {
        setWriteError(
          caught instanceof ControlCenterApiError
            ? caught.message
            : 'Não foi possível concluir a publicação.',
        );
      } finally {
        setPublishing(false);
      }
    },
    [refresh, refreshSlot, reset, targetSex],
  );

  const publish = useCallback(async () => {
    if (!validation?.success) return;
    await runWrite(
      () =>
        publishAgentPersona({
          targetSex,
          payload: validation.data,
          // Decisão do fundador (2026-09-04): publicar não pede mais motivo — o contrato
          // ainda exige `changeNote` (mín. 5 chars, auditoria de quem/quando publicou),
          // então mandamos um valor fixo em vez de expor o campo.
          changeNote: 'Configuração salva e ativada pelo painel.',
        }),
      'Publicado. A nova persona passa a valer em até 60 segundos, sem deploy.',
    );
  }, [runWrite, targetSex, validation]);

  const rollback = useCallback(
    async (version: number) => {
      await runWrite(
        () =>
          rollbackAgentPersona({
            // O par `(targetSex, targetVersion)` é a chave real: "versão 1" existe nos dois
            // slots e não se refere à mesma persona.
            targetSex,
            targetVersion: version,
            changeNote: `Rollback para a versão ${version}`,
          }),
        `Rollback publicado a partir da v${version}. Vale em até 60 segundos.`,
      );
    },
    [runWrite, targetSex],
  );

  const canPublish = canWrite && validation?.success === true && changedFields.length > 0;

  useEffect(() => {
    if (changedFields.length === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [changedFields.length]);

  const borrowed = data !== null && data.servedFromSex !== null && data.servedFromSex !== targetSex;

  const slotId = useCallback((suffix: string) => `${slotSlug(targetSex)}-${suffix}`, [targetSex]);

  /*
   * Retrato deste slot para o cartão-resumo, que fica fora das abas e precisa falar dos
   * dois slots. O objeto é memoizado para que o efeito de registro não dispare a cada
   * render — o `setState` do workspace reentra aqui como novo render, e uma identidade
   * instável viraria laço.
   */
  const summary = useMemo<AgentSlotSummary>(
    () => ({
      targetSex,
      agentName: data?.persona.agentName ?? null,
      version: data?.version ?? null,
      servedFromSex: data?.servedFromSex ?? null,
      borrowed,
      pending: changedFields.length,
      loading,
      error,
      generatedAt: data?.meta.generatedAt ?? null,
      discard,
      goToStep: setStep,
      refresh: async () => {
        await refresh();
      },
    }),
    [targetSex, data, borrowed, changedFields.length, loading, error, discard, refresh],
  );

  useEffect(() => {
    registerSlot(summary);
  }, [registerSlot, summary]);

  // Limpeza só no desmonte (deps estáveis) — não a cada mudança de resumo.
  useEffect(() => () => forgetSlot(targetSex), [forgetSlot, targetSex]);

  const value = useMemo<AgentPersonaState>(
    () => ({
      targetSex,
      slotId,
      borrowed,
      canWrite,
      canApprove,
      data,
      loading,
      error,
      forbidden,
      refresh: async () => {
        await refresh();
      },
      current,
      form,
      update,
      discard,
      step,
      goToStep: setStep,
      fieldErrors,
      validation,
      changedFields,
      changedInStep,
      erroredInStep,
      publishing,
      feedback,
      writeError,
      publish,
      rollback,
      canPublish,
    }),
    [
      targetSex,
      slotId,
      borrowed,
      canWrite,
      canApprove,
      data,
      loading,
      error,
      forbidden,
      refresh,
      current,
      form,
      update,
      discard,
      step,
      fieldErrors,
      validation,
      changedFields,
      changedInStep,
      erroredInStep,
      publishing,
      feedback,
      writeError,
      publish,
      rollback,
      canPublish,
    ],
  );

  return <AgentPersonaContext.Provider value={value}>{children}</AgentPersonaContext.Provider>;
}
