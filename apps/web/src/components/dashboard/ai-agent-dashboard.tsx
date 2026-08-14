'use client';

/**
 * Agente (unifica Persona, Regras invioláveis, Conhecimento e FAQ num único painel).
 *
 * As quatro telas continuam sendo os componentes já existentes e já testados
 * isoladamente (`AiPersonaDashboard`, `AiRulesDashboard`, `AiKnowledgeDashboard`,
 * `AiFaqDashboard`) — este componente só adiciona a navegação por etapa por cima. Nenhuma
 * delas perde capability própria: trocar de etapa não muda o que o servidor autoriza.
 */
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { AiFaqDashboard } from './ai-faq';
import { AiKnowledgeDashboard } from './ai-knowledge';
import { AiPersonaDashboard } from './ai-persona';
import { AiRulesDashboard } from './ai-rules';

type AgentStep = 'persona' | 'regras' | 'conhecimento' | 'faq';

const STEPS: ReadonlyArray<{ id: AgentStep; label: string }> = [
  { id: 'persona', label: 'Persona & Tom de voz' },
  { id: 'regras', label: 'Regras invioláveis' },
  { id: 'conhecimento', label: 'Conhecimento (RAG)' },
  { id: 'faq', label: 'FAQ' },
];

export function AiAgentDashboard({
  canWriteConfig,
  canUploadKnowledge,
  canApproveKnowledge,
}: {
  canWriteConfig: boolean;
  canUploadKnowledge: boolean;
  canApproveKnowledge: boolean;
}) {
  const [step, setStep] = useState<AgentStep>('persona');

  return (
    <div>
      <div>
        <h1 className="text-h1 font-bold text-foreground">Agente</h1>
        <p className="mt-1 max-w-3xl text-label text-muted-foreground">
          Persona, regras invioláveis, base de conhecimento e FAQ da IA, num único lugar. Cada
          etapa publica e audita a própria configuração — trocar de etapa não muda o que fica
          gravado.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Etapas do Agente"
        className="mt-6 flex flex-wrap gap-1 border-b border-border"
      >
        {STEPS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`agent-tab-${item.id}`}
            aria-selected={step === item.id}
            aria-controls={`agent-panel-${item.id}`}
            onClick={() => setStep(item.id)}
            className={cn(
              'min-h-11 rounded-t-lg px-4 py-2 text-label font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
              step === item.id
                ? 'border-b-2 border-verde-pulso text-foreground'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`agent-panel-${step}`}
        aria-labelledby={`agent-tab-${step}`}
        className="mt-8"
      >
        {step === 'persona' ? <AiPersonaDashboard canWrite={canWriteConfig} /> : null}
        {step === 'regras' ? <AiRulesDashboard canWrite={canWriteConfig} /> : null}
        {step === 'conhecimento' ? (
          <AiKnowledgeDashboard canUpload={canUploadKnowledge} canApprove={canApproveKnowledge} />
        ) : null}
        {step === 'faq' ? <AiFaqDashboard canWrite={canWriteConfig} /> : null}
      </div>
    </div>
  );
}
