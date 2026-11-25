'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MEAL_SLOT_LABELS,
  type FoodLogItem,
  type MealSlot,
  type FoodDay,
  type FoodDraftItem,
  type FoodLogDraft,
} from '@movivo/shared';

import { StudentAlert, StudentGreeting, StudentShell } from '@/components/training/student-nav';
import { useTrainingApi } from '@/components/training/training-api-context';
import { Button } from '@/components/ui/button';
import { TrainingApiError } from '@/lib/training-api';

const KCAL = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Ordem do dia para as refeições registradas. */
const MEAL_ORDER = [
  'BREAKFAST',
  'MORNING_SNACK',
  'PRE_WORKOUT',
  'LUNCH',
  'AFTERNOON_SNACK',
  'POST_WORKOUT',
  'DINNER',
  'SUPPER',
] as const;

/** Um nutriente do dia: nome, barra e "120 de 160 g" embaixo (cabe em meia coluna no celular). */
function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-label font-bold text-foreground">{label}</span>
      <div
        role="progressbar"
        aria-label={`${label} (g)`}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(value, target)}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-label text-muted-foreground tabular-nums">
        {Math.round(value)} de {target} g
      </span>
    </div>
  );
}

/** Revisão do rascunho: o aluno confere o que foi entendido e corrige as porções antes de contar. */
function DraftReview({
  draft,
  onConfirmed,
  onDiscard,
}: {
  draft: FoodLogDraft;
  onConfirmed: () => void;
  onDiscard: () => void;
}) {
  const api = useTrainingApi();
  const [items, setItems] = useState<FoodDraftItem[]>(draft.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await api.confirmFoodLog(draft.logId, {
        meal: draft.meal,
        items: items
          .filter((item) => item.grams > 0)
          .map(({ matchedName: _matchedName, ...item }) => item),
      });
      onConfirmed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível confirmar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Confirmar refeição"
      className="flex flex-col gap-3 rounded-3xl border-2 border-primary bg-card p-5 shadow-sm"
    >
      <h3 className="font-extrabold">Confira o que entendemos · {MEAL_SLOT_LABELS[draft.meal]}</h3>
      {draft.needsClarification && (
        <p role="status" className="text-body">
          {draft.needsClarification}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex flex-wrap items-center gap-3">
            <span className="min-w-40 text-body">
              {item.matchedName ?? item.label}
              {item.foodItemId === null && (
                <span className="ml-2 text-label text-muted-foreground">
                  {item.estimatedPer100g
                    ? '(fora da tabela: valores estimados)'
                    : '(sem correspondência na tabela)'}
                </span>
              )}
            </span>
            <label className="flex items-center gap-1 text-label">
              <span className="sr-only">Gramas de {item.label}</span>
              <input
                inputMode="numeric"
                value={item.grams}
                onChange={(event) => {
                  const grams = Number(event.target.value.replace(/\D/g, ''));
                  setItems((prev) => prev.map((p, i) => (i === index ? { ...p, grams } : p)));
                }}
                className="min-h-11 w-24 rounded-xl border border-verde-pulso bg-card px-3 text-body"
              />
              g
            </label>
            <button
              type="button"
              className="text-label underline"
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
            >
              Tirar
            </button>
          </li>
        ))}
      </ul>
      <p className="text-label text-muted-foreground">
        As porções são estimativas: ajuste se souber o valor certo.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <Button
          type="button"
          disabled={busy || items.length === 0}
          onClick={() => void confirm()}
          className="min-h-12 rounded-xl bg-petroleo px-5 font-bold text-white hover:bg-petroleo/85"
        >
          Confirmar refeição
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </section>
  );
}

type FoodLogView = FoodDay['logs'][number];

const FIELD = 'min-h-11 rounded-xl border border-verde-pulso bg-card px-3 text-body';

/**
 * Edição de uma refeição já registrada (no site ou pelo WhatsApp): troca a refeição, corrige as
 * porções ou tira um item. Os totais são recalculados na base ao salvar.
 */
