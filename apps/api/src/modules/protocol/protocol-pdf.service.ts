/**
 * Geração do PDF do protocolo (US-2.6-PDF), enviado ao aluno pelo WhatsApp após a
 * assinatura CREF (`DashboardService.signProtocol`). Reproduz 1:1 a estrutura e
 * estilização aprovadas em `/protocolo/[token]` (apps/web) — a página web nunca foi
 * pensada como produto final, foi o protótipo de design deste documento.
 *
 * Diferente da página web pública (IDOR-safe, sem PII no payload — `protocol.controller.ts`),
 * este PDF carrega dado pessoal real do aluno (nome, idade, peso, altura, sexo), porque
 * não é uma URL anônima: é gerado sob RLS no momento da assinatura e anexado direto na
 * conversa de WhatsApp daquele aluno específico.
 *
 * `pdfmake` (não headless-browser/Puppeteer): dependência leve, roda em qualquer processo
 * Node sem Chromium, e tabela com `headerRows` repete o cabeçalho sozinha em quebra de
 * página — essencial aqui, já que cada treino é uma tabela que pode crescer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pdfMake from 'pdfmake';
import type { Content, Table, TDocumentDefinitions } from 'pdfmake/interfaces';
import {
  ADVANCED_TECHNIQUE_LABELS,
  ageInYears,
  LOAD_STRATEGY_LABELS,
  PRIMARY_GOAL_LABELS,
  TRAINING_PHASE_LABELS,
  type AdvancedTechnique,
  type OnboardingStep1,
  type ProtocolExercise,
  type ProtocolSession,
  type ProtocolStructure,
} from '@movivo/shared';

const FONTS_DIR = join(__dirname, '../../../assets/fonts');
const BRAND_DIR = join(__dirname, '../../../assets/brand');

const COLOR = {
  petroleo: '#06302A',
  verdePulso: '#25E27E',
  coral: '#FF6A3D',
  coralTenue: '#FFF0EC',
  coralBorda: '#FFC3B1',
  grafite: '#14201C',
  musgo: '#5B6B63',
  nevoaElevada: '#E8EEE6',
  musgoTenue: '#D5DED2',
  branco: '#FFFFFF',
};

const PAGE_WIDTH_PT = 595.28; // A4
const MARGIN = { left: 40, top: 40, right: 40, bottom: 56 };

const WEEKDAY_LABELS: Record<string, string> = {
  MON: 'Segunda',
  TUE: 'Terça',
  WED: 'Quarta',
  THU: 'Quinta',
  FRI: 'Sexta',
  SAT: 'Sábado',
  SUN: 'Domingo',
};

const BIOLOGICAL_SEX_LABELS: Record<string, string> = {
  MALE: 'Masculino',
  FEMALE: 'Feminino',
};

const TECHNIQUE_GLOSSARY: Readonly<Record<AdvancedTechnique, string>> = {
  DROP_SET: 'Ao chegar perto da falha, reduz a carga e continua a série sem descansar.',
  REST_PAUSE: 'Pausa curta (10–20s) ao chegar perto da falha e continua a série com a mesma carga.',
  CLUSTER_SET: 'A série é dividida em blocos menores com pausas curtas entre eles.',
  BI_SET: 'Dois exercícios feitos em sequência, sem descanso entre eles.',
  TRI_SET: 'Três exercícios feitos em sequência, sem descanso entre eles.',
  SUPERSET: 'Dois exercícios de grupos musculares diferentes, feitos em sequência.',
  ISOMETRIA: 'Contração mantida numa posição fixa, sem movimento da articulação.',
  REPETICOES_CONTROLADAS: 'Execução com tempo controlado na descida e/ou na subida do movimento.',
  PIRAMIDE: 'A carga sobe (ou desce) a cada série, com as repetições variando na direção oposta.',
  DESCANSO_ATIVO: 'Movimento leve durante o intervalo, em vez de ficar parado.',
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
  // Restringe leitura de arquivo local só às fontes registradas acima (logo/símbolo
  // entram como data URI em `images`, nunca por caminho — não passam por esta política).
  pdfMake.setLocalAccessPolicy((path) => path.startsWith(FONTS_DIR));
  pdfMake.setUrlAccessPolicy(() => false);
  fontsRegistered = true;
}

function pngDataUri(filename: string): string {
  const buffer = readFileSync(join(BRAND_DIR, filename));
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/** "8–12 reps" para exercício tradicional, "40s" para isométrico/cardio. */
function amountLabel(entry: {
  durationSeconds?: number;
  reps?: { min: number; max: number };
}): string {
  if (entry.durationSeconds !== undefined) return `${entry.durationSeconds}s`;
  if (!entry.reps) return '';
  const { min, max } = entry.reps;
  return min === max ? `${min} reps` : `${min}–${max} reps`;
}

