'use client';

/**
 * Formulário de anamnese conversacional em 3 blocos (US-1.6, TASK-1.6.1–1.6.5).
 *
 * Consome os contratos de US-1.2/US-1.3 (`src/lib/anamnesis-api.ts`) e valida cada
 * bloco com os schemas Zod compartilhados (`@movivo/shared`) — o servidor continua a
 * fonte da verdade das regras (PAR-Q, consentimento, cifra); aqui a validação só
 * evita ida-e-volta e dá o erro campo-a-campo.
 *
 * Guardrails de linguagem (CLAUDE.md, Sofia §13) valem em toda a copy: nada de
 * "diagnóstico/tratamento/cura", nenhuma promessa de resultado, o profissional CREF
 * sempre visível, e o PAR-Q bloqueante é comunicado como encaminhamento ao
 * profissional — nunca como "você não pode treinar".
 *
 * ponytail: estado nativo do React (sem React Hook Form — não está instalado e um
 * form de 3 passos não justifica trazer a lib). Um único componente com um pequeno
 * "step machine"; os helpers puros de validação/analytics são testáveis à parte.
 */
import * as React from 'react';

import {
  anamnesisBlock1Schema,
  anamnesisBlock2Schema,
  anamnesisBlock3Schema,
  CONSENT_TEXTS,
  CONSENT_VERSIONS,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  type ParqQuestionId,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isAnalyticsEnabled } from '@/lib/env';
import {
  ApiError,
  clearToken,
  getSession,
  getStoredToken,
  patchBlock,
  recordConsents,
  startAnamnesis,
  storeToken,
  submitAnamnesis,
} from '@/lib/anamnesis-api';

type Step =
  | 'loading'
  | 'block1'
  | 'consent'
  | 'block2'
  | 'block3'
  | 'submitting'
  | 'care'
  | 'confirmation'
  | 'expired'
  | 'error';

/** Texto exibido de cada pergunta do PAR-Q (verbatim de `docs/juridico/…`, §2.1). */
const PARQ_QUESTIONS: Record<ParqQuestionId, string> = {
  Q1: 'O seu médico já disse que você tem algum problema no coração ou pressão alta?',
  Q2: 'Você sente dor no peito quando faz atividade física?',
  Q3: 'No último mês, você sentiu dor no peito mesmo sem estar se exercitando?',
  Q4: 'Você já perdeu o equilíbrio por tontura ou já desmaiou?',
  Q5: 'Você toma algum medicamento contínuo para pressão ou para o coração?',
  Q6: 'Você tem algum problema em osso, articulação ou coluna que pode piorar com atividade física?',
  Q7: 'Você está grávida ou teve bebê nas últimas semanas?',
  Q8: 'Você passou por alguma cirurgia nos últimos 6 meses?',
  Q9: 'Você sabe de algum outro motivo pelo qual não deveria praticar atividade física?',
};

const INJURY_OPTIONS = ['Ombro', 'Joelho', 'Coluna', 'Punho', 'Tornozelo'] as const;
const LOCATIONS = [
  { value: 'GYM', label: 'Academia' },
  { value: 'HOME', label: 'Em casa' },
  { value: 'BOTH', label: 'Os dois' },
] as const;
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const STEP_LABELS = ['Sobre você', 'Sua saúde', 'Sua rotina'] as const;

/**
 * Renderiza a marcação leve dos textos de consentimento: `**negrito**` vira <strong>
 * e `[rótulo](/href)` vira <a>. Não é um parser de Markdown — só o subconjunto que os
 * textos verbatim do shared usam. Mantém o texto exibido = texto registrado.
 */
