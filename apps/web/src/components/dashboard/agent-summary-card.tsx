'use client';

/**
 * Um cartão por slot de persona, sempre visíveis, um embaixo do outro (achado 2026-09-04,
 * a pedido do fundador).
 *
 * ## Por que dois cartões, e não mais um com abas
 * Até aqui existia UM cartão-resumo (a persona da aba aberta) e a edição vivia atrás de duas
 * abas ("Persona feminina"/"Persona masculina") dentro da seção Configuração. Isso escondia
 * metade da informação por trás de um clique e obrigava a nomear cada aba com o rótulo do
 * slot. Agora os dois cartões ficam sempre visíveis (nenhuma persona fica "escondida" atrás
 * de aba), e o lápis de cada cartão abre a MESMA configuração (`AiPersonaDashboard`) **inline,
 * no lugar do resumo do próprio cartão** — mesmo padrão do lápis de edição de Protocolo
 * (`QueueDetail`): nunca modal, a tela do cartão vira a tela de edição.
 *
 * `AgentPersonaProvider` de cada slot continua montado o tempo todo (não só durante a edição):
 * fechar a edição nunca descarta um rascunho não publicado, porque quem guarda o estado é o
 * provider, não o `AiPersonaDashboard` em si.
 */
import type { BiologicalSex } from '@movivo/shared';
import { Pencil, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { AgentPersonaProvider } from './agent-persona-context';
import { AiPersonaDashboard } from './ai-persona';
import {
  AGENT_SLOTS,
  SLOT_AUDIENCE,
  SLOT_LABEL_LOWER,
  useAgentPersonaWorkspace,
} from './agent-persona-workspace';
import { ConfirmAction } from './confirm-action';
import { StatusBadge } from './control-center-table';

function pendingLabel(pending: number): string {
  return pending === 1 ? '1 alteração não publicada' : `${pending} alterações não publicadas`;
}

/**
 * Os dois cartões, empilhados. Único ponto de entrada deste arquivo — cada cartão vem com
 * seu próprio `AgentPersonaProvider` (mesmo padrão de antes: as duas instâncias ficam
 * montadas o tempo todo, nenhuma delas some da árvore por trás de uma aba).
 */
export function AgentPersonaCards() {
  return (
    <div className="space-y-6">
      {AGENT_SLOTS.map((slotDescriptor) => (
        <AgentPersonaProvider key={slotDescriptor.sex} targetSex={slotDescriptor.sex}>
          <AgentSlotCard sex={slotDescriptor.sex} />
        </AgentPersonaProvider>
      ))}
    </div>
  );
}

function AgentSlotCard({ sex }: { sex: BiologicalSex }) {
  const { slots, canWrite } = useAgentPersonaWorkspace();
  const slot = slots[sex];
  const [editing, setEditing] = useState(false);
  const pending = slot?.pending ?? 0;
  const loaded = slot !== undefined && slot.agentName !== null;
  const titleId = `agent-card-title-${sex}`;

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-petroleo text-h2 font-bold text-verde-pulso"
          >
            {slot?.agentName?.trim().charAt(0).toUpperCase() ?? '—'}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-h2 font-bold text-foreground">
              {slot?.agentName ?? 'Agente'}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={loaded ? 'positive' : 'quiet'} variant="solid">
                {loaded
                  ? 'Ativo'
                  : slot?.loading
                    ? 'Carregando'
                    : slot?.error
                      ? 'Indisponível'
                      : 'Sem configuração'}
              </StatusBadge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{SLOT_AUDIENCE[sex]}</p>
          </div>
        </div>

        {editing ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Fechar edição"
            title="Fechar edição"
            onClick={() => setEditing(false)}
          >
            <X aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Editar ${slot?.agentName ?? SLOT_LABEL_LOWER[sex]}`}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" />
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-4 border-t border-border pt-4">
          <AiPersonaDashboard />
        </div>
      ) : pending > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {/*
           * Coral é reservado a alerta real no Control Center; rascunho pendente É um
           * alerta operacional — a configuração que o fundador acha que está valendo não
           * é a que está valendo. O texto carrega o significado sozinho (WCAG 1.4.1).
           */}
          <p className="inline-flex items-center gap-2 text-label font-semibold text-foreground">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-coral" />
            {pendingLabel(pending)}
          </p>
          {canWrite && slot ? (
            <ConfirmAction
              triggerLabel="Descartar alterações"
              triggerVariant="outline"
              triggerSize="default"
              destructive
              title="Descartar as alterações não publicadas?"
              description={`Isso apaga as ${pending} alterações que você ainda não publicou na ${
                SLOT_LABEL_LOWER[sex]
              }. A ${
                slot.version === null ? 'configuração padrão' : `v${slot.version}`
              } continua valendo.`}
              confirmLabel="Descartar"
              onConfirm={async () => {
                slot.discard();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
