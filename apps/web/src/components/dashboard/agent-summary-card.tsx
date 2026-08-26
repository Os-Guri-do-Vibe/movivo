'use client';

/**
 * Cartão-resumo do agente ativo, logo abaixo do `h1` da página "Agente".
 *
 * ## Por que está FORA das abas
 * Identidade, versão vigente e rascunho pendente valem nas duas seções (Configuração e FAQ).
 * O cartão permanece visível durante a troca, enquanto o `h1` único fica no cabeçalho da página.
 *
 * ## Duas personas, um cartão (Sprint 11)
 * Com dois slots publicáveis, "Persona vigente (vN)" no singular passou a ser mentira. O
 * cartão continua **um só** — o espaço é o mesmo e dois cartões empurrariam as abas para
 * fora da primeira dobra — mas agora conta as duas histórias: o destaque é a persona da aba
 * ABERTA (é dela que o `h1`, o avatar e o botão de publicar falam) e uma linha de status
 * mostra os dois slots lado a lado, incluindo o que ainda não foi publicado.
 *
 * Rascunho pendente do slot escondido não vira um segundo botão "Descartar alterações" (dois
 * botões de mesmo nome acessível na mesma tela): vira um aviso com um atalho que abre aquela
 * aba, onde o descarte tem contexto.
 *
 * ## O que este cartão NÃO tem
 * Não há "Duplicar" nem "Novo agente". Os dois slots são fixos e derivam do sexo biológico
 * informado na anamnese — não são "agentes" que alguém cria à vontade. Botão que promete
 * capacidade inexistente é dívida de produto, não afordância.
 */
import type { BiologicalSex } from '@movivo/shared';
import { Clock3, History, Lock, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

import { type PersonaStepId } from './agent-persona-context';
import {
  AGENT_SLOTS,
  OTHER_SLOT,
  SLOT_LABEL,
  SLOT_LABEL_LOWER,
  useAgentPersonaWorkspace,
  type AgentSlotSummary,
} from './agent-persona-workspace';
import { ConfirmAction } from './confirm-action';
import { StatusBadge } from './control-center-table';

function updatedAtLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}

/** Estado do slot em uma frase. Distingue "publicada", "emprestada" e "nada publicado". */
function slotStatusLabel(slot: AgentSlotSummary | undefined): string {
  if (!slot) return '—';
  if (slot.version !== null) return `v${slot.version} · vigente`;
  if (slot.borrowed && slot.servedFromSex) {
    return `usa a ${SLOT_LABEL_LOWER[slot.servedFromSex]}`;
  }
  return 'padrão do código';
}

function pendingLabel(pending: number): string {
  return pending === 1 ? '1 alteração não publicada' : `${pending} alterações não publicadas`;
}

export function AgentSummaryCard({
  onOpenPersona,
}: {
  /**
   * Leva à seção Configuração numa etapa específica do assistente. `targetSex` troca a aba
   * de persona antes — usado pelo atalho do rascunho pendente do slot escondido.
   */
  onOpenPersona: (step: PersonaStepId, targetSex?: BiologicalSex) => void;
}) {
  const { activeSex, activeSlot, slots, canWrite, topics } = useAgentPersonaWorkspace();

  const otherSex = OTHER_SLOT[activeSex];
  const otherSlot = slots[otherSex];
  const pending = activeSlot?.pending ?? 0;
  const publishedSlots = AGENT_SLOTS.filter(
    (slot) => (slots[slot.sex]?.version ?? null) !== null,
  ).length;
  const pendingTopics =
    topics?.versions.filter(
      (topic) => topic.current && (topic.status === 'DRAFT' || topic.status === 'PENDING_APPROVAL'),
    ).length ?? 0;
  const loaded = activeSlot !== null && activeSlot.agentName !== null;

  return (
    <section
      aria-labelledby="agent-card-title"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-petroleo text-h2 font-bold text-verde-pulso"
          >
            {activeSlot?.agentName?.trim().charAt(0).toUpperCase() ?? '—'}
          </span>
          <div className="min-w-0">
            <h2 id="agent-card-title" className="text-h2 font-bold text-foreground">
              {activeSlot?.agentName ?? 'Agente'}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={loaded ? 'positive' : 'quiet'} variant="solid">
                {loaded
                  ? 'Ativo'
                  : activeSlot?.loading
                    ? 'Carregando'
                    : activeSlot?.error
                      ? 'Indisponível'
                      : 'Sem configuração'}
              </StatusBadge>
              <Chip>Coach de treino · WhatsApp</Chip>
              <Chip>
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                Supervisão CREF
              </Chip>
              <span className="font-mono text-xs text-muted-foreground">
                {SLOT_LABEL[activeSex]} · {slotStatusLabel(activeSlot ?? undefined)}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {publishedSlots} de {AGENT_SLOTS.length} personas publicadas —{' '}
              {AGENT_SLOTS.map(
                (slot) => `${SLOT_LABEL[slot.sex]}: ${slotStatusLabel(slots[slot.sex])}`,
              ).join(' · ')}
            </p>
            {activeSlot?.generatedAt ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 aria-hidden="true" className="size-3.5" />
                Atualizado em{' '}
                <time dateTime={activeSlot.generatedAt}>
                  {updatedAtLabel(activeSlot.generatedAt)}
                </time>
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => onOpenPersona('revisao')}>
            <History aria-hidden="true" />
            Ver histórico
          </Button>
          {canWrite ? (
            <Button onClick={() => onOpenPersona('revisao')}>Revisar e publicar</Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-label text-muted-foreground">
              <Lock aria-hidden="true" className="size-4" />
              Acesso de leitura
            </span>
          )}
        </div>
      </div>

      {pending > 0 ? (
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
          {canWrite && activeSlot ? (
            <ConfirmAction
              triggerLabel="Descartar alterações"
              triggerVariant="outline"
              triggerSize="default"
              destructive
              title="Descartar as alterações não publicadas?"
              description={`Isso apaga as ${pending} alterações que você ainda não publicou na ${
                SLOT_LABEL_LOWER[activeSex]
              }. A ${
                activeSlot.version === null ? 'configuração padrão' : `v${activeSlot.version}`
              } continua valendo.`}
              confirmLabel="Descartar"
              onConfirm={async () => {
                activeSlot.discard();
              }}
            />
          ) : null}
        </div>
      ) : null}

      {otherSlot && otherSlot.pending > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-label text-foreground">
            A {SLOT_LABEL_LOWER[otherSex]} também tem {pendingLabel(otherSlot.pending)}.
          </p>
          <Button variant="outline" onClick={() => onOpenPersona('revisao', otherSex)}>
            Abrir {SLOT_LABEL_LOWER[otherSex]}
          </Button>
        </div>
      ) : null}

      {pendingTopics > 0 ? (
        <p className="mt-4 border-t border-border pt-4 text-label font-semibold text-foreground">
          {pendingTopics === 1
            ? '1 tema proibido aguarda conclusão do fluxo de aprovação'
            : `${pendingTopics} temas proibidos aguardam conclusão do fluxo de aprovação`}
        </p>
      ) : null}
    </section>
  );
}
