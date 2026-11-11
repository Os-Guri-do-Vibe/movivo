/**
 * Leitura da anamnese para a equipe: transforma as respostas gravadas (chaves e códigos) no que
 * o aluno viu no formulário, em PT-BR, na mesma ordem e nas mesmas etapas.
 *
 * Fonte dos textos: as listas do próprio formulário (`components/onboarding/anamnesis-options`)
 * e os rótulos do `@movivo/shared`. Nada aqui inventa tradução nova para o que o formulário já
 * diz. Campo ou valor que ainda não tem rótulo (resposta nova no futuro) nunca aparece cru:
 * vira texto legível (`foo_bar` → "Foo bar") como último recurso.
 */
import {
  ageInYears,
  DECLARED_GOAL_LABELS,
  EXTERNAL_SPORT_LABELS,
  MEAL_SLOT_LABELS,
  MEASUREMENT_LABELS,
  MEASUREMENT_UNITS,
  MUSCLE_EMPHASIS_LABELS,
  PAIN_REGION_LABELS,
  PARQ_DECLARATIONS,
  PARQ_QUESTION_IDS,
  PARQ_QUESTION_TEXT,
  PARQ_RISK_FACTOR_LABEL,
  SESSION_MODALITY_LABELS,
  TRAINING_LOCATION_LABELS,
  type AnamnesisAnswersView,
  type MeasurementMethod,
  type ParqQuestionId,
} from '@movivo/shared';

import {
  AVAILABLE_LABELS,
  BIOLOGICAL_SEX_ITEMS,
  COOKING_ITEMS,
  EMPHASIS_ITEMS,
  EVENT_ITEMS,
  HUNGER_ITEMS,
  LEVEL_ITEMS,
  PRIORITY_ITEMS,
  RESTRICTION_ITEMS,
  RPE_ITEMS,
  SEVERITY_ITEMS,
  SLOT_ITEMS,
  STRESS_ITEMS,
  SUPPLEMENT_ITEMS,
  TREND_ITEMS,
  VENUE_LABELS,
  type OptionItem,
} from '@/components/onboarding/anamnesis-options';
import { WEEKDAY_ITEMS } from '@/components/onboarding/weekday-items';
import { formatPhone } from '@/lib/phone-mask';

// --- Modelo de leitura ------------------------------------------------------------------------

export type AnswerValue =
  /** Resposta curta. `muted`: o aluno pulou uma pergunta opcional dentro de um bloco. */
  | { kind: 'text'; text: string; tone?: 'risk' | 'muted' }
  /** Texto livre do aluno, preservado (quebras de linha incluídas). */
  | { kind: 'paragraph'; text: string }
  /** Escolha múltipla. */
  | { kind: 'chips'; items: string[] }
  /** Pares curtos alinhados (região → intensidade, dia → horário, medida → valor). */
  | { kind: 'pairs'; items: { label: string; value: string; tone?: 'risk' }[] }
  /** Blocos repetidos (cada modalidade, cada esporte, a prova marcada). */
  | { kind: 'groups'; items: AnswerGroup[] };

export interface AnswerRow {
  id: string;
  /** Pergunta, como o aluno leu (ou forma curta equivalente). */
  label: string;
  value: AnswerValue | null;
  /** Explicação da opção escolhida, como o formulário mostrou. */
  note?: string;
  /** Complemento escrito pelo aluno (ex.: o detalhe de um "Sim" no PAR-Q). */
  detail?: string;
}

export interface AnswerGroup {
  title: string;
  rows: AnswerRow[];
}

export interface AnswerSection {
  step: number;
  anchor: string;
  title: string;
  /** Etapa com dado de saúde (PAR-Q, dores, condições, alergias). */
  sensitive: boolean;
  rows: AnswerRow[];
  /** Perguntas opcionais que o aluno deixou em branco (a tela esconde por padrão). */
  unanswered: AnswerRow[];
  /** Etapa sem respostas (ex.: medidas opcionais): o porquê, em vez de uma seção vazia. */
  skippedNote?: string;
}

export interface AttentionItem {
  id: string;
  /** `attention`: PAR-Q "Sim" e alergia grave. O resto é informação para achar rápido. */
  tone: 'attention' | 'neutral';
  title: string;
  detail?: string;
  step: number;
}

export interface AnamnesisReading {
  studentName: string | null;
  flowLabel: string;
  submittedLabel: string | null;
  attention: AttentionItem[];
  /** PAR-Q sem nenhum "Sim" (`null` se a etapa não veio). */
  parqClear: boolean | null;
  sections: AnswerSection[];
}

// --- Rótulos ----------------------------------------------------------------------------------

/** Títulos das etapas para quando a etapa não veio na leitura (o servidor manda os dele). */
const STEP_TITLES: Readonly<Record<number, string>> = {
  1: 'Cadastro',
  2: 'Objetivos',
  3: 'Seu treino com a MOVIVO',
  4: 'Sua semana',
  5: 'Preferências de treino e saúde geral',
  6: 'Dores e limitações',
  7: 'Alimentação',
  8: 'Corpo',
  9: 'PAR-Q',
};

const SENSITIVE_STEPS = new Set([5, 6, 7, 9]);

