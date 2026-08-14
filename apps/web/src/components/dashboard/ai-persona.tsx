'use client';

/**
 * Persona & Tom de voz (US-7.7 / TASK-7.7.1 e 7.7.2).
 *
 * ## A regra que desenha esta tela
 * **Nenhum textarea livre alcança o prompt.** Todo campo aqui é campo curto validado por
 * regex, seleção de lista fechada ou faixa numérica — é isso que impede que alguém com
 * login no painel escreva instrução para a IA. O único campo de texto do formulário
 * (`agentSelfIntro`) é limitado a 200 caracteres e passa por detecção de injeção **no
 * servidor** antes de gravar. `changeNote` é texto livre de propósito: é metadado de
 * auditoria e **não** entra no prompt.
 *
 * A validação client-side espelha o Zod compartilhado, mas o servidor é a autoridade: um
 * valor forçado fora do ENUM/faixa é rejeitado lá, não aqui.
 */
import {
  AgentEmojiPolicy,
  AgentToneDescriptor,
  AgentTreatment,
  agentPersonaSchema,
  buildPersonaBlock,
  type AgentConfigVersion,
  type AgentPersona,
  type ConfigSimulationResponse,
  type PromptBlockView,
} from '@movivo/shared';
import {
  CheckCircle2,
  Circle,
  History,
  Lock,
  RotateCcw,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  getAgentConfigHistory,
  getAgentPersona,
  getInviolableRules,
  publishAgentPersona,
  rollbackAgentPersona,
  simulateAgentConfig,
  ControlCenterApiError,
} from '@/lib/control-center-api';

import {
  ResourceState,
  SectorHeader,
  useControlCenterResource,
  type ControlCenterMeta,
} from './control-center-ui';

const MAX_TONE = 4;

const TONE_OPTIONS: ReadonlyArray<{ value: AgentToneDescriptor; label: string }> = [
  { value: AgentToneDescriptor.CALOROSO, label: 'Caloroso' },
  { value: AgentToneDescriptor.DIRETO, label: 'Direto' },
  { value: AgentToneDescriptor.BEM_HUMORADO, label: 'Bem-humorado' },
  { value: AgentToneDescriptor.TECNICO, label: 'Técnico' },
  { value: AgentToneDescriptor.MOTIVACIONAL, label: 'Motivacional' },
  { value: AgentToneDescriptor.SEM_HYPE, label: 'Sem hype' },
  { value: AgentToneDescriptor.INFORMAL, label: 'Informal' },
  { value: AgentToneDescriptor.FORMAL, label: 'Formal' },
];

const EMOJI_OPTIONS: ReadonlyArray<{ value: AgentEmojiPolicy; label: string }> = [
  { value: AgentEmojiPolicy.NENHUM, label: 'Nenhum emoji' },
  { value: AgentEmojiPolicy.RARO, label: 'Raro (no máximo um por mensagem)' },
  { value: AgentEmojiPolicy.MODERADO, label: 'Moderado' },
];

const TREATMENT_OPTIONS: ReadonlyArray<{ value: AgentTreatment; label: string }> = [
  { value: AgentTreatment.VOCE, label: 'Trata por "você"' },
  { value: AgentTreatment.TU, label: 'Trata por "tu"' },
];

const FIELD_LABEL: Record<keyof AgentPersona, string> = {
  agentName: 'Nome da agente',
  agentSelfIntro: 'Como ela se apresenta',
  toneDescriptors: 'Tom de voz',
  emojiPolicy: 'Uso de emoji',
  maxResponseChars: 'Tamanho máximo da resposta',
  treatment: 'Tratamento',
};

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

