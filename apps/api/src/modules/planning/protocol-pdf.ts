/**
 * PDFs do protocolo enviados ao aluno pelo WhatsApp: o de treino e o de alimentação. Gerados na
 * hora a partir do plano vigente e nunca armazenados.
 *
 * Design idêntico ao do PDF da versão anterior (`protocol-pdf.service.ts` da main): folha única
 * contínua (largura A4, altura automática; o aluno lê no celular e nenhuma tabela é cortada),
 * faixa petróleo com a marca centralizada, "Informações do aluno" em duas colunas, caixa coral
 * de explicação, uma tabela por treino (cabeçalho petróleo, linhas zebradas, contorno petróleo),
 * legenda e rodapé com o símbolo. Fontes Hanken Grotesk e JetBrains Mono.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pdfMake from 'pdfmake';
import type {
  Content,
  ContentTable,
  CustomTableLayout,
  Table,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import {
  externalSportName,
  normalizeFoodName,
  HYROX_STATION_LABELS,
  MEAL_SLOT_LABELS,
  SESSION_MODALITY_LABELS,
  type DailyTargets,
  type FreeMealOption,
  type FreeMeals,
  type MealOption,
  type NutritionPlanStructure,
  type PlanRead,
  type PlanSession,
  type StrengthExercise,
  type Weekday,
} from '@movivo/shared';

import { quantityLabel } from './calc/menu';
import {
  COLOR as BRAND,
  ENERGY_LABELS,
  pdfText,
  SEGMENT_LABELS,
  targetLabel,
  TECHNIQUE_LABELS,
  volume,
} from './plan-pdf';

const FONTS_DIR = join(__dirname, '../../../assets/fonts');
const BRAND_DIR = join(__dirname, '../../../assets/brand');

const COLOR = {
  ...BRAND,
  coralTenue: '#FFF0EC',
  coralBorda: '#FFC3B1',
  nevoaElevada: '#E8EEE6',
  musgoTenue: '#D5DED2',
} as const;

const PAGE_WIDTH_PT = 595.28; // A4
const MARGIN = { left: 40, top: 40, right: 40, bottom: 56 };
const CONTENT_WIDTH = PAGE_WIDTH_PT - MARGIN.left - MARGIN.right;

const LOAD_LABELS: Record<StrengthExercise['loadStrategy'], string> = {
  BODYWEIGHT: 'Peso corporal',
  FIXED_LOAD: 'Carga fixa',
  DOUBLE_PROGRESSION: 'Dupla progressão',
  RIR: 'Por reserva (RIR)',
};

const TECHNIQUE_GLOSSARY: Readonly<Record<string, string>> = {
  DROP_SET: 'Ao chegar perto da falha, reduz a carga e continua a série sem descansar.',
  REST_PAUSE: 'Pausa curta (10–20s) ao chegar perto da falha e continua a série com a mesma carga.',
  CLUSTER_SET: 'A série é dividida em blocos menores com pausas curtas entre eles.',
  SUPERSET: 'Dois exercícios feitos em sequência, sem descanso entre eles.',
  ISOMETRIC_HOLD: 'Contração mantida numa posição fixa, sem movimento da articulação.',
  CONTROLLED_TEMPO: 'Execução com tempo controlado na descida e/ou na subida do movimento.',
  PYRAMID: 'A carga sobe (ou desce) a cada série, com as repetições variando na direção oposta.',
};

let fontsRegistered = false;
function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  pdfMake.setFonts({
    Hanken: {
      normal: join(FONTS_DIR, 'HankenGrotesk-Regular.ttf'),
      bold: join(FONTS_DIR, 'HankenGrotesk-Bold.ttf'),
      italics: join(FONTS_DIR, 'HankenGrotesk-Regular.ttf'),
      bolditalics: join(FONTS_DIR, 'HankenGrotesk-Bold.ttf'),
    },
    JetBrainsMono: {
      normal: join(FONTS_DIR, 'JetBrainsMono-Regular.ttf'),
      bold: join(FONTS_DIR, 'JetBrainsMono-Bold.ttf'),
      italics: join(FONTS_DIR, 'JetBrainsMono-Regular.ttf'),
      bolditalics: join(FONTS_DIR, 'JetBrainsMono-Bold.ttf'),
    },
  });
  // Leitura de arquivo local só das fontes; logo e símbolo entram como data URI.
  pdfMake.setLocalAccessPolicy((path) => path.startsWith(FONTS_DIR));
  pdfMake.setUrlAccessPolicy(() => false);
  fontsRegistered = true;
}

function pngDataUri(filename: string): string {
  return `data:image/png;base64,${readFileSync(join(BRAND_DIR, filename)).toString('base64')}`;
}

const t = (text: string) => pdfText(text);
const br = (iso: string) => iso.split('-').reverse().join('/');

/** Data final do protocolo: início + semanas das fases − 1 dia. */
function endDate(startsOn: string, weeks: number): string {
  const date = new Date(`${startsOn}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7 - 1);
  return date.toISOString().slice(0, 10);
}

// --- Peças do layout (iguais às do PDF da main) -------------------------------------------------

/** Linha "rótulo em negrito : valor" da seção "Informações do aluno". */
function infoRow(label: string, value: string, mono = false): Content {
  return {
    columns: [
      { text: `${label}:`, bold: true, width: '*' },
      { text: value, alignment: 'right', font: mono ? 'JetBrainsMono' : 'Hanken', width: 'auto' },
    ],
    columnGap: 8,
    fontSize: 9.5,
    margin: [0, 0, 0, 5],
  };
}

function infoGrid(left: Content[], right: Content[]): Content {
  return {
    columns: [
      { width: '*', stack: left },
      { width: '*', stack: right },
    ],
    columnGap: 24,
    margin: [0, 0, 0, 18],
  };
}

const th = (text: string, alignment: 'left' | 'center' | 'right' = 'left'): TableCell => ({
  text,
  style: 'tableHeader',
  alignment,
});

const mono = (
  text: string,
  extra: {
    alignment?: 'left' | 'center' | 'right';
    bold?: boolean;
    fontSize?: number;
    color?: string;
  } = {},
): TableCell => ({ text, font: 'JetBrainsMono', fontSize: 8.5, ...extra });

/** Tabela no padrão do PDF: cabeçalho petróleo, linhas zebradas e contorno petróleo. */
function styledTable(table: Table): ContentTable {
  return {
    table,
    layout: {
      fillColor: (rowIndex: number) =>
        rowIndex === 0 ? COLOR.petroleo : rowIndex % 2 === 0 ? COLOR.nevoaElevada : null,
      hLineWidth: (rowIndex: number, node) =>
        rowIndex === 0 || rowIndex === node.table.body.length ? 1 : 0.5,
      // Contorno fino petróleo no perímetro (tudo ali pertence ao mesmo bloco); sem divisória vertical.
      vLineWidth: (colIndex: number, node) =>
        colIndex === 0 || colIndex === node.table.widths?.length ? 1 : 0,
      hLineColor: (rowIndex: number, node) =>
        rowIndex === 0 || rowIndex === node.table.body.length ? COLOR.petroleo : COLOR.musgoTenue,
      vLineColor: () => COLOR.petroleo,
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
  };
}

const legendLine = (term: string, text: string): Content => ({
  text: [{ text: `${term}: `, bold: true, color: COLOR.grafite }, text],
  margin: [0, 0, 0, 3],
});

/** Divisória e símbolo da marca: o rodapé não leva texto. */
function closing(): Content[] {
  return [
    {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: CONTENT_WIDTH,
          y2: 0,
          lineWidth: 0.5,
          lineColor: COLOR.musgoTenue,
        },
      ],
      margin: [0, 24, 0, 14],
    },
    { image: 'symbol', width: 26, alignment: 'center', margin: [0, 0, 0, 4] },
  ];
}

async function build(content: Content[], docTitle: string): Promise<Buffer> {
  ensureFontsRegistered();
  const definition: TDocumentDefinitions = {
    info: { title: `MOVIVO — ${docTitle}`, author: 'MOVIVO' },
    // Folha única contínua (largura A4, altura automática): ninguém imprime o protocolo.
    pageSize: { width: PAGE_WIDTH_PT, height: 'auto' },
    pageMargins: [MARGIN.left, MARGIN.top, MARGIN.right, MARGIN.bottom],
    defaultStyle: { font: 'Hanken', fontSize: 10, color: COLOR.grafite, lineHeight: 1.25 },
    background: (currentPage: number) =>
      currentPage === 1
        ? { canvas: [{ type: 'rect', x: 0, y: 0, w: PAGE_WIDTH_PT, h: 96, color: COLOR.petroleo }] }
        : null,
    images: {
      logo: pngDataUri('movivo-logo-horizontal.png'),
      symbol: pngDataUri('movivo-symbol.png'),
    },
    content: [
      // A faixa é pintada em `background`; o logo vai por cima, sem sair do fluxo vertical.
      { image: 'logo', width: 110, absolutePosition: { x: (PAGE_WIDTH_PT - 110) / 2, y: 28 } },
      // A faixa tem 96 pt e o fluxo já começa na margem de 40: o espaçador cobre os 56 restantes.
      { text: '', margin: [0, 66, 0, 0] },
      ...content,
      ...closing(),
    ],
    styles: {
      h2: { fontSize: 14, bold: true, color: COLOR.grafite },
      h3: { fontSize: 11.5, bold: true, color: COLOR.grafite },
      muted: { fontSize: 8.5, color: COLOR.musgo },
      tableHeader: { bold: true, color: COLOR.branco, fontSize: 8.5 },
    },
  };
  return pdfMake.createPdf(definition).getBuffer();
}

// --- Treino --------------------------------------------------------------------------------------

function restLabel(seconds: number): string {
  if (seconds <= 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function amount(entry: { durationSeconds?: number; reps?: { min: number; max: number } }): string {
  if (entry.durationSeconds !== undefined) return restLabel(entry.durationSeconds);
  if (!entry.reps) return '';
  const { min, max } = entry.reps;
  return min === max ? `${min} reps` : `${min}–${max} reps`;
}

type Align = 'left' | 'center' | 'right';

/** Rótulo de coluna: caixa-alta em mono, discreto, sobre a faixa clara. */
const colHead = (text: string, alignment: Align = 'left'): TableCell => ({
  text: text.toUpperCase(),
  font: 'JetBrainsMono',
  fontSize: 6.5,
  bold: true,
  characterSpacing: 0.6,
  color: COLOR.petroleo,
  alignment,
});

const spanRow = (columns: number, cell: object): Row => [
  { ...cell, colSpan: columns } as TableCell,
  ...Array.from({ length: columns - 1 }, () => ({}) as TableCell),
];

interface SessionTableSpec {
  widths: Table['widths'];
  head: TableCell[];
  rows: Row[];
}

/** Um treino = uma tabela: título e meta na barra petróleo, foco, colunas e as linhas do treino. */
function sessionTable(session: PlanSession, spec: SessionTableSpec): Content {
  const columns = spec.widths?.length ?? 1;
  const { content } = session;
  const kinds: RowKind[] = [];
  const body: Row[] = [];
  const push = (kind: RowKind, row: Row) => {
    kinds.push(kind);
    body.push(row);
  };
  push(
    'title',
    spanRow(columns, {
      columns: [
        { text: t(session.title), fontSize: 12, bold: true, color: COLOR.branco, width: '*' },
        {
          text: `${SESSION_MODALITY_LABELS[content.modality]}  ·  ${session.weeklyFrequency}×/sem  ·  ~${session.estimatedMinutes} min`,
          font: 'JetBrainsMono',
          fontSize: 7.5,
          color: COLOR.pulso,
          width: 'auto',
          margin: [0, 3, 0, 0],
        },
      ],
    }),
  );
  const focus = content.modality === 'STRENGTH' ? `${t(content.focus)}  ·  ` : '';
  push(
    'guidance',
    spanRow(columns, {
      text: `${focus}${t(session.purpose)}`,
      fontSize: 9,
      color: COLOR.grafite,
      lineHeight: 1.3,
    }),
  );
  push('columns', spec.head);
  spec.rows.forEach((row) => push('item', row));
  return {
    table: { widths: spec.widths, dontBreakRows: true, headerRows: 1, body },
    layout: premiumLayout(kinds, 6),
    margin: [0, 0, 0, 12],
  };
}

const num = (text: string, extra: { bold?: boolean; color?: string } = {}): TableCell =>
  mono(text, { alignment: 'center', fontSize: 9, ...extra });

function strengthSpec(exercises: readonly StrengthExercise[]): SessionTableSpec {
  return {
    widths: ['*', 34, 66, 54, 28],
    head: [
      colHead('Exercício'),
      colHead('Séries', 'center'),
      colHead('Reps / tempo', 'center'),
      colHead('Descanso', 'center'),
      colHead('RIR', 'center'),
    ],
    rows: exercises.map((e): Row => {
      const details = [
        e.technique ? `Técnica: ${TECHNIQUE_LABELS[e.technique] ?? e.technique}` : null,
        `Carga: ${LOAD_LABELS[e.loadStrategy].toLowerCase()}`,
        e.warmup?.length
          ? `Aquecimento: ${e.warmup.map((w) => `${w.sets} × ${amount(w)}`).join(' + ')}`
          : null,
        e.notes ? t(e.notes) : null,
      ].filter(Boolean);
      return [
        {
          stack: [
            { text: t(e.name), fontSize: 9.5, bold: true, color: COLOR.grafite },
            {
              text: details.join('  ·  '),
              fontSize: 7.5,
              color: COLOR.musgo,
              lineHeight: 1.3,
              margin: [0, 2, 0, 0],
            },
          ],
        },
        num(String(e.sets), { bold: true, color: COLOR.petroleo }),
        num(amount(e)),
        num(restLabel(e.restSeconds)),
        num(e.rir !== undefined ? String(e.rir) : '–'),
      ];
    }),
  };
}

function runningSpec(
  content: Extract<PlanSession['content'], { modality: 'RUNNING' }>,
): SessionTableSpec {
  return {
    widths: ['*', 54, 86, 96],
    head: [colHead('Etapa'), colHead('Volume'), colHead('Alvo'), colHead('Observação')],
    rows: content.segments.map((s): Row => [
      {
        text: `${SEGMENT_LABELS[s.type] ?? s.type}${s.repeat && s.repeat > 1 ? ` × ${s.repeat}` : ''}`,
        fontSize: 9.5,
        bold: true,
      },
      mono(volume(s.distanceMeters, s.durationSeconds), { fontSize: 8.5 }),
      mono(targetLabel(s.target), { fontSize: 8.5 }),
      { text: s.notes ? t(s.notes) : '–', fontSize: 8, color: COLOR.musgo },
    ]),
  };
}

function hyroxSpec(
  content: Extract<PlanSession['content'], { modality: 'HYROX' }>,
): SessionTableSpec {
  return {
    widths: ['*', 150],
    head: [colHead('Bloco'), colHead('Detalhe')],
    rows: content.blocks.map((b): Row => {
      if (b.type === 'RUN') {
        return [
          { text: 'Corrida', fontSize: 9.5, bold: true },
          mono(`${volume(b.distanceMeters)} · ${targetLabel(b.target)}`, { fontSize: 8.5 }),
        ];
      }
      if (b.type === 'REST') {
        return [
          { text: 'Pausa', fontSize: 9.5, bold: true },
          mono(volume(undefined, b.durationSeconds), { fontSize: 8.5 }),
        ];
      }
      const detail = b.reps ? `${b.reps} reps` : volume(b.distanceMeters, b.durationSeconds);
      return [
        { text: HYROX_STATION_LABELS[b.station], fontSize: 9.5, bold: true },
        mono(`${detail}${b.loadKg ? ` · ${b.loadKg} kg` : ''}`, { fontSize: 8.5 }),
      ];
    }),
  };
}

function externalSpec(
  content: Extract<PlanSession['content'], { modality: 'EXTERNAL_SPORT' }>,
): SessionTableSpec {
  return {
    widths: ['*', 110],
    head: [colHead('Atividade'), colHead('Duração e esforço')],
    rows: [
      [
        { text: t(externalSportName(content.sport, content.label)), fontSize: 9.5, bold: true },
        mono(`${content.plannedMinutes} min · esforço ~${content.plannedRpe}/10`, {
          fontSize: 8.5,
        }),
      ],
    ],
  };
}

function sessionSpec(session: PlanSession): SessionTableSpec {
  const { content } = session;
  if (content.modality === 'STRENGTH') return strengthSpec(content.exercises);
  if (content.modality === 'RUNNING') return runningSpec(content);
  if (content.modality === 'HYROX') return hyroxSpec(content);
  return externalSpec(content);
}

const LOAD_GLOSSARY: Readonly<Record<StrengthExercise['loadStrategy'], string>> = {
  BODYWEIGHT: 'o próprio peso do corpo é a carga.',
  FIXED_LOAD: 'use a carga indicada pelo profissional.',
  DOUBLE_PROGRESSION:
    'quando completar o topo da faixa de repetições em todas as séries, suba a carga.',
  RIR: 'escolha a carga que deixe as repetições em reserva indicadas ao fim da série.',
};

/** Dados do aluno que o PDF mostra no cabeçalho; vêm do perfil, não do plano (a página pública não os carrega). */
export interface PdfStudent {
  fullName: string | null;
  ageYears: number | null;
  /** Primeira pesagem registrada (a do cadastro). */
  initialWeightKg: number | null;
  heightCm: number | null;
  biologicalSex: 'MALE' | 'FEMALE' | null;
}

export function protocolPdfFileName(
  kind: 'treino' | 'alimentacao',
  fullName: string | null,
): string {
  const student = (fullName?.trim() || 'aluno')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const prefix = kind === 'treino' ? 'protocolo-de-treino' : 'plano-alimentar';
  return `${prefix}-${student || 'aluno'}.pdf`;
}

const SEX_LABELS = { MALE: 'Masculino', FEMALE: 'Feminino' } as const;
const WEEK: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  MON: 'Segunda',
  TUE: 'Terça',
  WED: 'Quarta',
  THU: 'Quinta',
  FRI: 'Sexta',
  SAT: 'Sábado',
  SUN: 'Domingo',
};

function weekdayOf(isoDate: string): Weekday {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return WEEK[(day + 6) % 7] as Weekday;
}

/**
 * Dias da semana de um treino: os que o profissional marcou na revisão; sem marcação, os dias em
 * que a agenda o colocou na primeira semana. Vazio = o dia ainda não foi definido.
 */
function sessionWeekdays(
  training: NonNullable<PlanRead['training']>,
  session: PlanSession,
): Weekday[] {
  const days = new Set<Weekday>(session.weekdays ?? []);
  if (days.size === 0) {
    // A agenda pode mudar de dia entre semanas: só as primeiras ocorrências (uma semana) valem.
    const first = training.upcoming
      .filter((occurrence) => occurrence.planSessionKey === session.key)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, session.weeklyFrequency);
    first.forEach((occurrence) => days.add(weekdayOf(occurrence.date)));
  }
  return WEEK.filter((day) => days.has(day));
}

interface DayGroup {
  /** `null` = treinos sem dia definido. */
  day: Weekday | null;
  sessions: PlanSession[];
}

/** Treinos agrupados pelos dias da semana (segunda a domingo); vários no mesmo dia ficam juntos. */
function weekGroups(
  training: NonNullable<PlanRead['training']>,
  sessions: readonly PlanSession[],
): DayGroup[] {
  const byDay = new Map<Weekday | null, PlanSession[]>();
  const add = (day: Weekday | null, session: PlanSession) =>
    byDay.set(day, [...(byDay.get(day) ?? []), session]);
  for (const session of sessions) {
    const days = sessionWeekdays(training, session);
    if (days.length === 0) add(null, session);
    else days.forEach((day) => add(day, session));
  }
  return [...WEEK, null]
    .filter((day) => byDay.has(day))
    .map((day) => ({ day, sessions: byDay.get(day) ?? [] }));
}

const dayName = (day: Weekday | null) => (day ? WEEKDAY_NAMES[day] : 'Dia a definir');

/** Visão rápida da semana: um dia por linha, com todos os treinos do dia. */
function weekOverview(groups: readonly DayGroup[]): Content {
  return styledTable({
    headerRows: 1,
    widths: [90, '*'],
    body: [
      [th('Dia'), th('Treino')],
      ...groups.map(({ day, sessions }): Row => [
        { text: dayName(day), fontSize: 9.5, bold: true },
        {
          stack: sessions.map((session): Content => ({
            text: [
              { text: t(session.title), bold: true, fontSize: 9.5 },
              {
                text: `  ·  ${SESSION_MODALITY_LABELS[session.content.modality]}  ·  ~${session.estimatedMinutes} min`,
                fontSize: 8,
                color: COLOR.musgo,
              },
            ],
          })),
        },
      ]),
    ],
  });
}

function dayHeading(day: Weekday | null): Content {
  return {
    columns: [
      {
        text: dayName(day).toUpperCase(),
        font: 'JetBrainsMono',
        fontSize: 9,
        bold: true,
        characterSpacing: 1,
        color: COLOR.petroleo,
        width: 'auto',
      },
      {
        width: '*',
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 5,
            x2: CONTENT_WIDTH - 90,
            y2: 5,
            lineWidth: 0.5,
            lineColor: COLOR.musgoTenue,
          },
        ],
      },
    ],
    columnGap: 8,
    margin: [0, 6, 0, 8],
    unbreakable: true,
  };
}

/** Os treinos dia a dia; um treino que se repete na semana só traz a tabela na primeira vez. */
function weekSessions(groups: readonly DayGroup[]): Content[] {
  const shown = new Map<string, Weekday | null>();
  return groups.flatMap(({ day, sessions }) => [
    dayHeading(day),
    ...sessions.map((session): Content => {
      const first = shown.get(session.key);
      if (first === undefined) {
        shown.set(session.key, day);
        return sessionTable(session, sessionSpec(session));
      }
      return {
        text: `${t(session.title)}: mesmo treino de ${dayName(first).toLowerCase()} (tabela acima).`,
        fontSize: 9,
        color: COLOR.musgo,
        margin: [0, 0, 0, 12],
      };
    }),
  ]);
}

const kg = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`;

export function trainingPlanPdf(plan: PlanRead, student?: PdfStudent): Promise<Buffer> {
  const training = plan.training;
  if (!training) throw new Error('aluno sem plano de treino ativo');
  const { structure } = training;
  const weeks = structure.phases.reduce((sum, p) => sum + p.weeks, 0);
  const perWeek = structure.sessions.reduce((sum, s) => sum + s.weeklyFrequency, 0);
  const phase = structure.phases[0]?.name ?? '-';
  const groups = weekGroups(training, structure.sessions);

  const exercises = structure.sessions.flatMap((s) =>
    s.content.modality === 'STRENGTH' ? s.content.exercises : [],
  );
  const techniques = Array.from(
    new Set(exercises.map((e) => e.technique).filter((x) => x !== undefined)),
  );
  const loads = Array.from(new Set(exercises.map((e) => e.loadStrategy)));
  const explanation = [plan.strategy?.studentMessage, structure.summary]
    .filter((x): x is string => Boolean(x))
    .map(t)
    .join(' ');
  const name = student?.fullName?.trim() || plan.firstName;

  const content: Content[] = [
    { text: 'Informações do aluno', style: 'h2', margin: [0, 0, 0, 8] },
    infoGrid(
      [
        infoRow('Nome', name ? t(name) : '-'),
        infoRow('Idade', student?.ageYears != null ? `${student.ageYears} anos` : '-'),
        infoRow('Objetivo', plan.strategy ? t(plan.strategy.title) : '-'),
        infoRow('Mesociclo', t(phase)),
        infoRow('Data início do protocolo', br(training.startsOn), true),
      ],
      [
        infoRow(
          'Peso inicial',
          student?.initialWeightKg != null ? kg(student.initialWeightKg) : '-',
          student?.initialWeightKg != null,
        ),
        infoRow(
          'Altura',
          student?.heightCm != null ? `${student.heightCm} cm` : '-',
          student?.heightCm != null,
        ),
        infoRow('Sexo', student?.biologicalSex ? SEX_LABELS[student.biologicalSex] : '-'),
        infoRow('Frequência', `${perWeek}x por semana`),
        infoRow('Data final do protocolo', br(endDate(training.startsOn, weeks)), true),
      ],
    ),
    ...sectionTitle('Sobre o seu protocolo', undefined, 4),
    summaryCard({
      label: 'Como o protocolo funciona',
      text: explanation,
      steps: [
        ['01', 'Siga os treinos nos dias da semana indicados no protocolo.'],
        ['02', 'Controle a carga pelo RIR: pare a série com as repetições em reserva indicadas.'],
        ['03', 'Dor aguda, tontura ou mal-estar: pare o exercício e avise a equipe.'],
      ],
    }),
    ...sectionTitle(
      'Sua semana base',
      'Estes são os dias de cada treino. Se precisar, você pode trocar ou ajustar durante a semana.',
    ),
    weekOverview(groups),
    ...sectionTitle(
      'Seus treinos',
      'Dia a dia, com séries, repetições, descanso e RIR (repetições em reserva).',
    ),
    ...weekSessions(groups),
    ...sectionTitle('Legenda', undefined, 14),
    {
      fontSize: 8.5,
      color: COLOR.musgo,
      stack: [
        legendLine(
          'RIR (Repetições em Reserva)',
          'quantas repetições você ainda conseguiria fazer ao terminar a série. RIR 0 é até a falha.',
        ),
        ...loads.map((load) => legendLine(LOAD_LABELS[load], LOAD_GLOSSARY[load])),
        ...techniques.map((x) => legendLine(TECHNIQUE_LABELS[x] ?? x, TECHNIQUE_GLOSSARY[x] ?? '')),
      ],
    },
  ];
  return build(content, 'Protocolo de treino');
}

// --- Alimentação ---------------------------------------------------------------------------------

const kcal = (n: number) => n.toLocaleString('pt-BR');
const liters = (ml: number) => `${(ml / 1000).toLocaleString('pt-BR')} L`;
const rangeValue = (d: DailyTargets) => `${kcal(d.energyKcal.min)}–${kcal(d.energyKcal.max)}`;
const brl = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const OPTION_LABELS = ['A', 'B', 'C'];

/** Grade do cardápio: 3 colunas fixas, todas as refeições alinhadas entre si. */
const MENU_WIDTHS: Table['widths'] = ['*', 96, 52];
/** Largura útil dentro de cada cartão de metas (a coluna não conta o preenchimento de 14 pt). */
const CARD_WIDTH = (CONTENT_WIDTH - 10 - 4 * 14) / 2;

const caps = (text: string, color: string = COLOR.musgo): Content => ({
  text: text.toUpperCase(),
  font: 'JetBrainsMono',
  fontSize: 7.5,
  bold: true,
  characterSpacing: 1,
  color,
});

/** Título de seção: texto + filete verde curto, igual em todas as seções. */
function sectionTitle(text: string, hint?: string, top = 22): Content[] {
  return [
    { text, style: 'h2', margin: [0, top, 0, 3] },
    {
      canvas: [{ type: 'rect', x: 0, y: 0, w: 28, h: 2.5, color: COLOR.pulso }],
      margin: [0, 0, 0, hint ? 5 : 10],
    },
    ...(hint ? [{ text: hint, style: 'muted', margin: [0, 0, 0, 10] } as Content] : []),
  ];
}

/**
 * Energia do dia em barras horizontais: treino e descanso lado a lado, na mesma escala, para o
 * aluno ver de relance quanto o dia de treino pede a mais.
 */
function energyChart(s: NutritionPlanStructure): Content {
  const top = Math.max(s.trainingDay.energyKcal.max, s.restDay.energyKcal.max);
  const labelW = 92;
  const valueW = 104;
  const trackW = CONTENT_WIDTH - labelW - valueW - 20;
  const row = (label: string, d: DailyTargets, color: string): Content => ({
    columns: [
      { text: label, width: labelW, fontSize: 9.5, bold: true, margin: [0, 1, 0, 0] },
      {
        width: trackW,
        canvas: [
          { type: 'rect', x: 0, y: 0, w: trackW, h: 11, r: 5.5, color: COLOR.nevoaElevada },
          {
            type: 'rect',
            x: 0,
            y: 0,
            w: (d.energyKcal.max / top) * trackW,
            h: 11,
            r: 5.5,
            color: COLOR.musgoTenue,
          },
          { type: 'rect', x: 0, y: 0, w: (d.energyKcal.min / top) * trackW, h: 11, r: 5.5, color },
        ],
      },
      {
        text: [
          { text: kcal(d.energyKcal.max), bold: true },
          { text: ' kcal', color: COLOR.musgo },
        ],
        width: valueW,
        alignment: 'right',
        font: 'JetBrainsMono',
        fontSize: 8.5,
        margin: [0, 1, 0, 0],
      },
    ],
    columnGap: 10,
    margin: [0, 0, 0, 9],
  });
  return {
    stack: [
      row('Dia de treino', s.trainingDay, COLOR.petroleo),
      row('Dia de descanso', s.restDay, COLOR.pulso),
    ],
  };
}

interface SummaryCard {
  label: string;
  text: string;
  steps: ReadonlyArray<readonly [string, string]>;
  note?: string;
}

/** Cartão de resumo: texto do plano e três regras de uso, em colunas iguais, com filete verde. */
function summaryCard({ label, text, steps, note }: SummaryCard): Content {
  return {
    table: {
      widths: [4, '*'],
      body: [
        [
          { text: '', fillColor: COLOR.pulso },
          {
            stack: [
              caps(label, COLOR.petroleo),
              { text, fontSize: 9.5, lineHeight: 1.4, margin: [0, 5, 0, 11] },
              {
                columns: steps.map(([n, step]) => ({
                  width: '*',
                  stack: [
                    {
                      text: n,
                      font: 'JetBrainsMono',
                      fontSize: 11,
                      bold: true,
                      color: COLOR.petroleo,
                    },
                    {
                      text: step,
                      fontSize: 8.5,
                      color: COLOR.musgo,
                      lineHeight: 1.3,
                      margin: [0, 3, 0, 0],
                    },
                  ],
                })),
                columnGap: 14,
              },
              ...(note
                ? [
                    {
                      text: note,
                      fontSize: 7.5,
                      color: COLOR.musgo,
                      margin: [0, 11, 0, 0],
                    } as Content,
                  ]
                : []),
            ],
          },
        ],
      ],
    },
    layout: {
      fillColor: (_row: number, _node: unknown, col: number) =>
        col === 0 ? COLOR.pulso : COLOR.nevoa,
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: (i: number) => (i === 0 ? 0 : 16),
      paddingRight: () => 16,
      paddingTop: () => 14,
      paddingBottom: () => 14,
    },
  };
}

type Row = TableCell[];
type RowKind = 'title' | 'guidance' | 'columns' | 'option' | 'item';

/**
 * Layout das tabelas premium (uma por refeição ou por treino): barra petróleo no título, faixa
 * clara para orientação, colunas e opções, e só linhas finas entre os itens. `inner` é o
 * respiro lateral entre colunas (as bordas externas têm sempre 12 pt).
 */
function premiumLayout(kinds: readonly RowKind[], inner = 12): CustomTableLayout {
  return {
    fillColor: (i: number) => {
      const kind = kinds[i];
      return kind === 'title'
        ? COLOR.petroleo
        : kind === 'option' || kind === 'columns'
          ? COLOR.nevoaElevada
          : kind === 'guidance'
            ? COLOR.nevoa
            : null;
    },
    hLineWidth: (i, node) => {
      if (i === 0 || i === node.table.body.length) return 0.75;
      return kinds[i] === 'item' && kinds[i - 1] === 'item' ? 0.5 : 0;
    },
    hLineColor: (i, node) =>
      i === 0 || i === node.table.body.length ? COLOR.petroleo : COLOR.musgoTenue,
    vLineWidth: (i, node) => (i === 0 || i === node.table.widths?.length ? 0.75 : 0),
    vLineColor: () => COLOR.musgoTenue,
    paddingLeft: (i) => (i === 0 ? 12 : inner),
    paddingRight: (i, node) => (i === (node.table.widths?.length ?? 1) - 1 ? 12 : inner),
    paddingTop: (i: number) => (kinds[i] === 'title' ? 9 : kinds[i] === 'item' ? 7 : 6),
    paddingBottom: (i: number) => (kinds[i] === 'title' ? 9 : kinds[i] === 'item' ? 7 : 6),
  };
}

const MACROS = [
  { key: 'proteinG', label: 'Proteína', kcalPerG: 4, color: COLOR.petroleo },
  { key: 'carbsG', label: 'Carboidrato', kcalPerG: 4, color: COLOR.pulso },
  { key: 'fatG', label: 'Gordura', kcalPerG: 9, color: COLOR.coral },
] as const;

/** Cartão de metas de um tipo de dia: energia em destaque, macros em barras e fibras/água. */
function targetCard(label: string, d: DailyTargets): Content[] {
  const total = MACROS.reduce((sum, m) => sum + d[m.key] * m.kcalPerG, 0);
  const nameW = 70;
  const valueW = 58;
  const trackW = CARD_WIDTH - nameW - valueW - 12;
  return [
    caps(label, COLOR.musgo),
    {
      text: [
        {
          text: rangeValue(d),
          font: 'JetBrainsMono',
          bold: true,
          fontSize: 17,
          color: COLOR.petroleo,
        },
        { text: '  kcal', font: 'JetBrainsMono', fontSize: 8.5, color: COLOR.musgo },
      ],
      margin: [0, 4, 0, 10],
    },
    ...MACROS.map((m): Content => {
      const share = (d[m.key] * m.kcalPerG) / total;
      return {
        columns: [
          { text: m.label, width: nameW, fontSize: 9 },
          {
            width: trackW,
            canvas: [
              { type: 'rect', x: 0, y: 2, w: trackW, h: 6, r: 3, color: COLOR.nevoaElevada },
              {
                type: 'rect',
                x: 0,
                y: 2,
                w: Math.max(share * trackW, 4),
                h: 6,
                r: 3,
                color: m.color,
              },
            ],
          },
          {
            text: [
              { text: `${d[m.key]} g`, bold: true },
              { text: ` ${Math.round(share * 100)}%`, color: COLOR.musgo },
            ],
            width: valueW,
            alignment: 'right',
            font: 'JetBrainsMono',
            fontSize: 8,
          },
        ],
        columnGap: 6,
        margin: [0, 0, 0, 6],
      };
    }),
    {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: CARD_WIDTH,
          y2: 0,
          lineWidth: 0.5,
          lineColor: COLOR.musgoTenue,
        },
      ],
      margin: [0, 4, 0, 7],
    },
    {
      columns: [
        {
          text: [
            { text: 'Fibras  ', color: COLOR.musgo },
            { text: `${d.fiberG} g`, bold: true },
          ],
          fontSize: 8.5,
        },
        {
          text: [
            { text: 'Água  ', color: COLOR.musgo },
            { text: liters(d.waterMl), bold: true },
          ],
          fontSize: 8.5,
          alignment: 'right',
        },
      ],
    },
  ];
}