function sessionTitle(session: ProtocolSession): string {
  const day = session.weekday ? (WEEKDAY_LABELS[session.weekday] ?? session.weekday) : null;
  return day ? `${day} · ${session.dayLabel}` : session.dayLabel;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

/** Linha "rótulo em negrito : valor" — mesmo padrão da seção "Informações do aluno" da web. */
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

function exerciseTableBody(exercises: readonly ProtocolExercise[]): Table {
  const header = [
    { text: 'Exercício', style: 'tableHeader' },
    { text: 'Série', style: 'tableHeader' },
    { text: 'Repetição/Duração', style: 'tableHeader' },
    { text: 'Descanso', style: 'tableHeader' },
    { text: 'RIR', style: 'tableHeader' },
    { text: 'Técnica', style: 'tableHeader' },
    { text: 'Estratégia', style: 'tableHeader' },
    { text: 'Vídeo', style: 'tableHeader' },
  ];
  const rows = exercises.flatMap((exercise) => {
    // Blocos de aquecimento (opcionais, item 8): uma linha por bloco, ANTES da série
    // válida, com o nome do exercício mudo (mesmo padrão de "continuação" de linha)
    // e destacados em itálico/cinza pra não competir visualmente com a série válida.
    const warmupRows = (exercise.warmupBlocks ?? []).map((block, i) => [
      {
        text: i === 0 ? `${exercise.name} (aquecimento)` : '',
        fontSize: 8,
        italics: true,
        color: COLOR.musgo,
      },
      { text: String(block.sets), font: 'JetBrainsMono', fontSize: 8, color: COLOR.musgo },
      { text: amountLabel(block), font: 'JetBrainsMono', fontSize: 8, color: COLOR.musgo },
      {
        text: block.restSeconds !== undefined ? `${block.restSeconds}s` : '-',
        font: 'JetBrainsMono',
        fontSize: 8,
        color: COLOR.musgo,
      },
      { text: '-', font: 'JetBrainsMono', fontSize: 8, color: COLOR.musgo },
      { text: '-', fontSize: 8, color: COLOR.musgo },
      { text: '-', fontSize: 8, color: COLOR.musgo },
      { text: '-', fontSize: 8, color: COLOR.musgo },
    ]);
    const workingRow = [
      { text: exercise.name, fontSize: 9, bold: true, color: COLOR.grafite },
      { text: String(exercise.sets), font: 'JetBrainsMono', fontSize: 8.5 },
      { text: amountLabel(exercise), font: 'JetBrainsMono', fontSize: 8.5 },
      { text: `${exercise.restSeconds}s`, font: 'JetBrainsMono', fontSize: 8.5 },
      {
        text: exercise.rir !== undefined ? String(exercise.rir) : '-',
        font: 'JetBrainsMono',
        fontSize: 8.5,
      },
      {
        text: exercise.technique ? ADVANCED_TECHNIQUE_LABELS[exercise.technique] : '-',
        fontSize: 8.5,
      },
      { text: LOAD_STRATEGY_LABELS[exercise.loadStrategy], fontSize: 8.5 },
      {
        text: exercise.videoUrl ? 'Assistir' : '-',
        fontSize: 8.5,
        color: exercise.videoUrl ? COLOR.coral : COLOR.grafite,
      },
    ];
    return [...warmupRows, workingRow];
  });
  return {
    headerRows: 1,
    widths: ['*', 24, 68, 38, 18, 52, 58, 34],
    body: [header, ...rows],
  };
}

export interface ProtocolPdfStudent {
  name: string;
  birthDate: string;
  biologicalSex: OnboardingStep1['biologicalSex'];
  heightCm: number;
  weightKg: number;
}

export interface ProtocolPdfInput {
  content: ProtocolStructure;
  mesocycleName: string;
  startDate: Date;
  endDate: Date;
  totalWeeks: number;
  signatureHash: string | null;
  signedAt: Date | null;
  student: ProtocolPdfStudent;
}

export async function buildProtocolPdf(input: ProtocolPdfInput): Promise<Buffer> {
  ensureFontsRegistered();
  const { content } = input;

  const techniquesUsed = Array.from(
    new Set(
      content.sessions.flatMap((session) =>
        session.exercises.map((exercise) => exercise.technique).filter((t) => t !== undefined),
      ),
    ),
  );

  const explanation =
    content.generalNotes ??
    `Seu protocolo está na fase de ${TRAINING_PHASE_LABELS[content.phase] ?? content.phase}, ` +
      `estruturado para o seu objetivo de ${PRIMARY_GOAL_LABELS[content.goal] ?? content.goal}, ` +
      `com ${content.weeklyFrequency}x de treino por semana ao longo de ${input.totalWeeks} semanas. ` +
      `Ele foi planejado com apoio de inteligência artificial e revisado por um profissional de ` +
      `Educação Física registrado no CREF, que acompanha sua evolução.`;
  const explanationFull =
    `${explanation} Se sentir dor aguda, tontura ou mal-estar, pare o exercício imediatamente e ` +
    `avise seu profissional responsável antes de continuar.`;

  const sessionBlocks: Content[] = content.sessions.flatMap((session, i): Content[] => {
    const notes = session.exercises.filter((exercise) => exercise.notes);
    const block: Content[] = [
      {
        text: sessionTitle(session),
        style: 'h3',
        margin: [0, i === 0 ? 0 : 14, 0, 1],
      },
      { text: session.focus, style: 'muted', margin: [0, 0, 0, 6] },
      {
        table: exerciseTableBody(session.exercises),
        layout: {
          fillColor: (rowIndex: number) =>
            rowIndex === 0 ? COLOR.petroleo : rowIndex % 2 === 0 ? COLOR.nevoaElevada : null,
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => COLOR.musgoTenue,
          paddingLeft: () => 6,
          paddingRight: () => 6,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ];
    if (notes.length) {
      block.push({
        margin: [0, 4, 0, 0],
        stack: notes.map((exercise) => ({
          text: [
            { text: `${exercise.name}: `, bold: true, color: COLOR.grafite },
            { text: exercise.notes as string, color: COLOR.musgo },
          ],
          fontSize: 8.5,
          margin: [0, 0, 0, 2] as [number, number, number, number],
        })),
      });
    }
    return block;
  });

  // Cabeçalho do exercício vem branco/negrito por causa do style('tableHeader'); mas a cor de
  // fundo (petroleo) é pintada pelo `layout.fillColor` acima, não pela célula em si.
  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
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
      // Faixa de ponta a ponta (logo): a `background` acima pinta o retângulo; a imagem
      // é posicionada por cima com `absolutePosition`, então não some do fluxo vertical.
      { image: 'logo', width: 110, absolutePosition: { x: (PAGE_WIDTH_PT - 110) / 2, y: 28 } },
      // A faixa (`background`, page 1) tem 96pt de altura; o fluxo de conteúdo já começa em
      // `pageMargins.top` (40pt), então o espaçador só precisa cobrir os (96-40) restantes.
      { text: '', margin: [0, 66, 0, 0] },

      { text: 'Informações do aluno', style: 'h2', margin: [0, 0, 0, 8] },
      {
        columns: [
          {
            width: '*',
            stack: [
              infoRow('Nome', input.student.name),
              infoRow('Idade', `${ageInYears(input.student.birthDate)} anos`),
              infoRow('Objetivo', PRIMARY_GOAL_LABELS[content.goal] ?? content.goal),
              infoRow('Mesociclo', TRAINING_PHASE_LABELS[content.phase] ?? content.phase),
              infoRow('Data início do protocolo', formatDate(input.startDate), true),
            ],
          },
          {
            width: '*',
            stack: [
              infoRow('Peso atual', `${input.student.weightKg} kg`),
              infoRow('Altura', `${(input.student.heightCm / 100).toFixed(2).replace('.', ',')} m`),
              infoRow(
                'Sexo',
                BIOLOGICAL_SEX_LABELS[input.student.biologicalSex] ?? input.student.biologicalSex,
              ),
              infoRow('Frequência', `${content.weeklyFrequency}x por semana`),
              infoRow('Data final do protocolo', formatDate(input.endDate), true),
            ],
          },
        ],
        columnGap: 24,
        margin: [0, 0, 0, 18],
      },

      { text: 'Sobre o seu protocolo', style: 'h2', margin: [0, 0, 0, 8] },
      {
        table: {
          widths: ['*'],
          body: [[{ text: explanationFull, fontSize: 9.5, lineHeight: 1.35 }]],
        },
        layout: {
          fillColor: () => COLOR.coralTenue,
          hLineWidth: () => 1,
          vLineWidth: () => 1,
          hLineColor: () => COLOR.coralBorda,
          vLineColor: () => COLOR.coralBorda,
          paddingLeft: () => 12,
          paddingRight: () => 12,
          paddingTop: () => 10,
          paddingBottom: () => 10,
        },
        margin: [0, 0, 0, 18],
      },

      { text: 'Seus treinos', style: 'h2', margin: [0, 0, 0, 4] },
      ...sessionBlocks,

      { text: 'Legenda', style: 'h2', margin: [0, 18, 0, 6] },
      {
        fontSize: 8.5,
        color: COLOR.musgo,
        stack: [
          {
            text: [
              { text: 'RIR (Repetições em Reserva): ', bold: true, color: COLOR.grafite },
              'quantas repetições você ainda conseguiria fazer ao terminar a série, sendo RIR 0 até a falha.',
            ],
            margin: [0, 0, 0, 3] as [number, number, number, number],
          },
          ...techniquesUsed.map((technique) => ({
            text: [
              {
                text: `${ADVANCED_TECHNIQUE_LABELS[technique]}: `,
                bold: true,
                color: COLOR.grafite,
              },
              TECHNIQUE_GLOSSARY[technique],
            ],
            margin: [0, 0, 0, 3] as [number, number, number, number],
          })),
        ],
      },

      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: PAGE_WIDTH_PT - MARGIN.left - MARGIN.right,
            y2: 0,
            lineWidth: 0.5,
            lineColor: COLOR.musgoTenue,
          },
        ],
        margin: [0, 24, 0, 12],
      },
      { image: 'symbol', width: 26, alignment: 'center', margin: [0, 0, 0, 6] },
      {
        text: 'Metodologia revisada e assinada por um profissional de Educação Física registrado no CREF',
        alignment: 'center',
        fontSize: 8.5,
        font: 'JetBrainsMono',
        color: COLOR.musgo,
        margin: [0, 0, 0, 4],
      },
      ...(input.signatureHash
        ? [
            {
              text: `assinatura ${input.signatureHash.slice(0, 12)}${
                input.signedAt ? ` · ${formatDate(input.signedAt)}` : ''
              }`,
              alignment: 'center' as const,
              fontSize: 8.5,
              font: 'JetBrainsMono',
              color: COLOR.musgo,
            },
          ]
        : []),
    ],
    styles: {
      h2: { fontSize: 14, bold: true, color: COLOR.grafite },
      h3: { fontSize: 11.5, bold: true, color: COLOR.grafite },
      muted: { fontSize: 8.5, color: COLOR.musgo },
      tableHeader: { bold: true, color: COLOR.branco, fontSize: 8.5 },
    },
  };

  const pdf = pdfMake.createPdf(docDefinition);
  return pdf.getBuffer();
}