/** Como a medida foi obtida (o formulário grava sempre fita métrica; os demais vêm de outros fluxos). */
export const MEASUREMENT_METHOD_LABELS: Readonly<Record<MeasurementMethod, string>> = {
  SELF_TAPE: 'Fita métrica, pelo próprio aluno',
  SCALE: 'Balança',
  BIOIMPEDANCE: 'Bioimpedância',
  SKINFOLD: 'Dobras cutâneas',
  DEXA: 'Densitometria (DEXA)',
  ESTIMATED: 'Estimativa',
};

/** Campos de versões anteriores do formulário, para não caírem no rótulo genérico. */
const LEGACY_KEY_LABELS: Readonly<Record<string, string>> = {
  venues: 'Locais de treino',
  monthsPracticing: 'Tempo de prática',
  occupationRhythm: 'Ritmo de trabalho',
  targetSeconds: 'Meta de tempo',
  label: 'Nome',
};

const WEEKDAY_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  WEEKDAY_ITEMS.map((item) => [item.value, item.label]),
);

/** Valores sem ambiguidade, para campos que só chegam pelo caminho genérico. */
const GENERIC_VALUE_LABELS: Readonly<Record<string, string>> = {
  ...TRAINING_LOCATION_LABELS,
  ...SESSION_MODALITY_LABELS,
  ...WEEKDAY_LABELS,
};

const PARQ_DECLARATION_COUNT = PARQ_DECLARATIONS.length;

// --- Formatação -------------------------------------------------------------------------------

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const brlFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Último recurso para chave ou código sem rótulo: `FOO_BAR`, `foo_bar` e `fooBar` viram
 * "Foo bar". Nunca devolve SNAKE_CASE.
 */
export function humanize(code: string): string {
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
  return words ? words.charAt(0).toLocaleUpperCase('pt-BR') + words.slice(1) : code;
}

/** Parece um código (`FAT_LOSS`, `HIGH`, `foo_bar`), e não um texto do aluno? */
function looksLikeCode(value: string): boolean {
  return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(value) || /^[a-z]+(_[a-z0-9]+)+$/.test(value);
}

export function labelFrom<T extends string>(
  items: readonly OptionItem<T>[] | readonly { value: T; label: string }[],
  value: unknown,
): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const found = items.find((item) => item.value === String(value));
  return found ? found.label : humanize(String(value));
}

function fromMap(map: Readonly<Record<string, string>>, value: unknown): string {
  if (typeof value !== 'string') return '';
  return map[value] ?? humanize(value);
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** `2026-03-15` → `15/03/2026`, sem `Date` (o fuso não muda o dia). */
export function formatIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Data e hora do envio: `03/11/2026 às 14:20`. */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(
    date,
  );
  return `${day} às ${time}`;
}

/** Tempo de prova: `28:30` ou `1:25:00`. */
export function formatRaceTime(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}

/** Duração: `45 min`, `1 h`, `1 h 30 min`. */
export function formatMinutes(total: number): string {
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** Horas de sono: `7,5` → `7 h 30 min por noite`. */
export function formatSleep(hours: number): string {
  return `${formatMinutes(hours * 60)} por noite`;
}

const plural = (n: number, one: string, many: string) =>
  `${formatNumber(n)} ${n === 1 ? one : many}`;

// --- Leitura segura do JSON -------------------------------------------------------------------

type Data = Record<string, unknown>;

const isObject = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asArray = (value: unknown): unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;
const asObjects = (value: unknown): Data[] => (asArray(value) ?? []).filter(isObject);

/** Lê campos de um objeto e lembra quais foram usados; o resto vira linha genérica. */
class FieldReader {
  private readonly used = new Set<string>();
  constructor(private readonly data: Data) {}
  get(key: string): unknown {
    this.used.add(key);
    return this.data[key];
  }
  has(key: string): boolean {
    return this.data[key] !== undefined;
  }
  /** Marca como lido sem usar (versões internas, campos derivados). */
  skip(...keys: string[]): void {
    for (const key of keys) this.used.add(key);
  }
  rest(): [string, unknown][] {
    return Object.entries(this.data).filter(
      ([key, value]) => !this.used.has(key) && value !== undefined,
    );
  }
}

// --- Valores --------------------------------------------------------------------------------

const text = (value: string | undefined, tone?: 'risk' | 'muted'): AnswerValue | null =>
  value ? { kind: 'text', text: value, ...(tone ? { tone } : {}) } : null;
const paragraph = (value: unknown): AnswerValue | null => {
  const s = asString(value);
  return s ? { kind: 'paragraph', text: s } : null;
};
const chips = (items: string[]): AnswerValue => ({ kind: 'chips', items });
const yesNo = (value: unknown): AnswerValue | null =>
  typeof value === 'boolean' ? { kind: 'text', text: value ? 'Sim' : 'Não' } : null;
const NOT_INFORMED: AnswerValue = { kind: 'text', text: 'Não informou', tone: 'muted' };

/** Valor de um campo sem regra própria: decide o formato pelo tipo. */
export function genericValue(value: unknown): AnswerValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return yesNo(value);
  if (typeof value === 'number') return text(formatNumber(value));
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return text(formatIsoDate(s));
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return text(formatDateTime(s));
    if (looksLikeCode(s)) return text(GENERIC_VALUE_LABELS[s] ?? humanize(s));
    return s.length > 80 || s.includes('\n') ? { kind: 'paragraph', text: s } : text(s);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return text('Nenhum');
    if (value.every((item) => !isObject(item))) {
      return chips(
        value
          .map((item) => genericValue(item))
          .flatMap((v) => (v && v.kind === 'text' ? [v.text] : [])),
      );
    }
    return {
      kind: 'groups',
      items: value.map((item, index) => ({
        title: `Item ${index + 1}`,
        rows: genericRows(isObject(item) ? item : { valor: item }, `item-${index}`),
      })),
    };
  }
  if (isObject(value)) {
    return { kind: 'groups', items: [{ title: 'Detalhes', rows: genericRows(value, 'detail') }] };
  }
  return null;
}

