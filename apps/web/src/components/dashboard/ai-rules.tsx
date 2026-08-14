'use client';

/**
 * Regras invioláveis (US-7.7 / TASK-7.7.3) — seção **somente-leitura**.
 *
 * Não existe controle de edição aqui: nem desabilitado, **ausente**. Um campo cinza
 * comunicaria "isto pode mudar, você só não pode agora"; o cadeado comunica o que é
 * verdade: estas linhas são exigência regulatória e de segurança, e não viram campo de
 * painel em nenhuma versão futura.
 *
 * O conteúdo e a justificativa de cada bloco vêm do servidor (constantes de código,
 * `PROMPT_BLOCKS`) — nada é escrito nesta tela, para o painel nunca divergir do prompt real.
 */
import { Lock } from 'lucide-react';
import { useCallback } from 'react';

import { getInviolableRules } from '@/lib/control-center-api';

import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';
import { AiGuardrailsPanel } from './ai-guardrails';

export function AiRulesDashboard({ canWrite = false }: { canWrite?: boolean }) {
  const load = useCallback((signal?: AbortSignal) => getInviolableRules(signal), []);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);

  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  const locked = data.data.blocks.filter((block) => !block.editable);

  return (
    <div>
      <SectorHeader
        title="Regras invioláveis"
        description="O que a agente nunca faz, e por quê. Estas regras estão travadas em código e não são editáveis por nenhum painel."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      <ul className="mt-6 grid gap-4">
        {locked.map((block) => (
          <li key={block.id} className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-h2 font-bold">
              <Lock aria-label="Travado em código" className="size-5 shrink-0" />
              {block.title}
            </h2>
            <p className="mt-2 text-label text-muted-foreground">{block.rationale}</p>
            <h3 className="mt-4 text-label font-semibold">Texto exato que a IA recebe</h3>
            <pre className="mt-2 overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs whitespace-pre-wrap">
              {block.content}
            </pre>
          </li>
        ))}
      </ul>
      <AiGuardrailsPanel canWrite={canWrite} />
    </div>
  );
}
