'use client';

import { Bot, HelpCircle, Settings2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

import { AgentPersonaProvider } from './agent-persona-context';
import {
  AGENT_SLOTS,
  AgentPersonaWorkspaceProvider,
  SLOT_LABEL,
  slotSlug,
  useAgentPersonaWorkspace,
} from './agent-persona-workspace';
import { AgentSummaryCard } from './agent-summary-card';
import { AiFaqDashboard } from './ai-faq';
import { AiPersonaDashboard } from './ai-persona';

type AgentView = 'configuracao' | 'faq';

interface TabItem<T extends string> {
  id: T;
  label: string;
  icon: typeof Settings2;
}

const VIEWS: ReadonlyArray<TabItem<AgentView>> = [
  { id: 'configuracao', label: 'Configuração', icon: Settings2 },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
];

function isAgentView(value: string): value is AgentView {
  return VIEWS.some((view) => view.id === value);
}

/**
 * Faixa de abas do painel. Extraída do corpo desta tela quando as personas viraram duas:
 * o mesmo componente serve às seções (Configuração/FAQ) e aos slots de persona, em vez de
 * o segundo nível reimplementar `aria-selected`, `tabIndex` móvel e navegação por setas —
 * que é justamente onde uma segunda implementação erraria.
 */
function TabStrip<T extends string>({
  label,
  idPrefix,
  items,
  active,
  onSelect,
}: {
  label: string;
  idPrefix: string;
  items: ReadonlyArray<TabItem<T>>;
  active: T;
  onSelect: (id: T) => void;
}) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    const target = items[next];
    if (!target) return;
    onSelect(target.id);
    tabs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-border">
      {items.map((item, index) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.id}`}
            tabIndex={selected ? 0 : -1}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${item.id}`}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-label font-medium',
              'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
              selected
                ? 'border-verde-pulso text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function AiAgentDashboard({
  canWriteConfig,
  canApproveGuardrails,
}: {
  canWriteConfig: boolean;
  canApproveGuardrails: boolean;
}) {
  return (
    <AgentPersonaWorkspaceProvider canWrite={canWriteConfig} canApprove={canApproveGuardrails}>
      <AiAgentDashboardContent canWriteConfig={canWriteConfig} />
    </AgentPersonaWorkspaceProvider>
  );
}

function AiAgentDashboardContent({ canWriteConfig }: { canWriteConfig: boolean }) {
  const [view, setView] = useState<AgentView>('configuracao');
  const { activeSex, selectSlot, slots } = useAgentPersonaWorkspace();

  useEffect(() => {
    const syncHash = () => {
      const hash = window.location.hash.slice(1);
      if (isAgentView(hash)) setView(hash);
    };
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const selectView = (next: AgentView) => {
    setView(next);
    const url = new URL(window.location.href);
    window.history.replaceState(null, '', `${url.pathname}${url.search}#${next}`);
  };

  const slotTabs = AGENT_SLOTS.map((slot) => ({
    id: slot.slug,
    label: SLOT_LABEL[slot.sex],
    icon: UserRound,
  }));

  return (
    <div>
      <header>
        <h1 className="flex items-center gap-3 text-h1 font-bold text-foreground">
          <Bot aria-hidden="true" className="size-7" />
          Agente
        </h1>
        <p className="mt-1 max-w-3xl text-label text-muted-foreground">
          Configure como o Coach da MOVIVO conversa no WhatsApp. Cada aluno recebe a persona do seu
          público; segurança e supervisão CREF continuam protegidas pelo sistema.
        </p>
      </header>

      <div className="mt-6">
        <AgentSummaryCard
          onOpenPersona={(step, targetSex) => {
            selectView('configuracao');
            if (targetSex) selectSlot(targetSex);
            (targetSex ? slots[targetSex] : slots[activeSex])?.goToStep(step);
          }}
        />
      </div>

      <div className="mt-6">
        <TabStrip
          label="Seções do Agente"
          idPrefix="agent"
          items={VIEWS}
          active={view}
          onSelect={selectView}
        />
      </div>

      <div
        role="tabpanel"
        id="agent-panel-configuracao"
        aria-labelledby="agent-tab-configuracao"
        className="mt-6"
        hidden={view !== 'configuracao'}
      >
        <TabStrip
          label="Personas publicadas"
          idPrefix="persona"
          items={slotTabs}
          active={slotSlug(activeSex)}
          onSelect={(slug) => {
            const target = AGENT_SLOTS.find((slot) => slot.slug === slug);
            if (target) selectSlot(target.sex);
          }}
        />
        {/*
         * As DUAS instâncias ficam montadas ao mesmo tempo; trocar de aba só troca qual
         * está visível. Renderizar condicionalmente (`{ativa && <Form/>}`) desmontaria o
         * provider da aba escondida e jogaria fora um rascunho não publicado — perda de
         * trabalho silenciosa causada por um clique de navegação.
         */}
        {AGENT_SLOTS.map((slot) => (
          <AgentPersonaProvider key={slot.sex} targetSex={slot.sex}>
            <div
              role="tabpanel"
              id={`persona-panel-${slot.slug}`}
              aria-labelledby={`persona-tab-${slot.slug}`}
              className="mt-6"
              hidden={activeSex !== slot.sex}
            >
              <AiPersonaDashboard />
            </div>
          </AgentPersonaProvider>
        ))}
      </div>
      <div
        role="tabpanel"
        id="agent-panel-faq"
        aria-labelledby="agent-tab-faq"
        className="mt-6"
        hidden={view !== 'faq'}
      >
        <AiFaqDashboard canWrite={canWriteConfig} />
      </div>
    </div>
  );
}