function genericLabel(key: string): string {
  return LEGACY_KEY_LABELS[key] ?? humanize(key);
}

function genericRows(data: Data | [string, unknown][], prefix: string): AnswerRow[] {
  const entries = Array.isArray(data) ? data : Object.entries(data);
  return entries.flatMap(([key, value]) => {
    const v = genericValue(value);
    return v ? [{ id: `${prefix}.${key}`, label: genericLabel(key), value: v }] : [];
  });
}

/** Linhas de uma seção: respondidas e as opcionais deixadas em branco. */
class Rows {
  readonly rows: AnswerRow[] = [];
  readonly unanswered: AnswerRow[] = [];
  constructor(private readonly prefix: string) {}
  add(
    key: string,
    label: string,
    value: AnswerValue | null,
    extra?: Pick<AnswerRow, 'note' | 'detail'>,
  ) {
    const row: AnswerRow = { id: `${this.prefix}.${key}`, label, value, ...extra };
    (value ? this.rows : this.unanswered).push(row);
  }
  /** Pergunta que só aparece em certos casos: sem resposta, não entra nem como "em branco". */
  addIf(key: string, label: string, value: AnswerValue | null, extra?: Pick<AnswerRow, 'note'>) {
    if (value) this.add(key, label, value, extra);
  }
  rest(reader: FieldReader) {
    this.rows.push(...genericRows(reader.rest(), this.prefix));
  }
}

const groupRows = (prefix: string, build: (rows: Rows) => void): AnswerRow[] => {
  const rows = new Rows(prefix);
  build(rows);
  return rows.rows;
};

// --- Etapas -----------------------------------------------------------------------------------

interface Context {
  strengthSelected: boolean;
}

function registration(r: FieldReader, rows: Rows) {
  rows.add('name', 'Nome completo', text(asString(r.get('name'))));
  const birth = asString(r.get('birthDate'));
  rows.add(
    'birthDate',
    'Data de nascimento',
    birth && /^\d{4}-\d{2}-\d{2}$/.test(birth)
      ? text(`${formatIsoDate(birth)} · ${ageInYears(birth)} anos`)
      : text(birth),
  );
  const sex = r.get('biologicalSex');
  rows.add(
    'biologicalSex',
    'Sexo biológico',
    text(sex ? labelFrom(BIOLOGICAL_SEX_ITEMS, sex) : ''),
  );
  const height = asNumber(r.get('heightCm'));
  rows.add('heightCm', 'Altura', text(height === undefined ? '' : `${formatNumber(height)} cm`));
  const weight = asNumber(r.get('weightKg'));
  rows.add('weightKg', 'Peso', text(weight === undefined ? '' : `${formatNumber(weight)} kg`));
  const phone = asString(r.get('phoneNumber'));
  rows.add('phoneNumber', 'WhatsApp', text(phone && formatPhone(phone)));
  rows.add('email', 'E-mail', text(asString(r.get('email'))));
}

function targetEventGroup(event: Data): AnswerGroup {
  const r = new FieldReader(event);
  const name = asString(r.get('name'));
  return {
    title: name ?? 'Prova marcada',
    rows: groupRows('targetEvent', (rows) => {
      rows.addIf('kind', 'Modalidade', text(labelFrom(EVENT_ITEMS, r.get('kind'))));
      const date = asString(r.get('date'));
      rows.addIf('date', 'Data da prova', text(date && formatIsoDate(date)));
      const meters = asNumber(r.get('distanceMeters'));
      rows.addIf(
        'distanceMeters',
        'Distância',
        text(meters === undefined ? '' : `${formatNumber(meters / 1000)} km`),
      );
      const target = asNumber(r.get('targetSeconds'));
      rows.addIf(
        'targetSeconds',
        'Meta de tempo',
        text(target === undefined ? '' : formatRaceTime(target)),
      );
      rows.rest(r);
    }),
  };
}

