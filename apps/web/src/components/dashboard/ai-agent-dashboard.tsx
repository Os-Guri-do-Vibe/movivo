'use client';

import { Bot, HelpCircle, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { cn } from '@/lib/utils';

import { AgentPersonaProvider, useAgentPersona } from './agent-persona-context';
import { AgentSummaryCard } from './agent-summary-card';
import { AiFaqDashboard } from './ai-faq';
import { AiPersonaDashboard } from './ai-persona';

type AgentView = 'configuracao' | 'faq';

const VIEWS: ReadonlyArray<{ id: AgentView; label: string; icon: typeof Settings2 }> = [
  { id: 'configuracao', label: 'Configuração', icon: Settings2 },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
];

function isAgentView(value: string): value is AgentView {
  return VIEWS.some((view) => view.id === value);
}

export function AiAgentDashboard({
  canWriteConfig,
  canApproveGuardrails,
}: {
  canWriteConfig: boolean;
  canApproveGuardrails: boolean;
}) {
  return (
    <AgentPersonaProvider canWrite={canWriteConfig} canApprove={canApproveGuardrails}>
      <AiAgentDashboardContent canWriteConfig={canWriteConfig} />
    </AgentPersonaProvider>
  );
}

function AiAgentDashboardContent({ canWriteConfig }: { canWriteConfig: boolean }) {
  const [view, setView] = useState<AgentView>('configuracao');
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const { goToStep } = useAgentPersona();

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
    window.history.replaceState(null, '', `#${next}`);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % VIEWS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + VIEWS.length) % VIEWS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = VIEWS.length - 1;
    else return;
    event.preventDefault();
    const target = VIEWS[next];
    if (!target) return;
    selectView(target.id);
    tabs.current[next]?.focus();
  };

  return (
    <div>
      <header>
        <h1 className="flex items-center gap-3 text-h1 font-bold text-foreground">
          <Bot aria-hidden="true" className="size-7" />
          Agente
        </h1>
        <p className="mt-1 max-w-3xl text-label text-muted-foreground">
          Configure como o Coach da MOVIVO conversa no WhatsApp. Segurança e supervisão CREF
          continuam protegidas pelo sistema.
        </p>
      </header>

      <div className="mt-6">
        <AgentSummaryCard
          onOpenPersona={(step) => {
            selectView('configuracao');
            goToStep(step);
          }}
        />
      </div>

      <div
        role="tablist"
        aria-label="Seções do Agente"
        className="mt-6 flex gap-1 border-b border-border"
      >
        {VIEWS.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              ref={(element) => {
                tabs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`agent-tab-${item.id}`}
              tabIndex={view === item.id ? 0 : -1}
              aria-selected={view === item.id}
              aria-controls={`agent-panel-${item.id}`}
              onClick={() => selectView(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={cn(
                'flex min-h-11 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-label font-medium',
                'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                view === item.id
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

      <div
        role="tabpanel"
        id="agent-panel-configuracao"
        aria-labelledby="agent-tab-configuracao"
        className="mt-6"
        hidden={view !== 'configuracao'}
      >
        <AiPersonaDashboard />
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