function targetsCards(s: NutritionPlanStructure): Content {
  return {
    table: {
      widths: [CARD_WIDTH, CARD_WIDTH],
      body: [
        [
          { stack: targetCard('Dia de treino', s.trainingDay) },
          { stack: targetCard('Dia de descanso', s.restDay) },
        ],
      ],
    },
    layout: {
      fillColor: () => COLOR.nevoa,
      hLineWidth: () => 0,
      // O respiro entre os cartões é uma linha branca vertical.
      vLineWidth: (i: number) => (i === 1 ? 10 : 0),
      vLineColor: () => COLOR.branco,
      paddingLeft: () => 14,
      paddingRight: () => 14,
      paddingTop: () => 14,
      paddingBottom: () => 14,
    },
  };
}

/** Largura útil de cada um dos 3 cartões de refeição livre (miolo menos respiros e padding). */
const FREE_CARD_WIDTH = (CONTENT_WIDTH - 2 * 10 - 6 * 12) / 3;

const FREE_MEALS_HINT =
  'Elas fazem parte do plano, não são uma pausa nele. As calorias são aproximadas, só para você ter uma referência.';
const FREE_MEALS_GUIDANCE =
  'Tudo bem escolher outra refeição livre. Conte no WhatsApp da MOVIVO o que você está pensando, e a gente te ajuda a encaixar no seu dia.';

