'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MEAL_SLOT_LABELS,
  type FoodDay,
  type FoodDraftItem,
  type FoodLogDraft,
} from '@movivo/shared';

import { StudentNav } from '@/components/training/student-nav';
import { Button } from '@/components/ui/button';
import {
  confirmFoodLog,
  draftFromPhoto,
  draftFromText,
  getFoodDay,
  removeFoodLog,
} from '@/lib/nutrition-api';
import { TrainingApiError } from '@/lib/training-api';

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-label">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {value} / {target}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(value, target)}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
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
  const [items, setItems] = useState<FoodDraftItem[]>(draft.items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await confirmFoodLog(draft.logId, {
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
      className="flex flex-col gap-3 rounded-xl border border-primary p-4"
    >
      <h3 className="font-semibold">Confira o que entendemos · {MEAL_SLOT_LABELS[draft.meal]}</h3>
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
                  (sem correspondência na tabela)
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
                className="h-10 w-24 rounded-lg border border-border bg-card px-2 text-body"
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
        <Button type="button" disabled={busy || items.length === 0} onClick={() => void confirm()}>
          Confirmar refeição
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDiscard}>
          Descartar
        </Button>
      </div>
    </section>
  );
}

export function FoodDayView() {
  const [day, setDay] = useState<FoodDay | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<FoodLogDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setDay(await getFoodDay());
      setError('');
    } catch (caught) {
      setError(
        caught instanceof TrainingApiError && caught.status === 401
          ? 'Abra o link mais recente enviado no seu WhatsApp.'
          : 'Não foi possível carregar a alimentação agora.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4">
          {error}
        </p>
      </main>
    );
  }
  if (!day) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10" aria-busy="true">
        <p className="text-muted-foreground">Carregando sua alimentação…</p>
      </main>
    );
  }

  const target = day.targets;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
      <StudentNav current="/alimentacao" />
      <section className="flex flex-col gap-2">
        <h1 className="text-h2 font-semibold">
          {day.firstName ? `${day.firstName}, sua alimentação de hoje` : 'Sua alimentação de hoje'}
        </h1>
        <p className="text-body text-muted-foreground">
          {day.dayType === 'TRAINING' ? 'Dia de treino' : 'Dia de descanso'}. Conte o que comeu e a
          gente acompanha com você, sem cobrança.
        </p>
      </section>

      {target ? (
        <section
          aria-label="Metas do dia"
          className="flex flex-col gap-3 rounded-xl border border-border p-4"
        >
          <Progress
            label="Energia (kcal)"
            value={day.totals.energyKcal}
            target={Math.round((target.energyKcal.min + target.energyKcal.max) / 2)}
          />
          <Progress label="Proteína (g)" value={day.totals.proteinG} target={target.proteinG} />
          <Progress label="Carboidrato (g)" value={day.totals.carbsG} target={target.carbsG} />
          <Progress label="Gordura (g)" value={day.totals.fatG} target={target.fatG} />
          <Progress label="Fibras (g)" value={day.totals.fiberG} target={target.fiberG} />
        </section>
      ) : (
        <p className="text-body text-muted-foreground">
          Seu plano alimentar ainda está sendo preparado. Você já pode registrar o que come.
        </p>
      )}

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
            void removeFoodLog(id).catch(() => undefined);
          }}
        />
      ) : (
        <section
          aria-label="Registrar refeição"
          className="flex flex-col gap-3 rounded-xl border border-border p-4"
        >
          <label className="flex flex-col gap-1 text-label font-semibold">
            O que você comeu?
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ex.: almocei arroz, feijão, frango grelhado e salada"
              className="rounded-lg border border-border bg-card p-3 text-body font-normal"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={busy || text.trim().length < 2}
              onClick={() => void interpret(() => draftFromText({ text: text.trim() }))}
            >
              Registrar
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => photoInput.current?.click()}
            >
              Enviar foto do prato
            </Button>
            <input
              ref={photoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label="Foto da refeição"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void interpret(() => draftFromPhoto(file));
                event.target.value = '';
              }}
            />
          </div>
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
        <h2 className="text-h3 font-semibold">Refeições de hoje</h2>
        {day.logs.filter((l) => l.confirmed).length === 0 ? (
          <p className="text-body text-muted-foreground">Nenhuma refeição registrada ainda.</p>
        ) : (
          day.logs
            .filter((l) => l.confirmed)
            .map((log) => (
              <article
                key={log.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border p-4"
              >
                <div>
                  <h3 className="font-semibold">{MEAL_SLOT_LABELS[log.meal]}</h3>
                  <p className="text-body text-muted-foreground">
                    {log.items.map((i) => `${i.label} (${i.grams} g)`).join(', ')}
                  </p>
                  <p className="text-label text-muted-foreground">
                    ~{Math.round(log.totals.energyKcal)} kcal · {Math.round(log.totals.proteinG)} g
                    de proteína
                  </p>
                </div>
                <button
                  type="button"
                  className="text-label underline"
                  onClick={() => void removeFoodLog(log.id).then(load)}
                >
                  Apagar
                </button>
              </article>
            ))
        )}
      </section>
    </main>
  );
}
