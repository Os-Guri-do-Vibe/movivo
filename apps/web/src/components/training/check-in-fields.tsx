'use client';

import { useId, useState } from 'react';

import type { DailyCheckIn } from '@movivo/shared';

/** Botão de uma escala: alvo grande para o polegar, verde quando escolhido (padrão do check-in). */
export const CHOICE_CLASS =
  'min-h-12 rounded-xl border text-label font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
export const choiceState = (selected: boolean) =>
  selected
    ? 'border-primary bg-primary text-primary-foreground'
    : 'border-input bg-card text-foreground hover:bg-muted';

/**
 * Escala de 1 a 5 em um toque, da pior para a melhor resposta (da esquerda para a direita). As
 * pontas dizem o que cada lado significa e a palavra da escolha aparece ao lado da pergunta.
 */
export function Scale({
  legend,
  words,
  hint,
  value,
  onChange,
}: {
  legend: string;
  /** O que cada ponto significa, do 1 ao 5 (as pontas aparecem embaixo da escala). */
  words?: readonly [string, string, string, string, string];
  /** Uma linha de ajuda no lugar das palavras (formulários mais antigos). */
  hint?: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="font-bold text-foreground">
        {legend}{' '}
        {words && value !== null ? (
          <span className="font-extrabold text-petroleo">· {words[value - 1]}</span>
        ) : null}
      </legend>
      {hint ? <p className="mt-0.5 text-label text-muted-foreground">{hint}</p> : null}
      <div className="mt-2 grid grid-cols-5 gap-2" role="radiogroup" aria-label={legend}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={words ? words[n - 1] : undefined}
            onClick={() => onChange(n)}
            className={`${CHOICE_CLASS} ${choiceState(value === n)}`}
          >
            {n}
          </button>
        ))}
      </div>
      {words ? (
        <div className="mt-1 flex justify-between gap-3 text-label text-muted-foreground">
          <span>{words[0]}</span>
          <span className="text-right">{words[4]}</span>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Menos e mais horas aceitas (o mesmo limite da API). */
export const SLEEP_MIN_MINUTES = 60;
export const SLEEP_MAX_MINUTES = 960;

/**
 * Máscara de horas enquanto o aluno digita: só números, até 4 dígitos, e os dois últimos viram
 * os minutos ("730" → "7:30", "0745" → "07:45"). Quem digitar os dois-pontos também é aceito.
 */
export function maskHours(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

/**
 * "7:30" → 450 minutos; "8" → 480. Devolve `null` para formato inválido, minutos acima de 59 ou
 * fora do intervalo de 1 h a 16 h.
 */
export function parseHours(text: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total >= SLEEP_MIN_MINUTES && total <= SLEEP_MAX_MINUTES ? total : null;
}

const hoursText = (minutes: number | null | undefined) =>
  minutes ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : '';

/** Quantas horas dormiu, com a máscara h:mm e a validação na hora. */
function SleepHoursField({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (minutes: number | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(() => hoursText(value));
  const [touched, setTouched] = useState(false);
  const complete = text.replace(/\D/g, '').length >= 3 || text.includes(':');
  const invalid = text !== '' && parseHours(text) === null && (touched || complete);
  return (
    <div>
      <label htmlFor={id} className="font-bold text-foreground">
        Quantas horas você dormiu hoje?
      </label>
      <p className="mt-0.5 text-label text-muted-foreground">Horas e minutos, por exemplo 7:30.</p>
      <div className="relative mt-2">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder="7:30"
          maxLength={5}
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-erro` : undefined}
          onChange={(event) => {
            const masked = maskHours(event.target.value);
            setText(masked);
            onChange(parseHours(masked));
          }}
          onBlur={() => setTouched(true)}
          className={`min-h-12 w-full rounded-xl border bg-card px-14 text-center font-mono text-h3 font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${invalid ? 'border-destructive' : 'border-verde-pulso'}`}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-label text-muted-foreground"
        >
          horas
        </span>
      </div>
      {invalid ? (
        <p id={`${id}-erro`} role="alert" className="mt-1 text-label text-destructive">
          Informe entre 1:00 e 16:00 (minutos de 00 a 59).
        </p>
      ) : null}
    </div>
  );
}

export const EMPTY_CHECK_IN: DailyCheckIn = {
  energy: null,
  sleep: null,
  sleepMinutes: null,
  mood: null,
  stress: null,
};

/** As cinco perguntas do dia (preenchidas para continuar). */
export const CHECK_IN_KEYS = ['sleep', 'sleepMinutes', 'energy', 'stress', 'mood'] as const;

/**
 * As perguntas do dia, antes do treino ou no dia de descanso. Alimentação fica na aba própria.
 * O estresse aparece do "muito estressado" (1) ao "pouco estressado" (5), como as outras escalas
 * (pior à esquerda), mas é gravado como sempre: 1 = sem estresse, 5 = muito estressado.
 */
export function CheckInFields({
  value,
  onChange,
}: {
  value: DailyCheckIn;
  onChange: (value: DailyCheckIn) => void;
}) {
  const set = <K extends keyof DailyCheckIn>(key: K, next: DailyCheckIn[K]) =>
    onChange({ ...value, [key]: next });
  const stress = value.stress ?? null;
  return (
    <div className="flex flex-col gap-7">
      <Scale
        legend="Como foi a qualidade da sua noite de sono?"
        words={['Péssima', 'Ruim', 'Regular', 'Boa', 'Ótima']}
        value={value.sleep ?? null}
        onChange={(n) => set('sleep', n)}
      />
      <SleepHoursField value={value.sleepMinutes} onChange={(m) => set('sleepMinutes', m)} />
      <Scale
        legend="Como está sua disposição hoje?"
        words={[
          'Pouco disposto(a)',
          'Um pouco disposto(a)',
          'Normal',
          'Disposto(a)',
          'Muito disposto(a)',
        ]}
        value={value.energy ?? null}
        onChange={(n) => set('energy', n)}
      />
      <Scale
        legend="Como está seu nível de stress hoje?"
        words={[
          'Muito estressado(a)',
          'Estressado(a)',
          'Normal',
          'Tranquilo(a)',
          'Pouco estressado(a)',
        ]}
        value={stress === null ? null : 6 - stress}
        onChange={(n) => set('stress', 6 - n)}
      />
      <Scale
        legend="Como está seu humor hoje?"
        words={['Mal humor', 'Pra baixo', 'Neutro', 'Bem', 'Bom humor']}
        value={value.mood ?? null}
        onChange={(n) => set('mood', n)}
      />
    </div>
  );
}