function freeMealCard(
  option: FreeMealOption,
  index: number,
): {
  number: Content;
  title: Content;
  description: Content;
  calories: Content;
  divider: Content;
  howTo: Content;
  fitTip: Content;
} {
  return {
    number: {
      text: String(index + 1).padStart(2, '0'),
      font: 'JetBrainsMono',
      fontSize: 11,
      bold: true,
      color: COLOR.petroleo,
      margin: [0, 12, 0, 0],
    },
    title: {
      text: t(option.title),
      fontSize: 10.5,
      bold: true,
      color: COLOR.grafite,
      lineHeight: 1.2,
      margin: [0, 4, 0, 3],
    },
    description: {
      text: t(option.description),
      fontSize: 8.5,
      color: COLOR.grafite,
      lineHeight: 1.3,
    },
    calories: {
      text: [
        {
          text: `~${kcal(option.energyKcal)}`,
          font: 'JetBrainsMono',
          bold: true,
          fontSize: 13,
          color: COLOR.petroleo,
        },
        { text: '  kcal', font: 'JetBrainsMono', fontSize: 8, color: COLOR.musgo },
      ],
      margin: [0, 8, 0, 8],
    },
    divider: {
      canvas: [
        {
          type: 'line',
          x1: 0,
          y1: 0,
          x2: FREE_CARD_WIDTH,
          y2: 0,
          lineWidth: 0.5,
          lineColor: COLOR.musgoTenue,
        },
      ],
      margin: [0, 0, 0, 6],
    },
    howTo: caps('Como encaixar', COLOR.musgo),
    fitTip: {
      text: t(option.fitTip),
      fontSize: 8,
      color: COLOR.musgo,
      lineHeight: 1.3,
      margin: [0, 3, 0, 12],
    },
  };
}