function renderBold(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      return (
        <a key={i} href={link[2]} className="underline">
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function track(event: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsEnabled) return;
  void import('posthog-js').then(({ default: posthog }) => posthog.capture(event, props));
}

type ParqAnswerState = { answer: boolean | null; detail: string };

export function AnamneseForm({ goal }: { goal: string | null }) {
  const [step, setStep] = React.useState<Step>('loading');
  const [token, setToken] = React.useState<string | null>(null);
  const [apiError, setApiError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  // Bloco 1 — identificação.
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');

  // Consentimento (tela-ponte).
  const [terms, setTerms] = React.useState(false);
  const [health, setHealth] = React.useState(false);
  const [marketing, setMarketing] = React.useState(false);

  // Bloco 2 — saúde / PAR-Q.
  const [parq, setParq] = React.useState<Record<ParqQuestionId, ParqAnswerState>>(
    () =>
      Object.fromEntries(
        PARQ_QUESTION_IDS.map((id) => [id, { answer: null, detail: '' }]),
      ) as Record<ParqQuestionId, ParqAnswerState>,
  );
  const [injuries, setInjuries] = React.useState<string[]>([]);
  const [medication, setMedication] = React.useState('');

  // Bloco 3 — rotina.
  const [location, setLocation] = React.useState<'HOME' | 'GYM' | 'BOTH' | null>(null);
  const [days, setDays] = React.useState<number | null>(null);
  const [minutes, setMinutes] = React.useState('');

  // Passo atual para o evento de abandono (ref para não recriar o listener a cada tecla).
  const stepRef = React.useRef<Step>('loading');
  stepRef.current = step;

  // Inicialização: retomar sessão pelo token guardado, ou iniciar uma nova.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const existing = getStoredToken();
      try {
        if (existing) {
          const session = await getSession(existing);
          if (!alive) return;
          if (session.status === 'EXPIRED') {
            clearToken();
            setStep('expired');
            return;
          }
          if (session.status !== 'IN_PROGRESS') {
            // Já enviada: não há o que retomar; começa do zero.
            clearToken();
          } else {
            setToken(existing);
            if (session.block1) {
              setName(session.block1.name);
              setPhone(session.block1.phoneNumber);
              setEmail(session.block1.email ?? '');
            }
            if (session.block3) {
              setLocation(session.block3.location ?? null);
              setDays(session.block3.daysPerWeek);
              setMinutes(session.block3.sessionMinutes?.toString() ?? '');
            }
            setStep(
              resumeStep(session.block1 != null, session.block2Completed, session.block3 != null),
            );
            return;
          }
        }
        const started = await startAnamnesis(goal);
        if (!alive) return;
        storeToken(started.token);
        setToken(started.token);
        setStep('block1');
      } catch {
        if (alive) setStep('error');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abandono: dispara uma vez ao sair antes de submeter (Lucas/Sofia — funil).
  React.useEffect(() => {
    function onLeave() {
      const s = stepRef.current;
      if (s === 'block1' || s === 'consent' || s === 'block2' || s === 'block3') {
        track('form_abandoned', { step: s });
      }
    }
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  function zodErrors(
    issues: readonly { path: readonly PropertyKey[]; message: string }[],
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of issues) {
      const key = issue.path.map(String).join('.') || '_';
      if (!out[key]) out[key] = issue.message;
    }
    return out;
  }

  async function guard(fn: () => Promise<void>) {
    setBusy(true);
    setApiError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError) setApiError(err.message);
      else setApiError('Algo não saiu como esperado. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  function submitBlock1() {
    const parsed = anamnesisBlock1Schema.safeParse({
      name: name.trim(),
      phoneNumber: phone.trim(),
      email: email.trim() || undefined,
    });
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    if (!token) return;
    void guard(async () => {
      await patchBlock(token, 1, parsed.data);
      track('form_block_completed', { block: 1 });
      setStep('consent');
    });
  }

  function submitConsent() {
    if (!terms || !health || !token) return;
    void guard(async () => {
      await recordConsents(token, [
        { type: 'TERMS_OF_SERVICE', version: CONSENT_VERSIONS.TERMS_OF_SERVICE, accepted: true },
        { type: 'HEALTH_DATA', version: CONSENT_VERSIONS.HEALTH_DATA, accepted: true },
        { type: 'MARKETING', version: CONSENT_VERSIONS.MARKETING, accepted: marketing },
      ]);
      setStep('block2');
    });
  }

  function submitBlock2() {
    const answers = PARQ_QUESTION_IDS.map((id) => {
      const a = parq[id];
      return {
        questionId: id,
        answer: a.answer === true,
        detail: a.detail.trim() || undefined,
      };
    });
    const parsed = anamnesisBlock2Schema.safeParse({
      parq: { version: PARQ_VERSION, answers },
      injuries: injuries.length ? injuries : undefined,
      continuousMedication: medication.trim() || undefined,
    });
    const missing = PARQ_QUESTION_IDS.filter((id) => parq[id].answer === null);
    if (missing.length || !parsed.success) {
      const e = parsed.success ? {} : zodErrors(parsed.error.issues);
      if (missing.length) e._parq = 'Responda todas as perguntas antes de continuar.';
      setErrors(e);
      return;
    }
    setErrors({});
    if (!token) return;
    void guard(async () => {
      await patchBlock(token, 2, parsed.data);
      track('form_block_completed', { block: 2 });
      setStep('block3');
    });
  }

  function submitBlock3() {
    const parsed = anamnesisBlock3Schema.safeParse({
      daysPerWeek: days ?? undefined,
      sessionMinutes: minutes.trim() ? Number(minutes) : undefined,
      location: location ?? undefined,
    });
    if (!parsed.success) {
      setErrors(zodErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    if (!token) return;
    void guard(async () => {
      await patchBlock(token, 3, parsed.data);
      track('form_block_completed', { block: 3 });
      setStep('submitting');
      const result = await submitAnamnesis(token);
      if (result.requiresProfessionalReview) {
        setStep('care');
      } else {
        clearToken();
        track('form_confirmation_viewed');
        setStep('confirmation');
      }
    });
  }

  // --- render helpers -------------------------------------------------------

  const currentBlock =
    step === 'block1' ? 1 : step === 'consent' || step === 'block2' ? 2 : step === 'block3' ? 3 : 0;

  // --- steps ----------------------------------------------------------------

  if (step === 'loading' || step === 'submitting') {
    return (
      <Shell>
        <p role="status" aria-live="polite" className="text-h3 text-muted-foreground">
          {step === 'submitting' ? 'Finalizando seu cadastro…' : 'Preparando tudo…'}
        </p>
      </Shell>
    );
  }

  if (step === 'error') {
    return (
      <Shell>
        <h1 className="text-h2 font-semibold">Não conseguimos começar agora</h1>
        <p className="text-body text-muted-foreground">
          Pode ser sua conexão. Tente de novo em instantes.
        </p>
        <Button onClick={() => window.location.reload()}>Tentar de novo</Button>
      </Shell>
    );
  }

  if (step === 'expired') {
    return (
      <Shell>
        <h1 className="text-h2 font-semibold">Seu link expirou</h1>
        <p className="max-w-prose text-body text-muted-foreground">
          Por segurança, guardamos seu progresso por 72 horas. Como passou desse prazo, apagamos o
          que você tinha começado. É rápido recomeçar — e continua grátis por 7 dias, sem cartão.
        </p>
        <Button
          onClick={() => {
            clearToken();
            window.location.reload();
          }}
        >
          Recomeçar
        </Button>
      </Shell>
    );
  }

  if (step === 'care') {
    return (
      <Shell>
        <p aria-hidden="true" className="text-h1">
          🛡
        </p>
        <h1 className="text-h2 font-semibold">Antes de montar seu treino, um cuidado a mais</h1>
        <p className="max-w-prose text-body text-muted-foreground">
          Pelo que você contou, o profissional de Educação Física responsável, registrado no CREF,
          vai revisar suas respostas com atenção antes de começar. Pode ser que ele peça uma
          liberação médica — é o jeito mais seguro de treinar. Isso não é um &ldquo;não&rdquo;: é
          cuidado de verdade, sem pressa.
        </p>
        <Button asChild size="lg">
          <a href="https://wa.me/">Continuar no WhatsApp</a>
        </Button>
      </Shell>
    );
  }

  if (step === 'confirmation') {
    return (
      <Shell>
        <span
          aria-hidden="true"
          className="size-4 rounded-full bg-primary motion-safe:animate-pulse"
        />
        <h1 className="text-h2 font-semibold">Prontinho! 🎉</h1>
        <p className="max-w-prose text-body text-muted-foreground">
          O profissional de Educação Física responsável, registrado no CREF, revisará seu treino.
          Após essa etapa, o protocolo será enviado ao seu WhatsApp.
        </p>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-body font-medium">📲 Salve o número da MOVIVO agora</p>
          <p className="text-label text-muted-foreground">
            Assim você não perde a primeira mensagem.
          </p>
        </div>
        <Button asChild size="lg">
          <a href="https://wa.me/">Abrir conversa no WhatsApp</a>
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <Progress currentBlock={currentBlock} />

      {step === 'block1' && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submitBlock1();
          }}
          noValidate
        >
          <p aria-live="polite" className="text-h3">
            Prazer! Como você se chama?
          </p>
          <Field id="name" label="Seu nome" error={errors.name}>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'name-error' : undefined}
              className={inputClass}
            />
          </Field>
          <Field id="phoneNumber" label="Seu WhatsApp (com DDD e país)" error={errors.phoneNumber}>
            <input
              id="phoneNumber"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+5511999999999"
              aria-invalid={!!errors.phoneNumber}
              aria-describedby={errors.phoneNumber ? 'phoneNumber-error' : undefined}
              className={inputClass}
            />
          </Field>
          <Field id="email" label="Seu e-mail (opcional)" error={errors.email}>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
              className={inputClass}
            />
          </Field>
          <NetworkError message={apiError} />
          <Button type="submit" size="lg" disabled={busy}>
            Continuar
          </Button>
        </form>
      )}

      {step === 'consent' && (
        <div className="flex flex-col gap-5">
          <h1 className="text-h2 font-semibold">{CONSENT_TEXTS.HEALTH_DATA.title}</h1>
          <div className="flex flex-col gap-2 text-body text-muted-foreground">
            {CONSENT_TEXTS.HEALTH_DATA.body.map((p, i) => (
              <p key={i}>{renderBold(p)}</p>
            ))}
          </div>
          <a href="/privacidade" className="text-label underline">
            Ver a Política de Privacidade
          </a>

          <Checkbox
            checked={terms}
            onChange={setTerms}
            label={CONSENT_TEXTS.TERMS_OF_SERVICE.label}
          />
          <Checkbox checked={health} onChange={setHealth} label={CONSENT_TEXTS.HEALTH_DATA.label} />
          <Checkbox
            checked={marketing}
            onChange={setMarketing}
            label={CONSENT_TEXTS.MARKETING.label}
          />

          <NetworkError message={apiError} />
          <p className="flex items-center gap-2 text-label text-muted-foreground">
            <span aria-hidden="true">🔒</span> Seus dados de saúde são criptografados.
          </p>
          <Button size="lg" disabled={!terms || !health || busy} onClick={submitConsent}>
            Continuar
          </Button>
        </div>
      )}

      {step === 'block2' && (
        <div className="flex flex-col gap-6">
          <p aria-live="polite" className="text-h3">
            Algumas perguntas rápidas de segurança. Responda com sinceridade — é pra te proteger.
          </p>
          {PARQ_QUESTION_IDS.map((id) => (
            <fieldset key={id} className="flex flex-col gap-2">
              <legend className="text-body font-medium">{PARQ_QUESTIONS[id]}</legend>
              <div className="flex gap-2">
                {[
                  { v: false, label: 'Não' },
                  { v: true, label: 'Sim' },
                ].map((opt) => {
                  const selected = parq[id].answer === opt.v;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setParq((prev) => ({ ...prev, [id]: { ...prev[id], answer: opt.v } }))
                      }
                      className={cn(
                        'min-h-11 flex-1 rounded-lg border px-4 py-2 text-body font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background hover:bg-accent',
                      )}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {parq[id].answer === true && (
                <Field
                  id={`${id}-detail`}
                  label={
                    id === 'Q9' ? 'Conta pra gente o motivo' : 'Conta um pouco mais? (opcional)'
                  }
                >
                  <input
                    id={`${id}-detail`}
                    value={parq[id].detail}
                    onChange={(e) =>
                      setParq((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], detail: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                </Field>
              )}
            </fieldset>
          ))}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-body font-medium">Tem alguma lesão hoje?</legend>
            <div className="flex flex-wrap gap-2">
              {INJURY_OPTIONS.map((opt) => {
                const selected = injuries.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setInjuries((prev) =>
                        selected ? prev.filter((i) => i !== opt) : [...prev, opt],
                      )
                    }
                    className={cn(
                      'min-h-11 rounded-lg border px-4 py-2 text-label font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background',
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field id="medication" label="Usa alguma medicação contínua? (opcional)">
            <input
              id="medication"
              value={medication}
              onChange={(e) => setMedication(e.target.value)}
              className={inputClass}
            />
          </Field>

          {errors._parq && (
            <p role="alert" className="text-label text-destructive">
              {errors._parq}
            </p>
          )}
          <NetworkError message={apiError} />
          <div className="flex gap-3">
            <Button variant="outline" size="lg" onClick={() => setStep('consent')} disabled={busy}>
              Voltar
            </Button>
            <Button size="lg" className="flex-1" onClick={submitBlock2} disabled={busy}>
              Continuar
            </Button>
          </div>
        </div>
      )}

      {step === 'block3' && (
        <div className="flex flex-col gap-6">
          <p aria-live="polite" className="text-h3">
            Quase lá! Vamos ajustar seu treino à sua rotina.
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body font-medium">Onde você treina?</legend>
            <div className="flex flex-wrap gap-2">
              {LOCATIONS.map((opt) => {
                const selected = location === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setLocation(opt.value)}
                    className={cn(
                      'min-h-11 rounded-lg border px-4 py-2 text-body font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background',
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-body font-medium">
              Quantos dias por semana dá pra treinar?
            </legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => {
                const selected = days === d;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDays(d)}
                    className={cn(
                      'size-11 rounded-lg border text-body font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background',
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            {errors.daysPerWeek && (
              <p role="alert" className="text-label text-destructive">
                Escolha quantos dias você consegue treinar.
              </p>
            )}
          </fieldset>

          <Field id="minutes" label="Quanto tempo por sessão? (minutos, opcional)">
            <input
              id="minutes"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </Field>

          <NetworkError message={apiError} />
          <div className="flex gap-3">
            <Button variant="outline" size="lg" onClick={() => setStep('block2')} disabled={busy}>
              Voltar
            </Button>
            <Button size="lg" className="flex-1" onClick={submitBlock3} disabled={busy}>
              Finalizar
            </Button>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** Resolve o passo de retomada a partir do que já foi salvo (helper puro, testável). */
export function resumeStep(hasBlock1: boolean, block2Completed: boolean, hasBlock3: boolean): Step {
  if (hasBlock3 || block2Completed) return 'block3';
  if (hasBlock1) return 'consent';
  return 'block1';
}

const inputClass =
  'min-h-11 rounded-lg border border-input bg-background px-4 py-2 text-body outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

/** Barra de progresso rotulada (Sofia §9.2). `currentBlock` 0 = telas fora do funil. */
function Progress({ currentBlock }: { currentBlock: number }) {
  if (currentBlock === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex gap-2 font-mono text-label text-muted-foreground">
        {STEP_LABELS.map((label, i) => (
          <li
            key={label}
            className={cn('flex items-center gap-2', i + 1 === currentBlock && 'text-foreground')}
          >
            {i > 0 && <span aria-hidden="true">·</span>}
            {label}
          </li>
        ))}
      </ol>
      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={currentBlock}
        aria-label={`Parte ${currentBlock} de 3`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(currentBlock / 3) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body font-medium">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-label text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function NetworkError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-label"
    >
      {message}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-6 py-10">
      {children}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-body">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-primary"
      />
      <span>{renderBold(label)}</span>
    </label>
  );
}