function MealEditor({
  log,
  onSaved,
  onCancel,
}: {
  log: FoodLogView;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const api = useTrainingApi();
  const [meal, setMeal] = useState<MealSlot>(log.meal);
  const [items, setItems] = useState<FoodLogItem[]>(log.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const kept = items.filter((item) => item.grams > 0);
    if (kept.length === 0) {
      setError('Deixe ao menos um alimento, ou apague a refeição.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.updateFoodLog(log.id, { meal, items: kept });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
      setBusy(false);
    }
  }

  return (
    <div
      aria-label={`Editar ${MEAL_SLOT_LABELS[log.meal]}`}
      role="group"
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1 text-label font-bold text-foreground">
        Refeição
        <span className="relative">
          <select
            value={meal}
            onChange={(event) => setMeal(event.target.value as MealSlot)}
            className={`${FIELD} w-full appearance-none pr-10 font-normal`}
          >
            {(Object.keys(MEAL_SLOT_LABELS) as MealSlot[]).map((slot) => (
              <option key={slot} value={slot}>
                {MEAL_SLOT_LABELS[slot]}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-petroleo"
          />
        </span>
      </label>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-body">{item.label}</span>
            <label className="flex items-center gap-1 text-label">
              <span className="sr-only">Gramas de {item.label}</span>
              <input
                inputMode="numeric"
                value={item.grams || ''}
                onChange={(event) => {
                  const grams = Number(event.target.value.replace(/\D/g, '').slice(0, 4));
                  setItems((prev) => prev.map((p, i) => (i === index ? { ...p, grams } : p)));
                }}
                className={`${FIELD} w-20`}
              />
              g
            </label>
            <button
              type="button"
              className="rounded-lg px-1 text-label text-muted-foreground underline hover:text-foreground"
              onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
            >
              Tirar
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="min-h-12 rounded-xl bg-petroleo font-bold text-white hover:bg-petroleo/85"
        >
          {busy ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
          className="min-h-12"
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

/** De quanto em quanto tempo a tela busca refeições novas (ex.: registradas pelo WhatsApp). */
const REFRESH_MS = 20_000;

export function FoodDayView() {
  const api = useTrainingApi();
  const [day, setDay] = useState<FoodDay | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<FoodLogDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setDay(await api.getFoodDay());
      setError('');
    } catch (caught) {
      setError(
        caught instanceof TrainingApiError && caught.status === 401
          ? 'Abra o link mais recente enviado no seu WhatsApp.'
          : 'Não foi possível carregar a alimentação agora.',
      );
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // O que o aluno registra pelo WhatsApp aparece aqui sozinho: ao voltar para a aba e, com a aba
  // aberta, a cada 20 s. Com rascunho ou edição em andamento, nada é recarregado por baixo.
  const paused = Boolean(draft) || editing !== null || busy;
  useEffect(() => {
    if (paused) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const id = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load, paused]);

  async function interpret(action: () => Promise<FoodLogDraft>) {
    setBusy(true);
    setNotice('');
    try {
      setDraft(await action());
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Não foi possível interpretar.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <StudentShell current="/alimentacao">
        <StudentAlert>{error}</StudentAlert>
      </StudentShell>
    );
  }
  if (!day) {
    return (
      <StudentShell current="/alimentacao" busy>
        <p className="py-10 text-center text-muted-foreground">Carregando sua alimentação…</p>
      </StudentShell>
    );
  }

  const target = day.targets;
  const meals = day.logs
    .filter((log) => log.confirmed)
    .sort((a, b) => MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));
  const energyGoal = target ? Math.round((target.energyKcal.min + target.energyKcal.max) / 2) : 0;
  const energyPct = energyGoal
    ? Math.min(100, Math.round((day.totals.energyKcal / energyGoal) * 100))
    : 0;
  return (
    <StudentShell current="/alimentacao">
      <StudentGreeting firstName={day.firstName} title="sua alimentação de hoje">
        Conte o que comeu e a gente acompanha com você, sem cobrança.
      </StudentGreeting>

      <section aria-label="Metas do dia" className="overflow-hidden rounded-3xl bg-card shadow-sm">
        <div className="bg-petroleo px-5 py-5 text-white">
          <p className="text-label font-bold tracking-widest text-verde-pulso uppercase">
            {day.dayType === 'TRAINING' ? 'Dia de treino' : 'Dia de descanso'}
          </p>
          <p className="mt-2 font-mono text-h1 font-extrabold tabular-nums">
            {KCAL.format(day.totals.energyKcal)}{' '}
            <span className="font-sans text-body font-normal text-white/70">kcal</span>
          </p>
          {target ? (
            <>
              <p className="text-label text-white/70">
                Meta: {KCAL.format(target.energyKcal.min)}–{KCAL.format(target.energyKcal.max)} kcal
              </p>
              <div
                role="progressbar"
                aria-label="Energia (kcal)"
                aria-valuemin={0}
                aria-valuemax={energyGoal}
                aria-valuenow={Math.min(day.totals.energyKcal, energyGoal)}
                className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/15"
              >
                <div
                  className="h-full rounded-full bg-verde-pulso"
                  style={{ width: `${energyPct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-label text-white/70">
              Seu plano alimentar ainda está sendo preparado. Você já pode registrar o que come.
            </p>
          )}
        </div>
        {target ? (
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 p-5">
            <Progress label="Proteína" value={day.totals.proteinG} target={target.proteinG} />
            <Progress label="Carboidrato" value={day.totals.carbsG} target={target.carbsG} />
            <Progress label="Gordura" value={day.totals.fatG} target={target.fatG} />
            <Progress label="Fibras" value={day.totals.fiberG} target={target.fiberG} />
          </div>
        ) : null}
      </section>

      {draft ? (
        <DraftReview
          draft={draft}
          onConfirmed={() => {
            setDraft(null);
            setText('');
            void load();
          }}
          onDiscard={() => {
            const id = draft.logId;
            setDraft(null);
            void api.removeFoodLog(id).catch(() => undefined);
          }}
        />
      ) : (
        <section
          aria-label="Registrar refeição"
          className="flex flex-col gap-3 rounded-3xl bg-card p-5 shadow-sm"
        >
          <label className="flex flex-col gap-2 font-bold">
            O que você comeu?
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ex.: almocei arroz, feijão, frango grelhado e salada"
              className="min-h-28 rounded-xl border border-verde-pulso bg-card p-3 text-body font-normal"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              disabled={busy || text.trim().length < 2}
              onClick={() => void interpret(() => api.draftFromText({ text: text.trim() }))}
              className="min-h-12 rounded-xl bg-petroleo px-5 font-bold text-white hover:bg-petroleo/85"
            >
              Registrar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => photoInput.current?.click()}
              className="min-h-12 rounded-xl border-verde-pulso bg-card px-3 font-bold text-petroleo hover:bg-muted"
            >
              Foto do prato
            </Button>
            <input
              ref={photoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Foto da refeição"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void interpret(() => api.draftFromPhoto(file));
                event.target.value = '';
              }}
            />
          </div>
          {busy ? (
            <p role="status" className="text-label text-muted-foreground">
              Entendendo o que você comeu…
            </p>
          ) : null}
          {notice && (
            <p
              role="alert"
              className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
            >
              {notice}
            </p>
          )}
        </section>
      )}

      <section aria-label="Refeições de hoje" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-h3 font-extrabold">Refeições de hoje</h2>
          <span className="text-label text-muted-foreground">
            Inclui o que você mandou no WhatsApp
          </span>
        </div>
        {meals.length === 0 ? (
          <p className="rounded-3xl bg-card p-5 text-body text-muted-foreground shadow-sm">
            Nenhuma refeição registrada ainda.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-3xl bg-card shadow-sm">
            {meals.map((log) => (
              <li key={log.id} className="p-5">
                {editing === log.id ? (
                  <MealEditor
                    log={log}
                    onCancel={() => setEditing(null)}
                    onSaved={() => {
                      setEditing(null);
                      void load();
                    }}
                  />
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-extrabold text-foreground">
                        {MEAL_SLOT_LABELS[log.meal]}
                      </h3>
                      <p className="mt-0.5 text-label text-muted-foreground">
                        {log.items.map((i) => `${i.label} (${i.grams} g)`).join(', ')}
                      </p>
                      <p className="mt-1 text-label font-bold text-petroleo">
                        ~{KCAL.format(log.totals.energyKcal)} kcal ·{' '}
                        {Math.round(log.totals.proteinG)} g de proteína
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        aria-label={`Editar ${MEAL_SLOT_LABELS[log.meal]}`}
                        className="rounded-lg px-2 py-1 text-label font-bold text-petroleo underline hover:text-foreground"
                        onClick={() => setEditing(log.id)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        aria-label={`Apagar ${MEAL_SLOT_LABELS[log.meal]}`}
                        className="rounded-lg px-2 py-1 text-label text-muted-foreground underline hover:text-foreground"
                        onClick={() => void api.removeFoodLog(log.id).then(load)}
                      >
                        Apagar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </StudentShell>
  );
}
