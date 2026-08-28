'use client';

/**
 * Estado GLOBAL do painel "Agente" — tudo o que **não** pertence a um slot de persona.
 *
 * ## Por que este arquivo existe (Sprint 11)
 * A MOVIVO passou a publicar DUAS personas simultâneas, uma por público (`targetSex`).
 * Cada uma tem persona, histórico, numeração de versão, rascunho e simulação próprios —
 * e por isso existe uma instância de `AgentPersonaProvider` para cada slot, montada ao
 * mesmo tempo (ver `ai-agent-dashboard.tsx`).
 *
 * O que **não** se duplica fica aqui:
 *  - **Temas proibidos** (`getForbiddenTopics`): são entidade própria, com workflow auditável
 *    e publicação separada, e valem para os dois públicos. Buscá-los uma vez por slot seria
 *    duas chamadas para a mesma lista — e duas cópias divergindo depois de uma aprovação.
 *  - **Capabilities** (`canWrite` / `canApprove`): vêm da sessão, não do slot.
 *  - **Slot ativo** (`activeSex`), espelhado em `?agente=` para o deep-link sobreviver a um
 *    refresh e poder ser compartilhado.
 *  - **Registro dos dois slots**: o cartão-resumo fica ACIMA das abas e precisa falar dos
 *    dois ao mesmo tempo ("1 de 2 personas publicadas"), o que nenhum provider de slot
 *    isolado consegue dizer. Cada slot publica aqui um resumo do seu próprio estado.
 *
 * O bloco L2 do prompt (`getInviolableRules`) continua sendo buscado POR SLOT: o conteúdo
 * do bloco de persona muda com a persona, e a API só expõe os quatro blocos juntos. L0/L1
 * vêm repetidos nas duas respostas — é o mínimo que o contrato atual permite sem inventar
 * um endpoint que não existe.
 */
import type { BiologicalSex, ForbiddenTopicsResponse } from '@movivo/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getForbiddenTopics } from '@/lib/control-center-api';

// Só o tipo — `import type` é apagado na emissão, então não há ciclo em runtime entre este
// arquivo e o provider de slot (que importa valores daqui).
import type { PersonaStepId } from './agent-persona-context';
import { useControlCenterResource } from './control-center-ui';

export interface AgentSlotDescriptor {
  sex: BiologicalSex;
  /** Valor usado em `?agente=` — legível por quem compartilha o link. */
  slug: string;
}

/**
 * Ordem das abas. Feminina primeiro por ser o slot padrão da tela; a ordem não implica
 * precedência nenhuma no servidor — os dois slots são independentes e simétricos.
 */
export const AGENT_SLOTS: readonly AgentSlotDescriptor[] = [
  { sex: 'FEMALE', slug: 'feminina' },
  { sex: 'MALE', slug: 'masculina' },
];

/**
 * Rótulo do slot. "Persona feminina/masculina" e não "Público feminino/masculino" porque é
 * assim que a equipe fala da entrega ("publicar as duas personas"); a frase de `SLOT_AUDIENCE`
 * logo abaixo do rótulo é que diz, sem ambiguidade, QUEM cada uma atende.
 */
export const SLOT_LABEL: Record<BiologicalSex, string> = {
  FEMALE: 'Persona feminina',
  MALE: 'Persona masculina',
};

/** Nome do slot em posição de complemento ("recebe a persona masculina"). */
export const SLOT_LABEL_LOWER: Record<BiologicalSex, string> = {
  FEMALE: 'persona feminina',
  MALE: 'persona masculina',
};

export const SLOT_AUDIENCE: Record<BiologicalSex, string> = {
  FEMALE: 'Atende quem informou sexo biológico feminino na anamnese.',
  MALE: 'Atende quem informou sexo biológico masculino na anamnese.',
};

export const OTHER_SLOT: Record<BiologicalSex, BiologicalSex> = {
  FEMALE: 'MALE',
  MALE: 'FEMALE',
};

export const DEFAULT_SLOT: BiologicalSex = 'FEMALE';

const SLOT_QUERY_KEY = 'agente';

export function slotSlug(sex: BiologicalSex): string {
  return AGENT_SLOTS.find((slot) => slot.sex === sex)?.slug ?? '';
}

/** Slot pedido pela URL. `null` quando o parâmetro está ausente ou não é conhecido. */
export function slotFromSearch(search: string): BiologicalSex | null {
  const slug = new URLSearchParams(search).get(SLOT_QUERY_KEY);
  return AGENT_SLOTS.find((slot) => slot.slug === slug)?.sex ?? null;
}

/**
 * Retrato que cada slot publica no workspace. Só leitura e ações de navegação/descarte —
 * `publish` e `rollback` NÃO entram aqui de propósito: quem publica é o formulário do slot,
 * com o `changeNote` e a simulação daquele slot na mão.
 */
