'use client';

import {
  AgentBlockSize,
  AgentBoldPolicy,
  AgentEmojiPolicy,
  AgentPersonaTrait,
  AgentToneDescriptor,
  CREF_HANDOFF_SUFFIX,
  type AgentPersona,
  type ForbiddenTopicVersion,
} from '@movivo/shared';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Lock, Send, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  approveForbiddenTopic,
  ControlCenterApiError,
  proposeForbiddenTopic,
  retireForbiddenTopic,
  submitForbiddenTopic,
} from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { MultiComboboxField } from './fields';

import {
  BLOCK_SIZE_LABEL,
  BOLD_LABEL,
  EMOJI_LABEL,
  FIELD_LABEL,
  PERSONA_STEPS,
  PERSONA_TRAIT_LABEL,
  describeField,
  stepOfField,
  useAgentPersona,
  type PersonaStep,
  type PersonaStepId,
} from './agent-persona-context';
import {
  SLOT_AUDIENCE,
  SLOT_LABEL,
  SLOT_LABEL_LOWER,
  useAgentPersonaWorkspace,
} from './agent-persona-workspace';
import {
  FieldError,
  FieldWarning,
  INPUT_CLASS,
  LockedBlock,
  RadioCards,
  SwitchField,
  WhatsappBubble,
} from './ai-persona-fields';
import { ConfirmAction } from './confirm-action';
import { StatusBadge } from './control-center-table';
import { ResourceState } from './control-center-ui';

const TONE_LABEL: Record<AgentPersona['toneDescriptors'][number], string> = {
  caloroso: 'Caloroso',
  direto: 'Direto',
  'bem-humorado': 'Bem-humorado',
  tecnico: 'Técnico',
  motivacional: 'Motivacional',
  sem_hype: 'Sem hype',
  informal: 'Informal',
  formal: 'Formal',
};

const TONES = Object.values(AgentToneDescriptor);
const TRAITS = Object.values(AgentPersonaTrait);
const TONE_OPTIONS = TONES.map((value) => ({ value, label: TONE_LABEL[value] }));
const TRAIT_OPTIONS = TRAITS.map((value) => ({ value, label: PERSONA_TRAIT_LABEL[value] }));

const STEP_DESCRIPTION: Record<PersonaStepId, string> = {
  identidade: 'Defina o nome e a apresentação usada nas conversas.',
  fala: 'Escolha como a agente se comporta e organiza mensagens no WhatsApp.',
  limites: 'Gerencie temas bloqueados e consulte as proteções que ninguém pode sobrescrever.',
  handoff: 'Configure a continuidade quando uma pessoa precisa assumir o atendimento.',
  revisao: 'Confira o que mudou, execute o teste e publique com rastreabilidade.',
};

const TOPIC_STATUS: Record<ForbiddenTopicVersion['status'], string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Aguardando CREF',
  APPROVED: 'Ativo',
  RETIRED: 'Retirado',
};

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function topicKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 60);
}

