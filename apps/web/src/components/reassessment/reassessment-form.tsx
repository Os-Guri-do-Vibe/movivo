'use client';

import { useEffect, useState } from 'react';

import {
  MEASUREMENT_BOUNDS,
  MEASUREMENT_LABELS,
  MEASUREMENT_UNITS,
  type CycleReassessmentAnswers,
  type CycleReassessmentView,
  type DaySlot,
  type MeasurementInput,
  type MeasurementKind,
  type Weekday,
} from '@movivo/shared';

import { Scale } from '@/components/training/check-in-fields';
import { StudentNav } from '@/components/training/student-nav';
import { Button } from '@/components/ui/button';
import {
  deleteReassessmentPhoto,
  getReassessment,
  submitReassessment,
  uploadReassessmentPhoto,
  type ReassessmentAngle,
} from '@/lib/reassessment-api';
import { TrainingApiError } from '@/lib/training-api';

const KINDS: readonly MeasurementKind[] = [
  'WEIGHT',
  'WAIST',
  'HIP',
  'CHEST',
  'ARM',
  'THIGH',
  'CALF',
  'BODY_FAT_PERCENT',
];

const LOAD_OPTIONS: ReadonlyArray<{
  value: CycleReassessmentAnswers['phase']['trainingLoad'];
  label: string;
}> = [
  { value: 'TOO_EASY', label: 'Fácil demais' },
  { value: 'ADEQUATE', label: 'No ponto certo' },
  { value: 'TOO_HARD', label: 'Pesado demais' },
];

const field = 'rounded-lg border border-border bg-card px-3 text-body';

const ANGLES: ReadonlyArray<{ angle: ReassessmentAngle; label: string }> = [
  { angle: 'FRONT', label: 'Frente' },
  { angle: 'RIGHT', label: 'Lado direito' },
  { angle: 'BACK', label: 'Costas' },
  { angle: 'LEFT', label: 'Lado esquerdo' },
];

/** Fotos do corpo: as mesmas posições do cadastro, para a equipe comparar o começo com o agora. */
function PhotosSection({
  reassessmentId,
  allowed,
  initial,
}: {
  reassessmentId: string;
  allowed: boolean;
  initial: readonly ReassessmentAngle[];
}) {
  const [sent, setSent] = useState<ReadonlySet<ReassessmentAngle>>(new Set(initial));
  const [busy, setBusy] = useState<ReassessmentAngle | null>(null);
  const [message, setMessage] = useState('');

  async function choose(angle: ReassessmentAngle, file: File | undefined) {
    if (!file) return;
    setBusy(angle);
    setMessage('');
    try {
      await uploadReassessmentPhoto(reassessmentId, angle, file);
      setSent((prev) => new Set(prev).add(angle));
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível enviar a foto.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(angle: ReassessmentAngle) {
    setBusy(angle);
    setMessage('');
    try {
      await deleteReassessmentPhoto(reassessmentId, angle);
      setSent((prev) => {
        const next = new Set(prev);
        next.delete(angle);
        return next;
      });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Não foi possível remover a foto.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <h2 className="text-body font-semibold">Fotos do corpo (opcional)</h2>
      {allowed ? (
        <>
          <p className="text-label text-muted-foreground">
            Tire no mesmo horário e nas mesmas condições das fotos do cadastro: corpo inteiro, luz
            de frente, fundo liso, celular na altura do umbigo a uns 2 metros, em pé e relaxado. Com
            elas a gente compara o começo com o agora. As fotos ficam criptografadas e só a equipe
            responsável vê.
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ANGLES.map(({ angle, label }) => (
              <li key={angle} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <span className="text-label font-semibold">{label}</span>
                {sent.has(angle) ? (
                  <>
                    <span role="status" className="text-xs text-primary">
                      Foto enviada
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void remove(angle)}
                    >
                      Remover
                    </Button>
                  </>
                ) : (
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    <span className="sr-only">{`Foto: ${label}`}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      aria-label={`Foto: ${label}`}
                      disabled={busy !== null}
                      onChange={(event) => void choose(angle, event.target.files?.[0])}
                    />
                  </label>
                )}
              </li>
            ))}
          </ul>
          {message && (
            <p role="alert" className="text-label text-destructive">
              {message}
            </p>
          )}
        </>
      ) : (
        <p className="text-label text-muted-foreground">
          Você não autorizou o uso de fotos no cadastro. Se quiser incluir as fotos na reavaliação,
          é só pedir pelo WhatsApp que a gente envia o link de autorização.
        </p>
      )}
    </section>
  );
}

function localToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function methodOf(kind: MeasurementKind): MeasurementInput['method'] {
  if (kind === 'WEIGHT') return 'SCALE';
  if (kind === 'BODY_FAT_PERCENT') return 'ESTIMATED';
  return 'SELF_TAPE';
}

const WEEKDAY_OPTIONS: ReadonlyArray<readonly [Weekday, string]> = [
  ['MON', 'Seg'],
  ['TUE', 'Ter'],
  ['WED', 'Qua'],
  ['THU', 'Qui'],
  ['FRI', 'Sex'],
  ['SAT', 'Sáb'],
  ['SUN', 'Dom'],
];
const SLOT_OPTIONS: ReadonlyArray<readonly [DaySlot | null, string]> = [
  ['MORNING', 'Manhã'],
  ['AFTERNOON', 'Tarde'],
  ['EVENING', 'Noite'],
  [null, 'Varia'],
];

function Chip({
  label,
  pressed,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`h-11 min-w-14 rounded-full border px-4 text-label ${
        pressed ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
      }`}
    >
      {label}
    </button>
  );
}

