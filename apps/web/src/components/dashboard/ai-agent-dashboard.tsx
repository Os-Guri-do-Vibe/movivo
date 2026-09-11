'use client';

import { Bot } from 'lucide-react';

import { AgentPersonaWorkspaceProvider, useAgentPersonaWorkspace } from './agent-persona-workspace';
import { AgentPersonaCards } from './agent-summary-card';

export function AiAgentDashboard({
  canWriteConfig,
  canApproveGuardrails,
}: {
  canWriteConfig: boolean;
  canApproveGuardrails: boolean;
}) {
  return (
    <AgentPersonaWorkspaceProvider canWrite={canWriteConfig} canApprove={canApproveGuardrails}>
      <AiAgentDashboardContent />
    </AgentPersonaWorkspaceProvider>
  );
}

/**
 * Achado 2026-09-04: os dois cartões de persona (`AgentPersonaCards`) ficam sempre
 * visíveis — não há mais aba "Configuração" (a edição agora é o modal de cada cartão) nem
 * seletor "Persona feminina/masculina". A seção FAQ mudou para Base de Conhecimento.
 */
function AiAgentDashboardContent() {
  const { topics } = useAgentPersonaWorkspace();
  const pendingTopics =
    topics?.versions.filter(
      (topic) => topic.current && (topic.status === 'DRAFT' || topic.status === 'PENDING_APPROVAL'),
    ).length ?? 0;

  return (
    <div>
      <header>
        <h1 className="flex items-center gap-3 text-h1 font-bold text-foreground">
          <Bot aria-hidden="true" className="size-7 text-verde-pulso" />
          Agente
        </h1>
      </header>

      {pendingTopics > 0 ? (
        <p className="mt-6 rounded-xl border border-border bg-card p-4 text-label font-semibold text-foreground">
          {pendingTopics === 1
            ? '1 tema proibido aguarda conclusão do fluxo de aprovação'
            : `${pendingTopics} temas proibidos aguardam conclusão do fluxo de aprovação`}
        </p>
      ) : null}

      <div className="mt-6">
        <AgentPersonaCards />
      </div>
    </div>
  );
}