export function AiPersonaDashboard() {
  const state = useAgentPersona();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepButtons = useRef(new Map<PersonaStepId, HTMLButtonElement>());
  const currentIndex = PERSONA_STEPS.findIndex((item) => item.id === state.step);
  const currentStep = PERSONA_STEPS[currentIndex] ?? PERSONA_STEPS[0];

  useEffect(() => {
    titleRef.current?.focus();
    const button = stepButtons.current.get(state.step);
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    button?.scrollIntoView?.({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [state.step]);

  if (!currentStep) return null;

  if (!state.data || !state.form) {
    return (
      <ResourceState
        loading={state.loading}
        error={state.error}
        forbidden={state.forbidden}
        onRetry={() => void state.refresh()}
      />
    );
  }

  const go = (step: PersonaStep) => state.goToStep(step.id);
  const next = () => {
    if (state.erroredInStep(currentStep).length > 0) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const target = PERSONA_STEPS[currentIndex + 1];
    if (target) go(target);
  };

  return (
    <section
      className="rounded-xl border border-border bg-card"
      /*
       * O nome acessível carrega o slot: as duas instâncias do formulário ficam montadas ao
       * mesmo tempo, e duas regiões chamadas "Configuração do agente" seriam indistinguíveis
       * para quem navega pela lista de regiões.
       */
      aria-label={`Configuração da ${SLOT_LABEL_LOWER[state.targetSex]}`}
    >
      <header className="border-b border-border p-5">
        <h2 className="text-h2 font-bold text-foreground">{SLOT_LABEL[state.targetSex]}</h2>
        <p className="mt-1 text-label text-muted-foreground">{SLOT_AUDIENCE[state.targetSex]}</p>
        {state.borrowed && state.data?.servedFromSex ? (
          <FieldWarning>
            Ainda não há persona publicada para este público — por enquanto ele recebe a{' '}
            {SLOT_LABEL_LOWER[state.data.servedFromSex]}, que é o que você está vendo aqui. Publicar
            nesta aba passa a valer só para ele.
          </FieldWarning>
        ) : null}
      </header>

      {state.feedback ? (
        <p
          role="status"
          className="m-5 rounded-lg border border-border bg-secondary p-3 text-label"
        >
          {state.feedback}
        </p>
      ) : null}
      {state.writeError ? (
        <p role="alert" className="m-5 rounded-lg border border-coral bg-card p-3 text-label">
          {state.writeError}
        </p>
      ) : null}
      {!state.canWrite && !state.canApprove ? (
        <p className="m-5 flex items-center gap-2 rounded-lg border border-border bg-secondary p-3 text-label">
          <Lock aria-hidden="true" className="size-4" /> Seu acesso é somente para consulta.
        </p>
      ) : null}

      <nav
        aria-label="Etapas da configuração"
        className="overflow-x-auto border-y border-border px-5"
      >
        <ol className="flex min-w-max items-center justify-center gap-2 py-4">
          {PERSONA_STEPS.map((item, index) => {
            const Icon = item.icon;
            const active = item.id === state.step;
            const changed = state.changedInStep(item).length > 0;
            const errors = state.erroredInStep(item).length > 0;
            return (
              <li key={item.id} className="flex items-center">
                <button
                  ref={(element) => {
                    if (element) stepButtons.current.set(item.id, element);
                    else stepButtons.current.delete(item.id);
                  }}
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  aria-describedby={
                    errors || changed ? state.slotId(`step-${item.id}-status`) : undefined
                  }
                  onClick={() => go(item)}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-label',
                    'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                    active
                      ? 'border-verde-pulso bg-accent font-semibold text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full border',
                      active ? 'border-verde-pulso bg-verde-pulso text-petroleo' : 'border-border',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span>{item.label}</span>
                  {errors ? (
                    <AlertTriangle aria-hidden="true" className="size-4 text-coral" />
                  ) : null}
                  {!errors && changed ? <Check aria-hidden="true" className="size-4" /> : null}
                </button>
                {errors || changed ? (
                  <span id={state.slotId(`step-${item.id}-status`)} className="sr-only">
                    {errors ? 'Contém erro' : 'Editada'}
                  </span>
                ) : null}
                {index < PERSONA_STEPS.length - 1 ? (
                  <span aria-hidden="true" className="mx-1 h-px w-5 bg-border" />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mx-auto max-w-4xl p-5 sm:p-6">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Etapa {currentIndex + 1} de {PERSONA_STEPS.length}
        </p>
        <h2 ref={titleRef} tabIndex={-1} className="mt-1 text-h2 font-bold outline-none">
          {currentStep.label}
        </h2>
        <p className="mt-1 text-label text-muted-foreground">{STEP_DESCRIPTION[currentStep.id]}</p>

        <div className="mt-6">
          <div hidden={state.step !== 'identidade'}>
            <IdentityStep />
          </div>
          <div hidden={state.step !== 'fala'}>
            <VoiceStep />
          </div>
          <div hidden={state.step !== 'limites'}>
            <LimitsStep />
          </div>
          <div hidden={state.step !== 'handoff'}>
            <HandoffStep />
          </div>
          <div hidden={state.step !== 'revisao'}>
            <ReviewStep />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <Button
            variant="outline"
            disabled={currentIndex === 0}
            onClick={() => {
              const target = PERSONA_STEPS[currentIndex - 1];
              if (target) go(target);
            }}
          >
            <ArrowLeft aria-hidden="true" /> Voltar
          </Button>
          {currentIndex < PERSONA_STEPS.length - 1 ? (
            <Button onClick={next}>
              Próximo <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Revise e publique acima.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function IdentityStep() {
  const { form, update, canWrite, fieldErrors, slotId } = useAgentPersona();
  if (!form) return null;
  return (
    <div className="grid gap-5">
      <div>
        <label htmlFor={slotId('agent-name')} className="text-label font-semibold">
          Nome da agente
        </label>
        <p id={slotId('agent-name-help')} className="mt-1 text-xs text-muted-foreground">
          Nome usado para se apresentar e se referir a si mesma.
        </p>
        <input
          id={slotId('agent-name')}
          className={INPUT_CLASS}
          value={form.agentName}
          disabled={!canWrite}
          aria-invalid={fieldErrors.has('agentName') || undefined}
          aria-describedby={`${slotId('agent-name-help')} ${slotId('agent-name-error')}`}
          onChange={(event) => update({ agentName: event.target.value })}
        />
        {fieldErrors.get('agentName') ? (
          <FieldError id={slotId('agent-name-error')}>{fieldErrors.get('agentName')}</FieldError>
        ) : null}
      </div>
      <div>
        <label htmlFor={slotId('agent-intro')} className="text-label font-semibold">
          Como ela se apresenta
        </label>
        <p id={slotId('agent-intro-help')} className="mt-1 text-xs text-muted-foreground">
          Mensagem estática enviada ao aluno 30 minutos após o formulário. Não entra no
          prompt da IA (a identidade dela na conversa é definida nas outras abas).
        </p>
        <textarea
          id={slotId('agent-intro')}
          rows={8}
          maxLength={600}
          className={INPUT_CLASS}
          value={form.agentSelfIntro}
          disabled={!canWrite}
          aria-invalid={fieldErrors.has('agentSelfIntro') || undefined}
          aria-describedby={`${slotId('agent-intro-help')} ${slotId('agent-intro-error')}`}
          onChange={(event) => update({ agentSelfIntro: event.target.value })}
        />
        {fieldErrors.get('agentSelfIntro') ? (
          <FieldError id={slotId('agent-intro-error')}>
            {fieldErrors.get('agentSelfIntro')}
          </FieldError>
        ) : null}
      </div>
      <WhatsappBubble
        agentName={form.agentName || 'Agente'}
        text={form.agentSelfIntro || 'sua coach da MOVIVO'}
      />
    </div>
  );
}

function VoiceStep() {
  const { form, update, canWrite, fieldErrors, slotId } = useAgentPersona();
  if (!form) return null;
  return (
    <div className="grid gap-6">
      <MultiComboboxField
        id={slotId('tone-descriptors')}
        label="Tom de voz"
        items={TONE_OPTIONS}
        selected={form.toneDescriptors}
        max={4}
        disabled={!canWrite}
        invalid={fieldErrors.has('toneDescriptors')}
        errorId={slotId('tone-descriptors-error')}
        onChange={(toneDescriptors) => update({ toneDescriptors })}
      />
      {fieldErrors.get('toneDescriptors') ? (
        <FieldError id={slotId('tone-descriptors-error')}>
          {fieldErrors.get('toneDescriptors')}
        </FieldError>
      ) : null}

      <MultiComboboxField
        id={slotId('persona-traits')}
        label="Persona e comportamento"
        items={TRAIT_OPTIONS}
        selected={form.personaTraits}
        max={3}
        disabled={!canWrite}
        invalid={fieldErrors.has('personaTraits')}
        errorId={slotId('persona-traits-error')}
        onChange={(personaTraits) => update({ personaTraits })}
      />
      {fieldErrors.get('personaTraits') ? (
        <FieldError id={slotId('persona-traits-error')}>
          {fieldErrors.get('personaTraits')}
        </FieldError>
      ) : null}

      <div>
        <label htmlFor={slotId('voice-example')} className="text-label font-semibold">
          Exemplo real de fala (opcional)
        </label>
        <p id={slotId('voice-example-help')} className="mt-1 text-xs text-muted-foreground">
          Uma mensagem real, no vocabulário e na energia certos, pra calibrar a IA além dos
          rótulos acima (ex.: &quot;Salve! Bom dia, brother. Bora nessa treino de hoje.&quot;).
          A IA usa como referência de registro, nunca repete literalmente.
        </p>
        <textarea
          id={slotId('voice-example')}
          rows={2}
          maxLength={240}
          className={INPUT_CLASS}
          value={form.voiceExample ?? ''}
          disabled={!canWrite}
          aria-invalid={fieldErrors.has('voiceExample') || undefined}
          aria-describedby={`${slotId('voice-example-help')} ${slotId('voice-example-error')}`}
          onChange={(event) =>
            update({ voiceExample: event.target.value === '' ? undefined : event.target.value })
          }
        />
        {fieldErrors.get('voiceExample') ? (
          <FieldError id={slotId('voice-example-error')}>
            {fieldErrors.get('voiceExample')}
          </FieldError>
        ) : null}
      </div>

      <RadioCards
        legend="Uso de emojis"
        /* O `name` precisa do slot: dois grupos de rádio homônimos viram um só no DOM. */
        name={slotId('emoji-policy')}
        value={form.emojiPolicy}
        disabled={!canWrite}
        options={Object.values(AgentEmojiPolicy).map((value) => ({
          value,
          label: EMOJI_LABEL[value],
          hint:
            value === 'NENHUM'
              ? 'Só texto.'
              : value === 'RARO'
                ? 'No máximo um por mensagem.'
                : 'Apenas quando ajuda o tom.',
        }))}
        onChange={(emojiPolicy) => update({ emojiPolicy })}
      />

      <section className="grid gap-4 rounded-xl border border-border bg-secondary p-4">
        <div>
          <h3 className="text-label font-semibold">Formato no WhatsApp</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Preferências visuais aplicadas de verdade antes do envio.
          </p>
        </div>
        <RadioCards
          legend="Tamanho visual dos blocos"
          name={slotId('block-size')}
          value={form.formatting.blockSize}
          disabled={!canWrite}
          options={Object.values(AgentBlockSize).map((value) => ({
            value,
            label: BLOCK_SIZE_LABEL[value],
            hint:
              value === 'CURTO'
                ? 'Uma ideia breve.'
                : value === 'MEDIO'
                  ? 'Até dois blocos fáceis de ler.'
                  : 'Até três blocos quando necessário.',
          }))}
          onChange={(blockSize) => update({ formatting: { ...form.formatting, blockSize } })}
        />
        <SwitchField
          label="Permitir listas curtas"
          hint="Usa até cinco itens quando uma lista tornar a resposta mais clara."
          checked={form.formatting.allowLists}
          disabled={!canWrite}
          onChange={(allowLists) => update({ formatting: { ...form.formatting, allowLists } })}
        />
        <RadioCards
          legend="Destaques"
          name={slotId('bold-policy')}
          value={form.formatting.boldPolicy}
          disabled={!canWrite}
          options={Object.values(AgentBoldPolicy).map((value) => ({
            value,
            label: BOLD_LABEL[value],
            hint:
              value === 'NENHUM'
                ? 'Sem negrito.'
                : value === 'UMA_PALAVRA'
                  ? 'Uma palavra-chave.'
                  : 'Até três destaques.',
          }))}
          onChange={(boldPolicy) => update({ formatting: { ...form.formatting, boldPolicy } })}
        />
      </section>
    </div>
  );
}

function LimitsStep() {
  const { slotId } = useAgentPersona();
  /*
   * Temas proibidos são globais, não do slot: a mesma lista bloqueia os dois públicos, com
   * um único fluxo auditável de publicação. Por isso vêm (e são recarregados) pelo workspace — as
   * duas abas leem a mesma cópia e nenhuma aprovação fica visível só em uma delas.
   */
  const { topics, topicsLoading, refreshTopics, canWrite, canApprove } = useAgentPersonaWorkspace();
  const [label, setLabel] = useState('');
  const [phrases, setPhrases] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const currentTopics = useMemo(
    () => topics?.versions.filter((topic) => topic.current) ?? [],
    [topics],
  );

  const mutate = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setSaving(true);
      setError('');
      try {
        await action();
        setFeedback(success);
        setLabel('');
        setPhrases('');
        setActionNote('');
        await refreshTopics();
      } catch (caught) {
        setError(
          caught instanceof ControlCenterApiError
            ? caught.message
            : 'Não foi possível concluir a alteração.',
        );
      } finally {
        setSaving(false);
      }
    },
    [refreshTopics],
  );

  const parsedPhrases = phrases
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const key = topicKey(label);
  const canPropose = canWrite && key.length >= 3 && parsedPhrases.length > 0;

  return (
    <div className="grid gap-6">
      <section
        className="rounded-xl border border-border p-4"
        aria-labelledby={slotId('topics-title')}
      >
        <h3 id={slotId('topics-title')} className="text-label font-semibold">
          Temas proibidos
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          O bloqueio acontece no servidor antes de FAQ e IA. Um tema criado já entra ativo, sem
          precisar de aprovação; retirar um tema ativo exige aprovação de outro profissional CREF.
        </p>
        {feedback ? (
          <p role="status" className="mt-3 text-label">
            {feedback}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-coral p-3 text-label">
            {error}
          </p>
        ) : null}

        {(canWrite || canApprove) && currentTopics.length > 0 ? (
          <div className="mt-4">
            <label htmlFor={slotId('topic-action-note')} className="text-label font-semibold">
              Motivo da ação
            </label>
            <input
              id={slotId('topic-action-note')}
              className={INPUT_CLASS}
              value={actionNote}
              minLength={5}
              maxLength={500}
              placeholder="Obrigatório, mínimo de 5 caracteres"
              onChange={(event) => setActionNote(event.target.value)}
            />
          </div>
        ) : null}

        {topics === null && topicsLoading ? (
          <p className="mt-4 text-label text-muted-foreground">Carregando temas…</p>
        ) : topics === null ? (
          <FieldWarning>
            Os temas não puderam ser carregados. Atualize a tela antes de fazer alterações.
          </FieldWarning>
        ) : currentTopics.length === 0 ? (
          <p className="mt-4 text-label text-muted-foreground">
            Nenhum tema adicional configurado.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {currentTopics.map((topic) => (
              <li key={topic.id} className="rounded-lg border border-border bg-secondary p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-label font-semibold">{topic.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {topic.phrases.length} termos · v{topic.version} ·{' '}
                      {TOPIC_STATUS[topic.status]}
                    </p>
                  </div>
                  <StatusBadge tone={topic.status === 'APPROVED' ? 'positive' : 'quiet'}>
                    {TOPIC_STATUS[topic.status]}
                  </StatusBadge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {topic.status === 'DRAFT' && canWrite ? (
                    <Button
                      size="sm"
                      disabled={saving || actionNote.trim().length < 5}
                      onClick={() =>
                        void mutate(
                          () =>
                            submitForbiddenTopic({ topicKey: topic.topicKey, note: actionNote }),
                          'Tema enviado para aprovação CREF.',
                        )
                      }
                    >
                      Enviar para aprovação
                    </Button>
                  ) : null}
                  {topic.status === 'PENDING_APPROVAL' && canApprove ? (
                    <Button
                      size="sm"
                      disabled={saving || actionNote.trim().length < 5}
                      onClick={() =>
                        void mutate(
                          () =>
                            approveForbiddenTopic({ topicKey: topic.topicKey, note: actionNote }),
                          'Tema aprovado e ativo.',
                        )
                      }
                    >
                      <ShieldCheck aria-hidden="true" /> Aprovar
                    </Button>
                  ) : null}
                  {topic.status === 'APPROVED' && canApprove ? (
                    <ConfirmAction
                      triggerLabel="Retirar"
                      triggerVariant="outline"
                      triggerSize="sm"
                      destructive
                      disabled={saving || actionNote.trim().length < 5}
                      title={`Retirar o tema “${topic.label}”?`}
                      description="A proteção deixará de bloquear novas mensagens depois que a retirada for publicada. O histórico e a aprovação anterior serão preservados."
                      confirmLabel="Confirmar retirada"
                      onConfirm={() =>
                        mutate(
                          () =>
                            retireForbiddenTopic({ topicKey: topic.topicKey, note: actionNote }),
                          'Tema retirado.',
                        )
                      }
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <div className="mt-6 grid gap-4 border-t border-border pt-5">
            <h4 className="text-label font-semibold">Adicionar novo tema</h4>
            <div>
              <label htmlFor={slotId('topic-label')} className="text-label font-semibold">
                Nome do tema
              </label>
              <input
                id={slotId('topic-label')}
                className={INPUT_CLASS}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor={slotId('topic-phrases')} className="text-label font-semibold">
                Termos de detecção
              </label>
              <textarea
                id={slotId('topic-phrases')}
                rows={3}
                className={INPUT_CLASS}
                value={phrases}
                placeholder="Um termo por linha"
                onChange={(event) => setPhrases(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Os termos nunca são enviados ao modelo nem mostrados ao aluno.
              </p>
            </div>
            <Button
              disabled={!canPropose || saving}
              onClick={() =>
                void mutate(
                  () =>
                    proposeForbiddenTopic({
                      topicKey: key,
                      label,
                      phrases: parsedPhrases,
                      // Decisão do fundador (2026-09-04): adicionar um tema não pede mais
                      // motivo nem aprovação — o tema entra ativo direto. O contrato ainda
                      // exige `changeNote` (mín. 5 chars, auditoria de quem/quando criou),
                      // então mandamos um valor fixo em vez de expor o campo.
                      changeNote: 'Tema criado pelo painel de administração.',
                    }),
                  'Tema criado e já ativo.',
                )
              }
            >
              Criar tema
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function HandoffStep() {
  const { form, update, canWrite, fieldErrors, slotId } = useAgentPersona();
  if (!form) return null;
  return (
    <div className="grid gap-5">
      <LockedBlock
        title="Quando a passagem acontece"
        description="Pedido explícito de uma pessoa, sinal de segurança, resposta bloqueada ou falta de evidência técnica geram registro para o profissional. Emergências seguem a orientação presencial imediata, sem aguardar retorno."
      />
      <div>
        <label htmlFor={slotId('handoff-message')} className="text-label font-semibold">
          Mensagem de passagem
        </label>
        <p id={slotId('handoff-help')} className="mt-1 text-xs text-muted-foreground">
          Não prometa prazo. A menção ao profissional CREF abaixo é fixa e não pode ser removida.
        </p>
        <textarea
          id={slotId('handoff-message')}
          rows={5}
          className={INPUT_CLASS}
          value={form.humanHandoffMessage}
          disabled={!canWrite}
          aria-invalid={fieldErrors.has('humanHandoffMessage') || undefined}
          aria-describedby={
            fieldErrors.has('humanHandoffMessage')
              ? `${slotId('handoff-help')} ${slotId('handoff-error')}`
              : slotId('handoff-help')
          }
          onChange={(event) => update({ humanHandoffMessage: event.target.value })}
        />
        {fieldErrors.get('humanHandoffMessage') ? (
          <FieldError id={slotId('handoff-error')}>
            {fieldErrors.get('humanHandoffMessage')}
          </FieldError>
        ) : null}
      </div>
      <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <Lock aria-hidden="true" className="size-3.5" /> Trecho fixo: {CREF_HANDOFF_SUFFIX}
      </p>
    </div>
  );
}

function ReviewStep() {
  const { data, current, form, changedFields, publishing, publish, rollback, canPublish, canWrite, goToStep } =
    useAgentPersona();
  if (!data || !current || !form) return null;

  return (
    <div className="grid gap-6">
      <section className="rounded-xl border border-border p-4">
        <h3 className="text-label font-semibold">Alterações desta publicação</h3>
        {changedFields.length === 0 ? (
          <p className="mt-2 text-label text-muted-foreground">Nenhuma alteração pendente.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {changedFields.map((field) => (
              <li key={field} className="rounded-lg bg-secondary p-3 text-label">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <strong>{FIELD_LABEL[field]}</strong>
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() => {
                      const step = stepOfField(field);
                      if (step) goToStep(step.id);
                    }}
                  >
                    Corrigir na etapa
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Antes: {describeField(field, current)}
                </p>
                <p className="mt-1 text-xs">Depois: {describeField(field, form)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border p-4">
        <Button
          disabled={!canPublish || publishing}
          aria-busy={publishing}
          onClick={() => void publish()}
        >
          <Send aria-hidden="true" /> {publishing ? 'Salvando…' : 'Salvar e ativar'}
        </Button>
        <ul
          className="mt-3 grid gap-1 text-xs text-muted-foreground"
          aria-label="Requisitos da publicação"
        >
          <li>{changedFields.length > 0 ? '✓' : '○'} Existe ao menos uma alteração</li>
        </ul>
      </section>

      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer text-label font-semibold">Histórico de versões</summary>
        {data.versions.length === 0 ? (
          <p className="mt-3 text-label text-muted-foreground">
            Ainda vale a configuração padrão do código.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3">
            {data.versions.map((version) => (
              <li
                key={version.version}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div>
                  <p className="text-label font-semibold">
                    v{version.version}
                    {version.current ? ' · vigente' : ''} — {version.payload.agentName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dateLabel(version.createdAt)} · {version.createdBy ?? 'autor removido'} ·{' '}
                    {version.changeNote}
                  </p>
                </div>
                {canWrite && !version.current ? (
                  <ConfirmAction
                    triggerLabel="Restaurar"
                    triggerVariant="outline"
                    triggerSize="sm"
                    disabled={publishing}
                    title={`Restaurar a versão ${version.version}?`}
                    description="A configuração histórica será copiada para uma nova versão e só então passará a valer. O histórico atual não será apagado."
                    confirmLabel="Confirmar restauração"
                    onConfirm={() => rollback(version.version)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