function goals(r: FieldReader, rows: Rows) {
  const rawGoal = r.get('goal');
  const goal = new FieldReader(isObject(rawGoal) ? rawGoal : {});
  const primary = goal.get('primary');
  rows.add(
    'primary',
    'Objetivo principal',
    text(primary ? fromMap(DECLARED_GOAL_LABELS, primary) : ''),
  );
  const secondary = asArray(goal.get('secondary'));
  rows.add(
    'secondary',
    'Outros objetivos',
    secondary
      ? secondary.length > 0
        ? chips(secondary.map((g) => fromMap(DECLARED_GOAL_LABELS, g)))
        : text('Nenhum')
      : null,
  );
  const emphasis = goal.get('emphasis');
  rows.add(
    'emphasis',
    'Resultado que mais importa',
    text(emphasis ? labelFrom(EMPHASIS_ITEMS, emphasis) : ''),
    { note: EMPHASIS_ITEMS.find((item) => item.value === emphasis)?.description },
  );
  const event = goal.get('targetEvent');
  rows.add(
    'targetEvent',
    'Prova ou competição com data marcada',
    isObject(event) ? { kind: 'groups', items: [targetEventGroup(event)] } : text('Não'),
  );
  // O texto livre é gravado fora do objetivo (bloco cifrado); anamneses antigas o tinham dentro.
  const motivation = r.get('motivation') ?? goal.get('motivation');
  rows.add('motivation', 'O que fez procurar acompanhamento agora', paragraph(motivation));
  rows.rest(goal);
}

function modalityGroup(m: Data, index: number): AnswerGroup {
  const r = new FieldReader(m);
  const modality = asString(r.get('modality')) ?? '';
  const known = modality in LEVEL_ITEMS ? (modality as keyof typeof LEVEL_ITEMS) : null;
  const level = asString(r.get('level'));
  const practicing = level !== undefined && level !== 'NONE';
  r.skip('wantsToStart');
  return {
    title: fromMap(SESSION_MODALITY_LABELS, modality) || `Modalidade ${index + 1}`,
    rows: groupRows(`modalities.${modality || index}`, (rows) => {
      rows.add('practicing', 'Já pratica hoje', text(practicing ? 'Sim' : 'Não'));
      if (practicing) {
        const items = known ? LEVEL_ITEMS[known] : [];
        rows.add('level', 'Nível', text(labelFrom(items, level)), {
          note: items.find((item) => item.value === level)?.description,
        });
      }
      const venue = asString(r.get('venue'));
      rows.addIf(
        'venue',
        'Onde treina',
        text(
          venue &&
            ((known && VENUE_LABELS[known][venue as keyof (typeof VENUE_LABELS)['STRENGTH']]) ||
              fromMap(TRAINING_LOCATION_LABELS, venue)),
        ),
      );
      const km = asNumber(r.get('weeklyKm'));
      const fiveK = asNumber(r.get('recent5kSeconds'));
      if (modality === 'RUNNING' && practicing) {
        rows.add(
          'weeklyKm',
          'Km por semana',
          km === undefined ? NOT_INFORMED : text(`${formatNumber(km)} km`),
        );
        rows.add(
          'recent5k',
          'Tempo nos 5 km',
          fiveK === undefined ? NOT_INFORMED : text(formatRaceTime(fiveK)),
        );
      } else {
        rows.addIf(
          'weeklyKm',
          'Km por semana',
          km === undefined ? null : text(`${formatNumber(km)} km`),
        );
        rows.addIf(
          'recent5k',
          'Tempo nos 5 km',
          fiveK === undefined ? null : text(formatRaceTime(fiveK)),
        );
      }
      const races = asNumber(r.get('hyroxRaces'));
      const best = asNumber(r.get('hyroxBestSeconds'));
      rows.addIf(
        'hyroxRaces',
        'Provas de HYROX feitas',
        races === undefined ? null : text(plural(races, 'prova', 'provas')),
      );
      if (races !== undefined && races > 0) {
        rows.add(
          'hyroxBest',
          'Melhor tempo em prova',
          best === undefined ? NOT_INFORMED : text(formatRaceTime(best)),
        );
      }
      const months = asNumber(r.get('monthsPracticing'));
      rows.addIf(
        'monthsPracticing',
        'Tempo de prática',
        months === undefined ? null : text(plural(months, 'mês', 'meses')),
      );
      rows.rest(r);
    }),
  };
}

function externalSportsRow(rows: Rows, value: unknown) {
  const sports = asArray(value);
  if (!sports) return;
  if (sports.length === 0) {
    rows.add('externalSports', 'Pratica outro esporte por fora', text('Não'));
    return;
  }
  rows.add('externalSports', 'Pratica outro esporte por fora', {
    kind: 'groups',
    items: asObjects(sports).map((sport, index) => {
      const r = new FieldReader(sport);
      const code = r.get('sport');
      const name = asString(r.get('label'));
      return {
        title: name ?? (fromMap(EXTERNAL_SPORT_LABELS, code) || `Esporte ${index + 1}`),
        rows: groupRows(`externalSports.${index}`, (inner) => {
          const sessions = asNumber(r.get('sessionsPerWeek'));
          inner.addIf(
            'sessionsPerWeek',
            'Dias por semana',
            sessions === undefined ? null : text(plural(sessions, 'dia', 'dias')),
          );
          const fixed = asArray(r.get('fixedDays')) ?? [];
          inner.add(
            'fixedDays',
            'Dias fixos',
            fixed.length > 0
              ? chips(fixed.map((day) => fromMap(WEEKDAY_LABELS, day)))
              : text('Nenhum dia fixo'),
          );
          const minutes = asNumber(r.get('minutesPerSession'));
          inner.addIf(
            'minutesPerSession',
            'Duração de cada sessão',
            minutes === undefined ? null : text(formatMinutes(minutes)),
          );
          const rpe = asNumber(r.get('typicalRpe'));
          const rpeLabel = RPE_ITEMS.find((item) => Number(item.value) === rpe)?.label;
          inner.addIf(
            'typicalRpe',
            'Quanto cansa',
            rpe === undefined
              ? null
              : text(
                  rpeLabel
                    ? `${rpeLabel} · esforço ${formatNumber(rpe)} de 10`
                    : `Esforço ${formatNumber(rpe)} de 10`,
                ),
          );
          inner.rest(r);
        }),
      };
    }),
  });
}

