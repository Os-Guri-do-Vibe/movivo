'use client';

/**
 * Cartão-resumo do agente ativo, logo abaixo do `h1` da página "Agente".
 *
 * ## Por que está FORA das abas
 * Identidade, versão vigente e rascunho pendente valem nas duas seções (Configuração e FAQ).
 * O cartão permanece visível durante a troca, enquanto o `h1` único fica no cabeçalho da página.
 *
 * ## O que este cartão NÃO tem
 * Não há "Duplicar" nem "Novo agente". A MOVIVO opera **um** agente, por decisão de
 * arquitetura e de segurança (um prompt, um perímetro L0, uma trilha de auditoria). Botão
 * que promete capacidade inexistente é dívida de produto, não afordância.
 */
import { Clock3, History, Lock, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

import { useAgentPersona, type PersonaStepId } from './agent-persona-context';
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

export function AgentSummaryCard({
  onOpenPersona,
}: {
  /** Leva para a aba Personalidade em uma etapa específica do assistente. */
  onOpenPersona: (step: PersonaStepId) => void;
}) {
  const { data, current, changedFields, canWrite, discard, loading, error } = useAgentPersona();

  const pending = changedFields.length;
  const pendingTopics =
    data?.topics?.versions.filter(
      (topic) => topic.current && (topic.status === 'DRAFT' || topic.status === 'PENDING_APPROVAL'),
    ).length ?? 0;
  const versionLabel =
    data === null ? '—' : data.version === null ? 'Padrão do código' : `v${data.version} · vigente`;

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
            {current?.agentName.trim().charAt(0).toUpperCase() ?? '—'}
          </span>
          <div className="min-w-0">
            <h2 id="agent-card-title" className="text-h2 font-bold text-foreground">
              {current?.agentName ?? 'Agente'}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge tone={data && current ? 'positive' : 'quiet'} variant="solid">
                {data && current
                  ? 'Ativo'
                  : loading
                    ? 'Carregando'
                    : error
                      ? 'Indisponível'
                      : 'Sem configuração'}
              </StatusBadge>
              <Chip>Coach de treino · WhatsApp</Chip>
              <Chip>
                <ShieldCheck aria-hidden="true" className="size-3.5" />
                Supervisão CREF
              </Chip>
              <span className="font-mono text-xs text-muted-foreground">{versionLabel}</span>
            </div>
            {data ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 aria-hidden="true" className="size-3.5" />
                Atualizado em{' '}
                <time dateTime={data.meta.generatedAt}>
                  {updatedAtLabel(data.meta.generatedAt)}
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
            {pending === 1 ? '1 alteração não publicada' : `${pending} alterações não publicadas`}
          </p>
          {canWrite ? (
            <ConfirmAction
              triggerLabel="Descartar alterações"
              triggerVariant="outline"
              triggerSize="default"
              destructive
              title="Descartar as alterações não publicadas?"
              description={`Isso apaga as ${pending} alterações que você ainda não publicou. A ${
                data?.version === null || data === null ? 'configuração padrão' : `v${data.version}`
              } continua valendo.`}
              confirmLabel="Descartar"
              onConfirm={async () => {
                discard();
              }}
            />
          ) : null}
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