function describe(field: keyof AgentPersona, persona: AgentPersona): string {
  const value = persona[field];
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

interface AiPersonaData {
  persona: AgentPersona;
  version: number | null;
  versions: AgentConfigVersion[];
  blocks: PromptBlockView[];
  meta: ControlCenterMeta;
}

async function loadAiPersona(signal?: AbortSignal): Promise<AiPersonaData> {
  const [persona, history, rules] = await Promise.all([
    getAgentPersona(signal),
    getAgentConfigHistory(signal),
    getInviolableRules(signal),
  ]);
  return {
    persona: persona.data.persona,
    version: persona.data.version,
    versions: history.data.versions,
    blocks: rules.data.blocks,
    meta: persona.meta,
  };
}

export function AiPersonaDashboard({ canWrite = false }: { canWrite?: boolean }) {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(loadAiPersona);
  const [draft, setDraft] = useState<AgentPersona | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [simulation, setSimulation] = useState<ConfigSimulationResponse['data'] | null>(null);

  const current = data?.persona ?? null;
  const form = draft ?? current;

  /** Toda edição derruba a revisão em curso: não se confirma um diff que já não é o atual. */
  const update = (patch: Partial<AgentPersona>) => {
    if (!form) return;
    setFeedback('');
    setWriteError('');
    setReviewing(false);
    setSimulation(null);
    setDraft({ ...form, ...patch });
  };

  const validation = useMemo(() => (form ? agentPersonaSchema.safeParse(form) : null), [form]);
  const fieldErrors = useMemo(() => {
    const map = new Map<string, string>();
    if (validation && !validation.success) {
      for (const issue of validation.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (!map.has(key)) map.set(key, issue.message);
      }
    }
    return map;
  }, [validation]);

  const changedFields = useMemo(() => {
    if (!form || !current) return [] as Array<keyof AgentPersona>;
    return (Object.keys(FIELD_LABEL) as Array<keyof AgentPersona>).filter(
      (field) => describe(field, form) !== describe(field, current),
    );
  }, [form, current]);

  const preview = useMemo(() => {
    if (!form || !data) return '';
    const persona = validation?.success ? buildPersonaBlock(validation.data) : '';
    const locked = data.blocks
      .filter((block) => !block.editable)
      .map((block) => block.content)
      .join('\n\n');
    return [persona, locked].filter(Boolean).join('\n\n');
  }, [form, data, validation]);

  const runWrite = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setPublishing(true);
      setWriteError('');
      setFeedback('');
      try {
        await action();
        setDraft(null);
        setChangeNote('');
        setReviewing(false);
        setFeedback(success);
        await refresh();
      } catch (caught) {
        setWriteError(
          caught instanceof ControlCenterApiError
            ? caught.message
            : 'Não foi possível concluir a publicação.',
        );
      } finally {
        setPublishing(false);
      }
    },
    [refresh],
  );

  const runSimulation = useCallback(async () => {
    if (!validation?.success) return;
    setSimulating(true);
    setWriteError('');
    setSimulation(null);
    try {
      const response = await simulateAgentConfig({ kind: 'PERSONA', candidate: validation.data });
      setSimulation(response.data);
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível executar o simulador.',
      );
    } finally {
      setSimulating(false);
    }
  }, [validation]);

  if (!data || !form) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  const canPublish =
    canWrite &&
    validation?.success === true &&
    changedFields.length > 0 &&
    changeNote.length >= 5 &&
    simulation?.passed === true;

  return (
    <div>
      <SectorHeader
        title="Persona e tom de voz"
        description="Como a agente se apresenta e conversa com o aluno. Só a forma da conversa é editável aqui — o que ela pode ou não fazer está em Regras invioláveis."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      {feedback ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-border bg-secondary p-3 text-label"
        >
          {feedback}
        </p>
      ) : null}
      {writeError ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {writeError}
        </p>
      ) : null}
      {!canWrite ? (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-secondary p-3 text-label">
          <Lock aria-hidden="true" className="size-4" />
          Seu acesso é de leitura: você vê a configuração e o histórico, mas não publica.
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="persona-form"
        >
          <h2 id="persona-form" className="text-h2 font-bold">
            Configuração
          </h2>
          <p className="mt-2 text-label text-muted-foreground">
            Versão vigente: {data.version === null ? 'padrão do código' : `v${data.version}`}
          </p>

          <div className="mt-4 grid gap-4">
            <div>
              <label className="text-label font-semibold" htmlFor="agentName">
                {FIELD_LABEL.agentName}
              </label>
              <input
                id="agentName"
                className={INPUT_CLASS}
                value={form.agentName}
                maxLength={20}
                disabled={!canWrite}
                aria-describedby="agentName-help"
                onChange={(event) => update({ agentName: event.target.value })}
              />
              <p id="agentName-help" className="mt-1 text-xs text-muted-foreground">
                2 a 20 letras, sem número ou símbolo.
              </p>
              {fieldErrors.get('agentName') ? (
                <p role="alert" className="mt-1 text-xs text-coral">
                  {fieldErrors.get('agentName')}
                </p>
              ) : null}
            </div>

            <div>
              <label className="text-label font-semibold" htmlFor="agentSelfIntro">
                {FIELD_LABEL.agentSelfIntro}
              </label>
              <input
                id="agentSelfIntro"
                className={INPUT_CLASS}
                value={form.agentSelfIntro}
                maxLength={200}
                disabled={!canWrite}
                aria-describedby="agentSelfIntro-help"
                onChange={(event) => update({ agentSelfIntro: event.target.value })}
              />
              <p id="agentSelfIntro-help" className="mt-1 text-xs text-muted-foreground">
                Até 200 caracteres ({form.agentSelfIntro.length}/200). Frase de apresentação, não
                instrução — o servidor recusa texto que tente comandar a IA.
              </p>
              {fieldErrors.get('agentSelfIntro') ? (
                <p role="alert" className="mt-1 text-xs text-coral">
                  {fieldErrors.get('agentSelfIntro')}
                </p>
              ) : null}
            </div>

            <fieldset disabled={!canWrite}>
              <legend className="text-label font-semibold">
                {FIELD_LABEL.toneDescriptors} (até {MAX_TONE})
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {TONE_OPTIONS.map((option) => {
                  const checked = form.toneDescriptors.includes(option.value);
                  const blocked = !checked && form.toneDescriptors.length >= MAX_TONE;
                  return (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-label"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() =>
                          update({
                            toneDescriptors: checked
                              ? form.toneDescriptors.filter((tone) => tone !== option.value)
                              : [...form.toneDescriptors, option.value],
                          })
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
              {fieldErrors.get('toneDescriptors') ? (
                <p role="alert" className="mt-1 text-xs text-coral">
                  {fieldErrors.get('toneDescriptors')}
                </p>
              ) : null}
            </fieldset>

            <div>
              <label className="text-label font-semibold" htmlFor="emojiPolicy">
                {FIELD_LABEL.emojiPolicy}
              </label>
              <select
                id="emojiPolicy"
                className={INPUT_CLASS}
                value={form.emojiPolicy}
                disabled={!canWrite}
                onChange={(event) =>
                  update({ emojiPolicy: event.target.value as AgentEmojiPolicy })
                }
              >
                {EMOJI_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-label font-semibold" htmlFor="treatment">
                {FIELD_LABEL.treatment}
              </label>
              <select
                id="treatment"
                className={INPUT_CLASS}
                value={form.treatment}
                disabled={!canWrite}
                onChange={(event) => update({ treatment: event.target.value as AgentTreatment })}
              >
                {TREATMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-label font-semibold" htmlFor="maxResponseChars">
                {FIELD_LABEL.maxResponseChars}
              </label>
              <input
                id="maxResponseChars"
                type="number"
                min={200}
                max={1200}
                step={50}
                className={INPUT_CLASS}
                value={form.maxResponseChars}
                disabled={!canWrite}
                onChange={(event) => update({ maxResponseChars: Number(event.target.value) })}
              />
              <p className="mt-1 text-xs text-muted-foreground">Entre 200 e 1200 caracteres.</p>
              {fieldErrors.get('maxResponseChars') ? (
                <p role="alert" className="mt-1 text-xs text-coral">
                  {fieldErrors.get('maxResponseChars')}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <section
          className="rounded-xl border border-border bg-card p-5"
          aria-labelledby="prompt-preview"
        >
          <h2 id="prompt-preview" className="text-h2 font-bold">
            Preview do prompt
          </h2>
          <p className="mt-2 text-label text-muted-foreground">
            É exatamente o texto que a IA recebe. A primeira parte muda com a sua edição; o restante
            é travado.
          </p>
          <pre className="mt-4 max-h-[28rem] overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs whitespace-pre-wrap">
            {preview || 'Corrija os campos inválidos para ver o preview.'}
          </pre>
        </section>
      </div>

      {canWrite ? (
        <section
          className="mt-6 rounded-xl border border-border bg-card p-5"
          aria-labelledby="simulation-title"
        >
          <h2 id="simulation-title" className="flex items-center gap-2 text-h2 font-bold">
            <ShieldCheck aria-hidden="true" className="size-5" /> Simulador obrigatório
          </h2>
          <p className="mt-2 text-label text-muted-foreground">
            A configuração candidata precisa passar pelas quatro etapas abaixo. O servidor repete
            este gate no momento da publicação.
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2">
            {(
              simulation?.checks ?? [
                { id: 'SCHEMA', title: 'Contrato fechado e proteção contra instruções' },
                { id: 'GOLDEN_INPUT', title: 'Golden set de entrada e roteamento seguro' },
                { id: 'GOLDEN_OUTPUT', title: 'Golden set de linguagem e resposta' },
                { id: 'PROMPT_INTEGRITY', title: 'Integridade dos blocos invioláveis' },
              ]
            ).map((check, index) => {
              const passed = 'passed' in check ? check.passed : null;
              const Icon = passed === true ? CheckCircle2 : passed === false ? XCircle : Circle;
              return (
                <li key={check.id} className="rounded-lg border border-border p-4">
                  <p className="flex items-center gap-2 text-label font-semibold">
                    <Icon
                      aria-hidden="true"
                      className={
                        passed === true
                          ? 'size-4 text-verde-pulso'
                          : passed === false
                            ? 'size-4 text-coral'
                            : 'size-4 text-muted-foreground'
                      }
                    />
                    Etapa {index + 1} · {check.title}
                  </p>
                  {'cases' in check ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {check.cases} casos ·{' '}
                      {check.failures.length === 0
                        ? 'aprovado'
                        : `${check.failures.length} falha(s)`}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <Button
            className="mt-4"
            variant="outline"
            disabled={simulating || validation?.success !== true || changedFields.length === 0}
            onClick={() => void runSimulation()}
          >
            <ShieldCheck aria-hidden="true" />
            {simulating ? 'Executando…' : 'Executar as 4 etapas'}
          </Button>
        </section>
      ) : null}

      {canWrite ? (
        <section
          className="mt-6 rounded-xl border border-border bg-card p-5"
          aria-labelledby="publish-title"
        >
          <h2 id="publish-title" className="text-h2 font-bold">
            Publicar
          </h2>
          <label className="mt-3 block text-label font-semibold" htmlFor="changeNote">
            Motivo da mudança
          </label>
          <input
            id="changeNote"
            className={INPUT_CLASS}
            value={changeNote}
            maxLength={500}
            aria-describedby="changeNote-help"
            onChange={(event) => {
              setChangeNote(event.target.value);
              setReviewing(false);
            }}
          />
          <p id="changeNote-help" className="mt-1 text-xs text-muted-foreground">
            Mínimo de 5 caracteres. Fica no histórico e na trilha de auditoria — não vai para o
            prompt.
          </p>

          {changedFields.length === 0 ? (
            <p className="mt-3 text-label text-muted-foreground">
              Nenhuma alteração pendente em relação à versão vigente.
            </p>
          ) : null}

          {changedFields.length > 0 && !simulation?.passed ? (
            <p className="mt-3 text-label text-muted-foreground">
              Execute o simulador acima para liberar a publicação.
            </p>
          ) : null}

          {reviewing && validation?.success ? (
            <div className="mt-4 rounded-lg border border-border bg-secondary p-4">
              <h3 className="text-label font-semibold">O que muda nesta publicação</h3>
              <ul className="mt-2 grid gap-2">
                {changedFields.map((field) => (
                  <li key={field} className="text-label">
                    <span className="font-semibold">{FIELD_LABEL[field]}:</span>{' '}
                    <span className="text-muted-foreground line-through">
                      {current ? describe(field, current) : '—'}
                    </span>{' '}
                    → <span>{describe(field, validation.data)}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-4"
                disabled={publishing}
                onClick={() =>
                  void runWrite(
                    () => publishAgentPersona({ payload: validation.data, changeNote }),
                    'Publicado. A nova persona passa a valer em até 60 segundos, sem deploy.',
                  )
                }
              >
                <Send aria-hidden="true" />
                {publishing ? 'Publicando…' : 'Confirmar publicação'}
              </Button>
            </div>
          ) : (
            <Button className="mt-4" disabled={!canPublish} onClick={() => setReviewing(true)}>
              Revisar e publicar
            </Button>
          )}
        </section>
      ) : null}

      <section
        className="mt-6 rounded-xl border border-border bg-card p-5"
        aria-labelledby="history-title"
      >
        <h2 id="history-title" className="flex items-center gap-2 text-h2 font-bold">
          <History aria-hidden="true" className="size-5" /> Histórico de versões
        </h2>
        {data.versions.length === 0 ? (
          <p className="mt-2 text-label text-muted-foreground">
            Nenhuma versão publicada ainda — a IA responde com a persona padrão do código.
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
                  <p className="text-xs text-muted-foreground">
                    {dateLabel(version.createdAt)} · {version.createdBy ?? 'autor removido'} ·{' '}
                    {version.changeNote}
                  </p>
                </div>
                {canWrite && !version.current ? (
                  <Button
                    variant="outline"
                    disabled={publishing}
                    onClick={() =>
                      void runWrite(
                        () =>
                          rollbackAgentPersona({
                            targetVersion: version.version,
                            changeNote: `Rollback para a versão ${version.version}`,
                          }),
                        `Rollback publicado a partir da v${version.version}. Vale em até 60 segundos.`,
                      )
                    }
                  >
                    <RotateCcw aria-hidden="true" />
                    Voltar para esta versão
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