function modalities(r: FieldReader, rows: Rows) {
  const list = asObjects(r.get('modalities'));
  rows.add(
    'modalities',
    'Modalidades com a MOVIVO',
    list.length > 0 ? { kind: 'groups', items: list.map(modalityGroup) } : null,
  );
  // Anamnese antiga: o esporte externo vinha aqui (o servidor o leva para a semana).
  externalSportsRow(rows, r.get('externalSports'));
  const venues = asArray(r.get('venues'));
  if (venues) {
    rows.addIf(
      'venues',
      'Locais de treino',
      chips(venues.map((v) => fromMap(TRAINING_LOCATION_LABELS, v))),
    );
  }
  rows.rest(r);
}

function availableLabel(minutes: number): string {
  return (
    AVAILABLE_LABELS[String(minutes) as keyof typeof AVAILABLE_LABELS] ?? formatMinutes(minutes)
  );
}

function routine(r: FieldReader, rows: Rows) {
  externalSportsRow(rows, r.get('externalSports'));
  const order = WEEKDAY_ITEMS.map((item) => item.value as string);
  const windows = asObjects(r.get('windows')).sort(
    (a, b) => order.indexOf(String(a.weekday)) - order.indexOf(String(b.weekday)),
  );
  if (windows.length > 0) {
    rows.add(
      'days',
      'Dias em que pode treinar',
      chips(windows.map((w) => fromMap(WEEKDAY_LABELS, w.weekday))),
    );
    const slots = new Set(windows.map((w) => String(w.slot)));
    const minutes = new Set(windows.map((w) => asNumber(w.maxMinutes)));
    const slotOf = (w: Data) => labelFrom(SLOT_ITEMS, w.slot);
    const minutesOf = (w: Data) => {
      const m = asNumber(w.maxMinutes);
      return m === undefined ? '' : availableLabel(m);
    };
    const [first] = windows;
    if (first && slots.size === 1 && minutes.size === 1) {
      rows.add('slot', 'Melhor período', text(slotOf(first)));
      rows.add('maxMinutes', 'Tempo para cada treino', text(minutesOf(first)));
    } else {
      rows.add('windows', 'Período e tempo por dia', {
        kind: 'pairs',
        items: windows.map((w) => ({
          label: fromMap(WEEKDAY_LABELS, w.weekday),
          value: [slotOf(w), minutesOf(w)].filter(Boolean).join(' · '),
        })),
      });
    }
  }
  rows.addIf(
    'variesWeekly',
    'Dias e horários mudam de uma semana para outra',
    yesNo(r.get('variesWeekly')),
    { note: 'Por escala, plantão ou viagem.' },
  );
  const max = asNumber(r.get('maxSessionsPerWeek'));
  rows.addIf(
    'maxSessionsPerWeek',
    'Máximo de treinos por semana (pergunta antiga)',
    max === undefined ? null : text(plural(max, 'treino', 'treinos')),
  );
  const rawLife = r.get('lifeContext');
  const life = new FieldReader(isObject(rawLife) ? rawLife : {});
  const sleep = asNumber(life.get('sleepHoursTypical'));
  rows.add('sleep', 'Horas de sono', sleep === undefined ? null : text(formatSleep(sleep)));
  const stress = life.get('stressLevel');
  rows.add('stress', 'Estresse no dia a dia', text(stress ? labelFrom(STRESS_ITEMS, stress) : ''), {
    note: STRESS_ITEMS.find((item) => item.value === stress)?.description,
  });
  rows.rest(life);
  rows.rest(r);
}