function YesNo({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <fieldset>
      <legend className="text-label font-semibold">{legend}</legend>
      <div className="mt-2 flex gap-2" role="radiogroup" aria-label={legend}>
        {[
          { label: 'Sim', value: true },
          { label: 'Não', value: false },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-4 py-2 text-label ${value === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Notes({
  label,
  value,
  onChange,
  max,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-label">
      <span className="font-semibold">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={max}
        rows={rows}
        className={`${field} py-2`}
      />
    </label>
  );
}

/**
 * Reavaliação de fim de ciclo: perguntas úteis e avaliativas que os agentes cruzam com o começo
 * do acompanhamento para montar o próximo ciclo de treino e de alimentação.
 */
export function ReassessmentForm() {
  const [view, setView] = useState<CycleReassessmentView | null | undefined>(undefined);
  const [measures, setMeasures] = useState<Partial<Record<MeasurementKind, string>>>({});
  const [overall, setOverall] = useState<number | null>(null);
  const [trainingLoad, setTrainingLoad] =
    useState<CycleReassessmentAnswers['phase']['trainingLoad']>('ADEQUATE');
  const [foodPlanFit, setFoodPlanFit] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [recovery, setRecovery] = useState<number | null>(null);
  const [whatWorked, setWhatWorked] = useState('');
  const [whatDidNot, setWhatDidNot] = useState('');
  const [routineChanged, setRoutineChanged] = useState<boolean | null>(null);
  const [weekdays, setWeekdays] = useState<Weekday[]>([]);
  const [slot, setSlot] = useState<DaySlot | null>(null);
  const [sessionMinutes, setSessionMinutes] = useState('');
  const [routineNotes, setRoutineNotes] = useState('');
  const [sameGoal, setSameGoal] = useState<boolean | null>(null);
  const [goalNotes, setGoalNotes] = useState('');
  const [newPain, setNewPain] = useState<boolean | null>(null);
  const [newCondition, setNewCondition] = useState<boolean | null>(null);
  const [healthNotes, setHealthNotes] = useState('');
  const [foodDifficulties, setFoodDifficulties] = useState('');
  const [newRestrictions, setNewRestrictions] = useState('');
  const [freeText, setFreeText] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getReassessment()
      .then(setView)
      .catch((caught: unknown) => {
        setError(
          caught instanceof TrainingApiError && caught.status === 401
            ? 'Abra o link mais recente enviado no seu WhatsApp.'
            : 'Não foi possível carregar a reavaliação agora.',
        );
      });
  }, []);

  function buildMeasurements(): MeasurementInput[] | string {
    const measuredOn = localToday();
    const out: MeasurementInput[] = [];
    for (const kind of KINDS) {
      const raw = (measures[kind] ?? '').replace(',', '.').trim();
      if (raw === '') continue;
      const value = Number(raw);
      const [min, max] = MEASUREMENT_BOUNDS[kind];
      if (!Number.isFinite(value) || value < min || value > max) {
        return `${MEASUREMENT_LABELS[kind]}: informe um valor entre ${min} e ${max} ${MEASUREMENT_UNITS[kind]}.`;
      }
      out.push({ kind, value, method: methodOf(kind), measuredOn });
    }
    return out;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!view) return;
    const measurements = buildMeasurements();
    if (typeof measurements === 'string') {
      setError(measurements);
      return;
    }
    if (
      [overall, foodPlanFit, energy, sleep, stress, recovery].some((v) => v === null) ||
      [routineChanged, sameGoal, newPain, newCondition].some((v) => v === null)
    ) {
      setError('Responda as notas e as perguntas de sim ou não para concluir.');
      return;
    }
    const minutes = sessionMinutes.trim() === '' ? null : Number(sessionMinutes);
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 10 || minutes > 240)) {
      setError('Minutos por sessão: de 10 a 240.');
      return;
    }
    if (routineChanged === true && weekdays.length === 0) {
      setError('Marque os dias da semana em que você consegue treinar agora.');
      return;
    }
    const answers: CycleReassessmentAnswers = {
      measurements,
      phase: {
        overall: overall ?? 3,
        trainingLoad,
        foodPlanFit: foodPlanFit ?? 3,
        energy: energy ?? 3,
        sleep: sleep ?? 3,
        stress: stress ?? 3,
        recovery: recovery ?? 3,
      },
      whatWorked: whatWorked.trim(),
      whatDidNot: whatDidNot.trim(),
      routine: {
        changed: routineChanged === true,
        daysPerWeek: routineChanged ? weekdays.length : null,
        sessionMinutes: routineChanged ? minutes : null,
        notes: routineNotes.trim(),
        weekdays: routineChanged ? weekdays : [],
        slot: routineChanged ? slot : null,
      },
      goals: { stillTheSame: sameGoal === true, notes: goalNotes.trim() },
      health: {
        newPainOrInjury: newPain === true,
        newCondition: newCondition === true,
        notes: healthNotes.trim(),
      },
      nutrition: {
        difficulties: foodDifficulties.trim(),
        newRestrictions: newRestrictions.trim(),
      },
      freeText: freeText.trim(),
    };
    setBusy(true);
    setError('');
    try {
      await submitReassessment(view.id, answers);
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível enviar.');
    } finally {
      setBusy(false);
    }
  }

  const open = view?.status === 'SENT';

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
      <StudentNav current="/hoje" />
      <h1 className="text-h2 font-semibold">Reavaliação do ciclo</h1>
      {error && (
        <p role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl border border-primary p-4">
          Recebi tudo. Agora a equipe compara o começo com o agora e monta o seu próximo ciclo de
          treino e de alimentação. Eu te aviso por aqui quando estiver pronto.
        </p>
      )}
      {view === undefined && !error && <p className="text-muted-foreground">Carregando…</p>}
      {view === null && !done && (
        <p className="text-body text-muted-foreground">
          Não há reavaliação aberta agora. A gente avisa no WhatsApp quando o seu ciclo terminar.
        </p>
      )}
      {view && !open && !done && (
        <p className="text-body text-muted-foreground">
          Você já respondeu a reavaliação deste ciclo. O próximo protocolo está a caminho.
        </p>
      )}
      {view && open && !done && (
        <form onSubmit={submit} className="flex flex-col gap-8">
          <p className="text-body text-muted-foreground">
            {view.firstName ? `${view.firstName}, ` : ''}conta pra gente como foi essa fase. Com o
            que você responder e com tudo que já registrou, a gente compara o começo com o agora e
            monta o próximo ciclo.
          </p>

          <section className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <h2 className="text-body font-semibold">Seu corpo agora</h2>
            <p className="text-label text-muted-foreground">
              Preencha o que conseguir medir hoje, de manhã e em jejum se puder. Pode deixar em
              branco o que não tiver.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {KINDS.map((kind) => (
                <label key={kind} className="flex flex-col gap-1 text-label">
                  {MEASUREMENT_LABELS[kind]} ({MEASUREMENT_UNITS[kind]})
                  <input
                    inputMode="decimal"
                    value={measures[kind] ?? ''}
                    onChange={(event) =>
                      setMeasures((prev) => ({ ...prev, [kind]: event.target.value }))
                    }
                    className={`${field} h-11`}
                  />
                </label>
              ))}
            </div>
          </section>

          <PhotosSection
            reassessmentId={view.id}
            allowed={view.photos.allowed}
            initial={view.photos.angles}
          />

          <section className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <h2 className="text-body font-semibold">Como foi a fase</h2>
            <Scale
              legend="No geral"
              hint="1 = muito ruim, 5 = excelente"
              value={overall}
              onChange={setOverall}
            />
            <fieldset>
              <legend className="text-label font-semibold">Os treinos foram</legend>
              <div
                className="mt-2 flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Os treinos foram"
              >
                {LOAD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={trainingLoad === option.value}
                    onClick={() => setTrainingLoad(option.value)}
                    className={`rounded-lg border px-3 py-2 text-label ${trainingLoad === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <Scale
              legend="O plano alimentar coube na sua rotina"
              hint="1 = nada, 5 = totalmente"
              value={foodPlanFit}
              onChange={setFoodPlanFit}
            />
            <Scale
              legend="Disposição no dia a dia"
              hint="1 = sem energia, 5 = ótima"
              value={energy}
              onChange={setEnergy}
            />
            <Scale legend="Sono" hint="1 = péssimo, 5 = ótimo" value={sleep} onChange={setSleep} />
            <Scale
              legend="Estresse"
              hint="1 = tranquilo, 5 = muito estressado"
              value={stress}
              onChange={setStress}
            />
            <Scale
              legend="Recuperação entre os treinos"
              hint="1 = sempre cansado, 5 = sempre recuperado"
              value={recovery}
              onChange={setRecovery}
            />
            <Notes
              label="O que funcionou melhor?"
              value={whatWorked}
              onChange={setWhatWorked}
              max={600}
            />
            <Notes
              label="O que atrapalhou ou não funcionou?"
              value={whatDidNot}
              onChange={setWhatDidNot}
              max={600}
            />
          </section>

          <section className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <h2 className="text-body font-semibold">Sua rotina e seus objetivos</h2>
            <YesNo
              legend="A sua rotina mudou?"
              value={routineChanged}
              onChange={setRoutineChanged}
            />
            {routineChanged && (
              <>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-label">Em quais dias você consegue treinar agora?</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAY_OPTIONS.map(([day, label]) => (
                      <Chip
                        key={day}
                        label={label}
                        pressed={weekdays.includes(day)}
                        onToggle={() =>
                          setWeekdays((current) =>
                            current.includes(day)
                              ? current.filter((d) => d !== day)
                              : [...current, day],
                          )
                        }
                      />
                    ))}
                  </div>
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-label">Em que período do dia?</legend>
                  <div className="flex flex-wrap gap-2">
                    {SLOT_OPTIONS.map(([value, label]) => (
                      <Chip
                        key={label}
                        label={label}
                        pressed={slot === value}
                        onToggle={() => setSlot(value)}
                      />
                    ))}
                  </div>
                </fieldset>
                <div className="flex flex-wrap gap-3">
                  <label className="flex flex-col gap-1 text-label">
                    Minutos por sessão
                    <input
                      inputMode="numeric"
                      value={sessionMinutes}
                      onChange={(event) => setSessionMinutes(event.target.value)}
                      className={`${field} h-11 w-28`}
                    />
                  </label>
                </div>
                <Notes
                  label="O que mudou?"
                  value={routineNotes}
                  onChange={setRoutineNotes}
                  max={400}
                  rows={2}
                />
              </>
            )}
            <YesNo
              legend="O seu objetivo continua o mesmo?"
              value={sameGoal}
              onChange={setSameGoal}
            />
            {sameGoal === false && (
              <Notes
                label="Qual é o objetivo agora?"
                value={goalNotes}
                onChange={setGoalNotes}
                max={400}
                rows={2}
              />
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-xl border border-border p-4">
            <h2 className="text-body font-semibold">Saúde e alimentação</h2>
            <YesNo legend="Teve alguma dor ou lesão nova?" value={newPain} onChange={setNewPain} />
            <YesNo
              legend="Surgiu alguma condição de saúde ou mudança de medicação?"
              value={newCondition}
              onChange={setNewCondition}
            />
            {(newPain || newCondition) && (
              <Notes
                label="Conta o que aconteceu (um profissional vai olhar com cuidado)"
                value={healthNotes}
                onChange={setHealthNotes}
                max={500}
              />
            )}
            <Notes
              label="O que foi mais difícil na alimentação?"
              value={foodDifficulties}
              onChange={setFoodDifficulties}
              max={500}
            />
            <Notes
              label="Alguma restrição ou preferência nova?"
              value={newRestrictions}
              onChange={setNewRestrictions}
              max={300}
              rows={2}
            />
          </section>

          <Notes
            label="Quer contar mais alguma coisa?"
            value={freeText}
            onChange={setFreeText}
            max={800}
          />

          <div>
            <Button type="submit" disabled={busy}>
              Enviar reavaliação
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
