'use client';

/**
 * Estado compartilhado do painel "Agente" (redesenho 2026-08-20, spec da Sofia).
 *
 * ## Por que existe um contexto, e não estado local em `AiPersonaDashboard`
 * O cartão do agente fica acima das seções Configuração/FAQ e precisa do
 * mesmo rascunho que o formulário: quantas alterações estão pendentes, qual a versão
 * vigente, como descartar, como saltar para a etapa de publicação. Duplicar esse estado
 * faria o chip do topo divergir do formulário — que é exatamente o tipo de mentira que
 * este painel não pode contar sobre a configuração da IA.
 *
 * ## O que NÃO mudou
 * O caminho de escrita continua sendo o mesmo de antes: espaço de valores fechado,
 * simulador obrigatório antes de publicar e o servidor repetindo os dois gates. A UI
 * reorganiza a navegação; ela nunca foi (e não passou a ser) a barreira de segurança.
 */
import {
  agentPersonaSchema,
  type AgentConfigVersion,
  type AgentPersona,
  type ConfigSimulationResponse,
  type ForbiddenTopicsResponse,
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
  getForbiddenTopics,
  getInviolableRules,
  publishAgentPersona,
  rollbackAgentPersona,
  simulateAgentConfig,
} from '@/lib/control-center-api';

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
 * uma entidade própria, com maker-checker e publicação separada (contrato do Leonardo,
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
    fields: ['toneDescriptors', 'personaTraits', 'emojiPolicy', 'formatting'],
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
  persona: AgentPersona;
  version: number | null;
  versions: AgentConfigVersion[];
  blocks: PromptBlockView[];
  /**
   * `null` quando o endpoint de temas proibidos não respondeu. O painel degrada:
   * a etapa "Limites" mostra o erro, o resto do assistente continua utilizável.
   */
  topics: ForbiddenTopicsResponse['data'] | null;
  meta: ControlCenterMeta;
}

async function loadAiPersona(signal?: AbortSignal): Promise<AiPersonaData> {
  const [persona, history, rules, topics] = await Promise.all([
    getAgentPersona(signal),
    getAgentConfigHistory(signal),
    getInviolableRules(signal),
    getForbiddenTopics(signal).catch(() => null),
  ]);
  return {
    persona: persona.data.persona,
    version: persona.data.version,
    versions: history.data.versions,
    blocks: rules.data.blocks,
    topics: topics?.data ?? null,
    meta: persona.meta,
  };
}

interface AgentPersonaState {
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
  changeNote: string;
  setChangeNote: (value: string) => void;
  step: PersonaStepId;
  goToStep: (id: PersonaStepId) => void;
  fieldErrors: Map<string, string>;
  validation: ReturnType<typeof agentPersonaSchema.safeParse> | null;
  changedFields: Array<keyof AgentPersona>;
  changedInStep: (step: PersonaStep) => Array<keyof AgentPersona>;
  erroredInStep: (step: PersonaStep) => Array<keyof AgentPersona>;
  simulation: ConfigSimulationResponse['data'] | null;
  simulating: boolean;
  runSimulation: () => Promise<void>;
  /** Campos tocados DEPOIS da última simulação aprovada — invalida o teste. */
  staleFields: Array<keyof AgentPersona>;
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
  canWrite = false,
  canApprove = false,
  children,
}: {
  canWrite?: boolean;
  canApprove?: boolean;
  children: ReactNode;
}) {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(loadAiPersona);
  const [draft, setDraft] = useState<AgentPersona | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [step, setStep] = useState<PersonaStepId>('identidade');
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<ConfigSimulationResponse['data'] | null>(null);
  const [staleFields, setStaleFields] = useState<Array<keyof AgentPersona>>([]);

  const current = data?.persona ?? null;
  const form = draft ?? current;

  /**
   * Toda edição derruba a simulação em curso — não se confirma um diff que já não é o
   * atual. A diferença para o comportamento anterior: em vez de sumir em silêncio, os
   * campos tocados ficam registrados em `staleFields`, e a etapa 5 nomeia o que mudou
   * ("Você mudou o tom depois do último teste").
   */
  const update = useCallback(
    (patch: Partial<AgentPersona>) => {
      setFeedback('');
      setWriteError('');
      setDraft((previous) => {
        const base = previous ?? current;
        return base ? { ...base, ...patch } : base;
      });
      setSimulation((previous) => {
        if (previous) {
          const touched = Object.keys(patch) as Array<keyof AgentPersona>;
          setStaleFields((fields) => [...new Set([...fields, ...touched])]);
        }
        return null;
      });
    },
    [current],
  );

  const reset = useCallback(() => {
    setDraft(null);
    setChangeNote('');
    setSimulation(null);
    setStaleFields([]);
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
    [refresh, reset],
  );

  const runSimulation = useCallback(async () => {
    if (!validation?.success) return;
    setSimulating(true);
    setWriteError('');
    setSimulation(null);
    try {
      const response = await simulateAgentConfig({ kind: 'PERSONA', candidate: validation.data });
      setSimulation(response.data);
      setStaleFields([]);
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível executar o simulador.',
      );
    } finally {
      setSimulating(false);
    }
  }, [validation]);

  const publish = useCallback(async () => {
    if (!validation?.success) return;
    await runWrite(
      () => publishAgentPersona({ payload: validation.data, changeNote }),
      'Publicado. A nova persona passa a valer em até 60 segundos, sem deploy.',
    );
  }, [changeNote, runWrite, validation]);

  const rollback = useCallback(
    async (version: number) => {
      await runWrite(
        () =>
          rollbackAgentPersona({
            targetVersion: version,
            changeNote: `Rollback para a versão ${version}`,
          }),
        `Rollback publicado a partir da v${version}. Vale em até 60 segundos.`,
      );
    },
    [runWrite],
  );

  const canPublish =
    canWrite &&
    validation?.success === true &&
    changedFields.length > 0 &&
    changeNote.trim().length >= 5 &&
    simulation?.passed === true;

  useEffect(() => {
    if (changedFields.length === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [changedFields.length]);

  const value = useMemo<AgentPersonaState>(
    () => ({
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
      changeNote,
      setChangeNote,
      step,
      goToStep: setStep,
      fieldErrors,
      validation,
      changedFields,
      changedInStep,
      erroredInStep,
      simulation,
      simulating,
      runSimulation,
      staleFields,
      publishing,
      feedback,
      writeError,
      publish,
      rollback,
      canPublish,
    }),
    [
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
      changeNote,
      step,
      fieldErrors,
      validation,
      changedFields,
      changedInStep,
      erroredInStep,
      simulation,
      simulating,
      runSimulation,
      staleFields,
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