function preferences(r: FieldReader, rows: Rows, ctx: Context) {
  const rawPrefs = r.get('preferences');
  const prefs = new FieldReader(isObject(rawPrefs) ? rawPrefs : {});
  const priority = prefs.get('priority');
  rows.add(
    'priority',
    'Ritmo de treino',
    text(priority ? labelFrom(PRIORITY_ITEMS, priority) : ''),
    {
      note: PRIORITY_ITEMS.find((item) => item.value === priority)?.description,
    },
  );
  const emphasis = asArray(prefs.get('muscleEmphasis')) ?? [];
  if (emphasis.length > 0 || ctx.strengthSelected) {
    rows.add(
      'muscleEmphasis',
      'Regiões com mais ênfase na musculação',
      emphasis.length > 0
        ? chips(emphasis.map((region) => fromMap(MUSCLE_EMPHASIS_LABELS, region)))
        : text('Nenhuma região'),
    );
  }
  rows.rest(prefs);
  // Perguntas de sim ou não com texto: o formulário só grava o texto quando a resposta é "Sim".
  rows.add(
    'trainingPreferences',
    'Jeito de treinar que prefere',
    paragraph(r.get('trainingPreferences')) ?? text('Não'),
  );
  rows.add(
    'dislikedExercises',
    'Exercícios que prefere evitar por não gostar',
    paragraph(r.get('dislikedExercises')) ?? text('Não'),
  );
  const conditions = paragraph(r.get('conditions'));
  const medications = paragraph(r.get('medications'));
  if (!conditions && !medications) {
    rows.add('health', 'Condição de saúde ou medicamento contínuo', text('Não'));
  } else {
    rows.addIf('conditions', 'Condições de saúde', conditions);
    rows.addIf('medications', 'Medicamentos em uso', medications);
  }
  rows.add(
    'professionalGuidance',
    'Orientação de profissional de saúde que ainda vale',
    paragraph(r.get('professionalGuidance')) ?? text('Não'),
  );
  rows.rest(r);
}

function painPointLabel(point: Data): string {
  const other = asString(point.regionOther);
  if (point.region === 'OTHER') return other ?? 'Outra região';
  return fromMap(PAIN_REGION_LABELS, point.region);
}

function pain(r: FieldReader, rows: Rows) {
  const rawPain = r.get('pain');
  const p = new FieldReader(isObject(rawPain) ? rawPain : {});
  const hasPain = p.get('hasPain');
  rows.add('hasPain', 'Sente dor ou desconforto que atrapalha o treino', yesNo(hasPain));
  if (hasPain !== true) {
    p.skip(
      'points',
      'trend',
      'trigger',
      'hasProfessionalExplanation',
      'professionalExplanation',
      'underMedicalFollowUp',
      'hasAvoidanceRecommendation',
      'avoidanceRecommendation',
    );
  } else {
    const points = asObjects(p.get('points'));
    rows.add('points', 'Regiões e intensidade hoje', {
      kind: 'pairs',
      items: points.map((point) => ({
        label: painPointLabel(point),
        value: `${formatNumber(asNumber(point.intensity) ?? 0)} de 10`,
      })),
    });
    const trend = p.get('trend');
    rows.add(
      'trend',
      'Evolução nas últimas semanas',
      text(trend ? labelFrom(TREND_ITEMS, trend) : ''),
    );
    rows.add('trigger', 'O que provoca ou piora', paragraph(p.get('trigger')));
    rows.add(
      'hasProfessionalExplanation',
      'Profissional de saúde explicou o que é',
      yesNo(p.get('hasProfessionalExplanation')),
    );
    rows.addIf(
      'professionalExplanation',
      'O que foi explicado',
      paragraph(p.get('professionalExplanation')),
    );
    rows.add(
      'underMedicalFollowUp',
      'Acompanhamento com médico ou fisioterapeuta',
      yesNo(p.get('underMedicalFollowUp')),
    );
    rows.add(
      'hasAvoidanceRecommendation',
      'Pediram para evitar algum movimento',
      yesNo(p.get('hasAvoidanceRecommendation')),
    );
    rows.addIf(
      'avoidanceRecommendation',
      'O que evitar',
      paragraph(p.get('avoidanceRecommendation')),
    );
  }
  rows.rest(p);
  rows.rest(r);
}

function nutrition(r: FieldReader, rows: Rows) {
  const cooking = r.get('cookingCapacity');
  rows.add(
    'cookingCapacity',
    'Na cozinha',
    text(cooking ? labelFrom(COOKING_ITEMS, cooking) : ''),
    {
      note: COOKING_ITEMS.find((item) => item.value === cooking)?.description,
    },
  );
  const outside = asNumber(r.get('mealsOutsideHomePerWeek'));
  rows.add(
    'mealsOutsideHomePerWeek',
    'Refeições fora de casa',
    outside === undefined ? null : text(`${plural(outside, 'refeição', 'refeições')} por semana`),
  );
  const budget = asNumber(r.get('foodBudgetMonthlyBrl'));
  rows.add(
    'foodBudgetMonthlyBrl',
    'Orçamento mensal com alimentação',
    budget === undefined ? null : text(brlFormat.format(budget)),
  );
  r.skip('mealsPerDay'); // É a quantidade de refeições marcadas: o aluno responde uma pergunta só.
  const meals = asArray(r.get('usualMeals')) ?? [];
  rows.add(
    'usualMeals',
    'Refeições num dia comum',
    meals.length > 0 ? chips(meals.map((m) => fromMap(MEAL_SLOT_LABELS, m))) : null,
  );
  const restrictions = asArray(r.get('dietaryRestrictions'));
  rows.add(
    'dietaryRestrictions',
    'Estilo de alimentação ou restrição',
    restrictions
      ? restrictions.length > 0
        ? chips(restrictions.map((v) => labelFrom(RESTRICTION_ITEMS, v)))
        : text('Nenhuma')
      : null,
  );
  const allergies = asArray(r.get('allergies'));
  rows.add(
    'allergies',
    'Alergia ou intolerância alimentar',
    allergies
      ? allergies.length > 0
        ? {
            kind: 'pairs',
            items: asObjects(allergies).map((a) => ({
              label: asString(a.allergen) ?? 'Alimento não informado',
              value: labelFrom(SEVERITY_ITEMS, a.severity),
              ...(a.severity === 'SEVERE_ALLERGY' ? { tone: 'risk' as const } : {}),
            })),
          }
        : text('Não')
      : null,
  );
  const supplements = asArray(r.get('supplements'));
  const other = asString(r.get('supplementOther'));
  rows.add(
    'supplements',
    'Suplementos que usa',
    supplements
      ? supplements.length > 0
        ? chips(
            supplements.map((s) =>
              s === 'OTHER' && other ? `Outro: ${other}` : labelFrom(SUPPLEMENT_ITEMS, s),
            ),
          )
        : text('Nenhum')
      : null,
  );
  const hunger = r.get('hunger');
  rows.add('hunger', 'Fome ao longo do dia', text(hunger ? labelFrom(HUNGER_ITEMS, hunger) : ''));
  rows.add('likedFoods', 'O que gosta de comer', paragraph(r.get('likedFoods')));
  rows.add('dislikedFoods', 'O que não come de jeito nenhum', paragraph(r.get('dislikedFoods')));
  rows.rest(r);
}