export interface AgentSlotSummary {
  targetSex: BiologicalSex;
  /** Nome da persona vigente (ou da emprestada). `null` enquanto não carregou. */
  agentName: string | null;
  /** Versão vigente DO SLOT. `null` quando este slot ainda não publicou nada. */
  version: number | null;
  /** De qual slot veio o payload servido; `null` quando vale o default de código. */
  servedFromSex: BiologicalSex | null;
  /** `true` quando o público é atendido pela persona do outro slot. */
  borrowed: boolean;
  /** Campos alterados e ainda não publicados. */
  pending: number;
  loading: boolean;
  error: string;
  generatedAt: string | null;
  discard: () => void;
  goToStep: (step: PersonaStepId) => void;
  refresh: () => Promise<void>;
}

interface AgentPersonaWorkspaceState {
  canWrite: boolean;
  canApprove: boolean;
  /** Temas proibidos. `null` enquanto carrega e também quando a chamada falhou. */
  topics: ForbiddenTopicsResponse['data'] | null;
  topicsLoading: boolean;
  topicsError: string;
  refreshTopics: () => Promise<void>;
  activeSex: BiologicalSex;
  selectSlot: (sex: BiologicalSex) => void;
  slots: Partial<Record<BiologicalSex, AgentSlotSummary>>;
  activeSlot: AgentSlotSummary | null;
  registerSlot: (summary: AgentSlotSummary) => void;
  forgetSlot: (sex: BiologicalSex) => void;
  /** Recarrega um slot montado. Usado depois de publicar no slot vizinho. */
  refreshSlot: (sex: BiologicalSex) => Promise<void>;
}

const AgentPersonaWorkspaceContext = createContext<AgentPersonaWorkspaceState | null>(null);

export function useAgentPersonaWorkspace(): AgentPersonaWorkspaceState {
  const value = useContext(AgentPersonaWorkspaceContext);
  if (!value) {
    throw new Error(
      'useAgentPersonaWorkspace exige <AgentPersonaWorkspaceProvider> acima na árvore.',
    );
  }
  return value;
}

async function loadForbiddenTopics(signal?: AbortSignal): Promise<ForbiddenTopicsResponse['data']> {
  return (await getForbiddenTopics(signal)).data;
}

export function AgentPersonaWorkspaceProvider({
  canWrite = false,
  canApprove = false,
  children,
}: {
  canWrite?: boolean;
  canApprove?: boolean;
  children: ReactNode;
}) {
  const topicsResource = useControlCenterResource(loadForbiddenTopics);
  const [activeSex, setActiveSex] = useState<BiologicalSex>(DEFAULT_SLOT);
  const [slots, setSlots] = useState<Partial<Record<BiologicalSex, AgentSlotSummary>>>({});

  /*
   * Espelho em ref: `refreshSlot` precisa alcançar o slot vizinho sem depender de `slots`,
   * senão a identidade dela mudaria a cada registro e realimentaria o efeito que registra.
   */
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  /*
   * A aba ativa é lida da URL só no cliente: renderizar o padrão no servidor e corrigir no
   * efeito evita divergência de hidratação (o mesmo caminho que a aba Configuração/FAQ já
   * usa com `#hash`). `popstate` cobre voltar/avançar do navegador.
   */
  useEffect(() => {
    const syncFromUrl = () => {
      const fromUrl = slotFromSearch(window.location.search);
      if (fromUrl) setActiveSex(fromUrl);
    };
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  const selectSlot = useCallback((sex: BiologicalSex) => {
    setActiveSex(sex);
    const url = new URL(window.location.href);
    url.searchParams.set(SLOT_QUERY_KEY, slotSlug(sex));
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const registerSlot = useCallback((summary: AgentSlotSummary) => {
    setSlots((previous) =>
      previous[summary.targetSex] === summary
        ? previous
        : { ...previous, [summary.targetSex]: summary },
    );
  }, []);

  const forgetSlot = useCallback((sex: BiologicalSex) => {
    setSlots((previous) => {
      if (!previous[sex]) return previous;
      const next = { ...previous };
      delete next[sex];
      return next;
    });
  }, []);

  const refreshSlot = useCallback(async (sex: BiologicalSex) => {
    await slotsRef.current[sex]?.refresh();
  }, []);

  const { refresh: refreshTopicsResource } = topicsResource;
  const refreshTopics = useCallback(async () => {
    await refreshTopicsResource();
  }, [refreshTopicsResource]);

  const value = useMemo<AgentPersonaWorkspaceState>(
    () => ({
      canWrite,
      canApprove,
      topics: topicsResource.data,
      topicsLoading: topicsResource.loading,
      topicsError: topicsResource.error,
      refreshTopics,
      activeSex,
      selectSlot,
      slots,
      activeSlot: slots[activeSex] ?? null,
      registerSlot,
      forgetSlot,
      refreshSlot,
    }),
    [
      canWrite,
      canApprove,
      topicsResource.data,
      topicsResource.loading,
      topicsResource.error,
      refreshTopics,
      activeSex,
      selectSlot,
      slots,
      registerSlot,
      forgetSlot,
      refreshSlot,
    ],
  );

  return (
    <AgentPersonaWorkspaceContext.Provider value={value}>
      {children}
    </AgentPersonaWorkspaceContext.Provider>
  );
}