/**
 * Refeições livres: frequência semanal e três opções prévias lado a lado, mais a orientação de
 * escolher outra com a ajuda da MOVIVO. Bloco indivisível: nenhum cartão sai cortado.
 */
function freeMealsSection(free: FreeMeals): Content {
  const cards = free.options.map(freeMealCard);
  const cardRows = [
    cards.map((card) => card.number),
    cards.map((card) => card.title),
    cards.map((card) => card.description),
    cards.map((card) => card.calories),
    cards.map((card) => card.divider),
    cards.map((card) => card.howTo),
    cards.map((card) => card.fitTip),
  ];
  return {
    unbreakable: true,
    stack: [
      {
        columns: [
          { text: 'Refeições livres', style: 'h2', width: 'auto' },
          {
            width: 'auto',
            margin: [0, 2, 0, 0],
            table: { body: [[caps(`${free.perWeek}x por semana`, COLOR.pulso)]] },
            layout: {
              fillColor: () => COLOR.petroleo,
              hLineWidth: () => 0,
              vLineWidth: () => 0,
              paddingLeft: () => 7,
              paddingRight: () => 7,
              paddingTop: () => 3,
              paddingBottom: () => 3,
            },
          },
        ],
        columnGap: 8,
        margin: [0, 22, 0, 3],
      },
      {
        canvas: [{ type: 'rect', x: 0, y: 0, w: 28, h: 2.5, color: COLOR.pulso }],
        margin: [0, 0, 0, 5],
      },
      { text: FREE_MEALS_HINT, style: 'muted', margin: [0, 0, 0, 10] },
      {
        table: {
          widths: [FREE_CARD_WIDTH, FREE_CARD_WIDTH, FREE_CARD_WIDTH],
          dontBreakRows: true,
          body: cardRows,
        },
        layout: {
          fillColor: () => COLOR.nevoa,
          hLineWidth: () => 0,
          vLineWidth: (i: number) => (i === 1 || i === 2 ? 10 : 0),
          vLineColor: () => COLOR.branco,
          paddingLeft: () => 12,
          paddingRight: () => 12,
          paddingTop: () => 0,
          paddingBottom: () => 0,
        },
      },
      {
        margin: [0, 10, 0, 0],
        table: {
          widths: [4, '*'],
          body: [
            [
              { text: '', fillColor: COLOR.pulso },
              {
                fillColor: COLOR.nevoa,
                stack: [
                  caps('E se der vontade de outra coisa?', COLOR.petroleo),
                  {
                    text: t(free.guidance.trim() || FREE_MEALS_GUIDANCE),
                    fontSize: 9,
                    lineHeight: 1.35,
                    margin: [0, 5, 0, 0],
                  },
                ],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingLeft: (i: number) => (i === 1 ? 16 : 0),
          paddingRight: () => 0,
          paddingTop: () => 12,
          paddingBottom: () => 12,
        },
      },
    ],
  };
}

/**
 * Uma refeição = uma tabela: barra petróleo com o nome e a meta, a orientação e, uma abaixo da
 * outra, as opções (A, B, C) com os alimentos e a quantidade. As trocas ficam sob o alimento.
 */
function mealTable(meal: NutritionPlanStructure['meals'][number]): Content {
  const options = meal.options ?? [];
  const meanKcal = options.length
    ? Math.round(options.reduce((sum, o) => sum + o.totals.energyKcal, 0) / options.length)
    : null;
  const kinds: RowKind[] = [];
  const body: Row[] = [];
  const push = (kind: RowKind, row: Row) => {
    kinds.push(kind);
    body.push(row);
  };
  const span = (cell: object): Row => [{ ...cell, colSpan: 3 } as TableCell, {}, {}];

  push(
    'title',
    span({
      columns: [
        {
          text: MEAL_SLOT_LABELS[meal.slot],
          fontSize: 12,
          bold: true,
          color: COLOR.branco,
          width: '*',
        },
        {
          text: [
            `~${Math.round(meal.energyShare * 100)}%`,
            meanKcal ? `~${kcal(meanKcal)} kcal` : null,
            `${meal.proteinG} g prot.`,
          ]
            .filter(Boolean)
            .join('  ·  '),
          font: 'JetBrainsMono',
          fontSize: 7.5,
          color: COLOR.pulso,
          width: 'auto',
          margin: [0, 3, 0, 0],
        },
      ],
    } as TableCell),
  );
  push(
    'guidance',
    span({ text: t(meal.guidance), fontSize: 9, color: COLOR.grafite, lineHeight: 1.3 }),
  );

  if (options.length === 0) {
    meal.examples.forEach((example) =>
      push('item', span({ text: `•  ${t(example)}`, fontSize: 9.5 })),
    );
  }
  options.forEach((option: MealOption, oi) => {
    push(
      'option',
      span({
        columns: [
          {
            text: `OPÇÃO ${OPTION_LABELS[oi] ?? oi + 1}  ·  ${t(option.title)}`,
            fontSize: 8.5,
            bold: true,
            color: COLOR.petroleo,
            width: '*',
          },
          {
            text: `${option.totals.energyKcal} kcal  ·  ${Math.round(option.totals.proteinG)} g prot.`,
            font: 'JetBrainsMono',
            fontSize: 7.5,
            color: COLOR.musgo,
            width: 'auto',
            margin: [0, 1, 0, 0],
          },
        ],
      } as TableCell),
    );
    option.items.forEach((item) =>
      push('item', [
        {
          stack: [
            {
              text: t(normalizeFoodName(item.name)),
              fontSize: 9.5,
              bold: true,
              color: COLOR.grafite,
            },
            ...(item.swaps.length > 0
              ? [
                  {
                    text: `Troque por: ${item.swaps
                      .map((swap) => `${quantityLabel(swap)} de ${t(normalizeFoodName(swap.name))}`)
                      .join(' · ')}`,
                    fontSize: 7.5,
                    color: COLOR.musgo,
                    lineHeight: 1.3,
                    margin: [0, 2, 0, 0],
                  } as Content,
                ]
              : []),
          ],
        },
        { text: quantityLabel(item), fontSize: 9.5, bold: true, color: COLOR.petroleo },
        mono(`${item.energyKcal} kcal`, { alignment: 'right', fontSize: 8, color: COLOR.musgo }),
      ]),
    );
  });

  return {
    table: { widths: MENU_WIDTHS, dontBreakRows: true, headerRows: 1, body },
    layout: premiumLayout(kinds),
    margin: [0, 0, 0, 12],
  };
}

/** Orientações numeradas, em duas colunas alinhadas (número e texto). */
function guidelinesTable(guidelines: readonly string[]): Content {
  return {
    table: {
      widths: [22, '*'],
      body: guidelines.map((g, i): Row => [
        mono(String(i + 1).padStart(2, '0'), { bold: true, color: COLOR.petroleo }),
        { text: t(g), fontSize: 9.5, lineHeight: 1.35 },
      ]),
    },
    layout: {
      hLineWidth: (i: number, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
      hLineColor: () => COLOR.musgoTenue,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 8,
      paddingBottom: () => 8,
    },
  };
}

export function nutritionPlanPdf(plan: PlanRead, student?: PdfStudent): Promise<Buffer> {
  const nutrition = plan.nutrition;
  if (!nutrition) throw new Error('aluno sem plano alimentar ativo');
  const s = nutrition.structure;
  const hasMenu = s.meals.some((meal) => (meal.options?.length ?? 0) > 0);
  const daily = s.estimatedDailyCostBrl;
  const waterMin = Math.min(s.trainingDay.waterMl, s.restDay.waterMl);
  const waterMax = Math.max(s.trainingDay.waterMl, s.restDay.waterMl);

  const content: Content[] = [
    { text: 'Informações do aluno', style: 'h2', margin: [0, 0, 0, 8] },
    infoGrid(
      [
        infoRow(
          'Nome',
          student?.fullName?.trim()
            ? t(student.fullName.trim())
            : plan.firstName
              ? t(plan.firstName)
              : '-',
        ),
        infoRow('Estratégia', ENERGY_LABELS[s.strategy] ?? s.strategy),
        infoRow('Refeições por dia', String(s.meals.length)),
        infoRow('Data início do plano', br(plan.training?.startsOn ?? nutrition.startsOn), true),
      ],
      [
        infoRow('Proteína por dia', `${s.trainingDay.proteinG} g`, true),
        infoRow(
          'Água por dia',
          waterMin === waterMax ? liters(waterMax) : `${liters(waterMin)} a ${liters(waterMax)}`,
          true,
        ),
        infoRow('Custo estimado', daily ? `${brl(daily)} por dia` : 'não estimado', Boolean(daily)),
        infoRow(
          'Data fim do plano',
          plan.training
            ? br(
                endDate(
                  plan.training.startsOn,
                  plan.training.structure.phases.reduce((sum, phase) => sum + phase.weeks, 0),
                ),
              )
            : '-',
          true,
        ),
      ],
    ),
    ...sectionTitle('Caloria do dia', 'Quantas calorias cada tipo de dia pede.', 4),
    energyChart(s),
    ...sectionTitle('Sobre o seu plano alimentar'),
    summaryCard({
      label: 'Como o plano funciona',
      text: t(s.summary),
      steps: hasMenu
        ? [
            ['01', 'Escolha uma opção (A, B ou C) em cada refeição.'],
            ['02', 'Use as trocas equivalentes para variar sem mudar o resultado.'],
            ['03', 'As metas valem pela média da semana, não por um dia perfeito.'],
          ]
        : [
            ['01', 'Use os exemplos como ideias, não como obrigação.'],
            ['02', 'Mantenha a proteína distribuída ao longo do dia.'],
            ['03', 'As metas valem pela média da semana, não por um dia perfeito.'],
          ],
    }),
    ...sectionTitle(
      'Metas do dia',
      'Faixas de referência, não números para perseguir à risca. Cada barra mostra a parte das calorias que vem de cada macronutriente.',
    ),
    targetsCards(s),
    ...sectionTitle(
      hasMenu ? 'Seu cardápio' : 'Suas refeições',
      hasMenu
        ? 'Uma tabela por refeição. Escolha uma opção e, se quiser variar, use a troca indicada embaixo do alimento.'
        : 'Como distribuir o seu dia. Os exemplos são ideias, não obrigações.',
    ),
    ...s.meals.map(mealTable),
    ...(s.freeMeals ? [freeMealsSection(s.freeMeals)] : []),
    ...sectionTitle('Orientações', undefined, 14),
    guidelinesTable(s.guidelines),
    ...(s.supplements.length > 0
      ? [
          ...sectionTitle('Suplementos', 'Apenas dentro do que a metodologia de nutrição permite.'),
          styledTable({
            headerRows: 1,
            widths: [110, '*'],
            body: [
              [th('Suplemento'), th('Orientação')],
              ...s.supplements.map((sup): Row => [
                { text: t(sup.name), fontSize: 9, bold: true },
                { text: t(sup.guidance), fontSize: 8.5 },
              ]),
            ],
          }),
        ]
      : []),
    {
      text: 'Quantidades de alimentos prontos para comer, conforme a Tabela Brasileira de Composição de Alimentos (TACO): unidades para o que se conta, ml para líquidos e gramas para o resto. O custo é uma estimativa com preços médios de supermercado e varia por região e época.',
      style: 'muted',
      lineHeight: 1.35,
      margin: [0, 18, 0, 0],
    },
  ];
  return build(content, 'Protocolo alimentar');
}