function body(r: FieldReader, rows: Rows) {
  const measurements = asObjects(r.get('measurements'));
  if (measurements.length === 0) return;
  const dates = new Set(measurements.map((m) => asString(m.measuredOn)));
  const methods = new Set(measurements.map((m) => asString(m.method)));
  const date = dates.size === 1 ? [...dates][0] : undefined;
  const method = methods.size === 1 ? [...methods][0] : undefined;
  rows.add(
    'measurements',
    'Medidas do corpo',
    {
      kind: 'pairs',
      items: measurements.map((m) => {
        const kind = asString(m.kind) ?? '';
        const unit = MEASUREMENT_UNITS[kind as keyof typeof MEASUREMENT_UNITS] ?? '';
        const value = asNumber(m.value);
        return {
          label: fromMap(MEASUREMENT_LABELS, kind),
          value:
            value === undefined
              ? ''
              : `${formatNumber(value)}${unit === '%' ? '%' : ` ${unit}`}`.trim(),
        };
      }),
    },
    {
      note: [
        date ? `Medidas de ${formatIsoDate(date)}` : undefined,
        method ? fromMap(MEASUREMENT_METHOD_LABELS, method) : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  );
  rows.rest(r);
}

function parqRows(r: FieldReader, rows: Rows): { yes: { id: ParqQuestionId; detail?: string }[] } {
  const rawParq = r.get('parq');
  const parq = new FieldReader(isObject(rawParq) ? rawParq : {});
  parq.skip('version');
  r.skip('declarationsVersion');
  const answers = asObjects(parq.get('answers'));
  const yes: { id: ParqQuestionId; detail?: string }[] = [];
  const known = new Set<string>(PARQ_QUESTION_IDS);
  for (const id of PARQ_QUESTION_IDS) {
    const answer = answers.find((a) => a.questionId === id);
    const detail = asString(answer?.detail);
    if (answer?.answer === true) yes.push({ id, detail });
    rows.add(
      id,
      PARQ_QUESTION_TEXT[id],
      typeof answer?.answer === 'boolean'
        ? text(answer.answer ? 'Sim' : 'Não', answer.answer ? 'risk' : undefined)
        : null,
      detail && answer?.answer === true ? { detail } : undefined,
    );
  }
  for (const answer of answers.filter((a) => !known.has(String(a.questionId)))) {
    rows.add(
      String(answer.questionId),
      humanize(String(answer.questionId)),
      yesNo(answer.answer),
      asString(answer.detail) ? { detail: asString(answer.detail) } : undefined,
    );
  }
  const declarations = asArray(r.get('declarations'));
  if (declarations) {
    rows.add(
      'declarations',
      'Declarações finais',
      text(
        declarations.length >= PARQ_DECLARATION_COUNT
          ? `Aceitou as ${PARQ_DECLARATION_COUNT} declarações`
          : `${declarations.length} de ${PARQ_DECLARATION_COUNT} declarações aceitas`,
      ),
      {
        note: 'Informações verdadeiras, aviso de mudanças na saúde e ciência da revisão profissional.',
      },
    );
  }
  rows.rest(parq);
  rows.rest(r);
  return { yes };
}

// --- Pontos de atenção ------------------------------------------------------------------------

const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1) : s);

function attentionOf(
  view: AnamnesisAnswersView,
  parqYes: { id: ParqQuestionId; detail?: string }[],
) {
  const items: AttentionItem[] = parqYes.map(({ id, detail }) => ({
    id: `parq.${id}`,
    tone: 'attention',
    title: `PAR-Q: ${PARQ_RISK_FACTOR_LABEL[id]}`,
    detail: detail ?? PARQ_QUESTION_TEXT[id],
    step: 9,
  }));
  const data = (step: number): Data => view.steps.find((s) => s.step === step)?.data ?? {};

  const nutritionData = data(7);
  const allergies = asObjects(nutritionData.allergies);
  const severe = allergies.filter((a) => a.severity === 'SEVERE_ALLERGY');
  if (severe.length > 0) {
    items.push({
      id: 'allergies.severe',
      tone: 'attention',
      title: 'Alergia alimentar grave',
      detail: severe
        .map((a) => asString(a.allergen))
        .filter(Boolean)
        .join(', '),
      step: 7,
    });
  }

  const rawPain = data(6).pain;
  const painData = isObject(rawPain) ? rawPain : {};
  if (painData.hasPain === true) {
    const points = asObjects(painData.points).map(
      (p) => `${painPointLabel(p)} ${formatNumber(asNumber(p.intensity) ?? 0)} de 10`,
    );
    const trend = painData.trend ? labelFrom(TREND_ITEMS, painData.trend) : '';
    items.push({
      id: 'pain',
      tone: 'neutral',
      title: 'Dor ou desconforto ao treinar',
      detail: [points.join(', '), trend && `Evolução: ${trend.toLocaleLowerCase('pt-BR')}`]
        .filter(Boolean)
        .join(' · '),
      step: 6,
    });
    const avoid = asString(painData.avoidanceRecommendation);
    if (avoid) {
      items.push({
        id: 'pain.avoid',
        tone: 'neutral',
        title: 'Movimento a evitar',
        detail: avoid,
        step: 6,
      });
    }
  }

  const prefs = data(5);
  const conditions = asString(prefs.conditions);
  const medications = asString(prefs.medications);
  if (conditions) {
    items.push({
      id: 'conditions',
      tone: 'neutral',
      title: 'Condição de saúde',
      detail: conditions,
      step: 5,
    });
  }
  if (medications) {
    items.push({
      id: 'medications',
      tone: 'neutral',
      title: 'Medicamento em uso',
      detail: medications,
      step: 5,
    });
  }
  const guidance = asString(prefs.professionalGuidance);
  if (guidance) {
    items.push({
      id: 'guidance',
      tone: 'neutral',
      title: 'Orientação de profissional de saúde',
      detail: guidance,
      step: 5,
    });
  }
  const mild = allergies.filter((a) => a.severity !== 'SEVERE_ALLERGY');
  if (mild.length > 0) {
    items.push({
      id: 'allergies',
      tone: 'neutral',
      title: 'Alergia ou intolerância alimentar',
      detail: mild
        .map(
          (a) =>
            `${asString(a.allergen) ?? 'Alimento'} (${labelFrom(SEVERITY_ITEMS, a.severity).toLocaleLowerCase('pt-BR')})`,
        )
        .join(', '),
      step: 7,
    });
  }
  return items.map((item) => ({ ...item, title: capitalize(item.title) }));
}

// --- Montagem ---------------------------------------------------------------------------------

const BUILDERS: Readonly<Record<number, (r: FieldReader, rows: Rows, ctx: Context) => void>> = {
  1: registration,
  2: goals,
  3: modalities,
  4: routine,
  5: preferences,
  6: pain,
  7: nutrition,
  8: body,
};

const SKIPPED_NOTES: Readonly<Record<number, string>> = {
  8: 'Etapa opcional: o aluno não registrou medidas.',
};

export function readAnamnesis(view: AnamnesisAnswersView): AnamnesisReading {
  const modalitiesData = view.steps.find((s) => s.step === 3)?.data ?? {};
  const ctx: Context = {
    strengthSelected: asObjects(modalitiesData.modalities).some((m) => m.modality === 'STRENGTH'),
  };
  const expected =
    view.flow === 'COMPLEMENTARY' ? [2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const steps = [...new Set([...expected, ...view.steps.map((s) => s.step)])].sort((a, b) => a - b);
  let parqYes: { id: ParqQuestionId; detail?: string }[] = [];

  const sections = steps.map((step): AnswerSection => {
    const found = view.steps.find((s) => s.step === step);
    const rows = new Rows(`s${step}`);
    if (found) {
      const reader = new FieldReader(found.data);
      if (step === 9) parqYes = parqRows(reader, rows).yes;
      else if (BUILDERS[step]) BUILDERS[step](reader, rows, ctx);
      else rows.rest(reader);
    }
    const empty = rows.rows.length === 0;
    return {
      step,
      anchor: `anamnese-etapa-${step}`,
      title: found?.title || STEP_TITLES[step] || `Etapa ${step}`,
      sensitive: SENSITIVE_STEPS.has(step),
      rows: rows.rows,
      unanswered: rows.unanswered,
      ...(empty ? { skippedNote: SKIPPED_NOTES[step] ?? 'O aluno não respondeu esta etapa.' } : {}),
    };
  });

  const registrationData = view.steps.find((s) => s.step === 1)?.data ?? {};
  const hasParq = view.steps.some((s) => s.step === 9);
  return {
    studentName: asString(view.studentName) ?? asString(registrationData.name) ?? null,
    flowLabel: view.flow === 'COMPLEMENTARY' ? 'Anamnese complementar' : 'Anamnese inicial',
    submittedLabel: view.submittedAt ? `Enviada em ${formatDateTime(view.submittedAt)}` : null,
    attention: attentionOf(view, parqYes),
    parqClear: hasParq ? parqYes.length === 0 : null,
    sections,
  };
}
