/**
 * PDFs do protocolo enviados ao aluno pelo WhatsApp: o de treino (semana distribuída e cada
 * sessão em detalhe) e o de alimentação (metas por tipo de dia, refeições e orientações).
 * Gerados na hora a partir do plano vigente e nunca armazenados. Fontes padrão do PDF
 * (Helvetica, WinAnsi): texto vindo do modelo passa por `pdfText` para não sair corrompido.
 */
import PDFDocument from 'pdfkit';

import {
  EXTERNAL_SPORT_LABELS,
  HYROX_STATION_LABELS,
  RUNNING_SESSION_KIND_LABELS,
  type EnduranceTarget,
  type PlanSession,
} from '@movivo/shared';

export const COLOR = {
  petroleo: '#06302A',
  pulso: '#25E27E',
  coral: '#FF6A3D',
  nevoa: '#F4F7F3',
  grafite: '#14201C',
  musgo: '#5B6B63',
  branco: '#FFFFFF',
} as const;
const MARGIN = 48;
export const FOOTER =
  'Protocolo da equipe MOVIVO: profissionais de Educação Física (CREF) e Nutrição (CRN), usando IA como ferramenta. ' +
  'Sentiu dor, mal-estar ou ficou com dúvida? Fale com a gente pelo WhatsApp antes de seguir.';

export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const SLOT_LABELS: Record<string, string> = {
  MORNING: 'manhã',
  AFTERNOON: 'tarde',
  EVENING: 'noite',
  ANY: '',
};
export const ENERGY_LABELS: Record<string, string> = {
  DEFICIT: 'Déficit moderado de energia',
  MAINTENANCE: 'Manutenção de energia',
  SURPLUS: 'Superávit moderado de energia',
  RECOMPOSITION: 'Recomposição corporal',
  PERFORMANCE_FUELING: 'Energia para o desempenho',
};
export const SEGMENT_LABELS: Record<string, string> = {
  WARMUP: 'Aquecimento',
  STEADY: 'Contínuo',
  WORK: 'Estímulo',
  RECOVERY: 'Recuperação',
  STRIDES: 'Educativos/acelerações',
  COOLDOWN: 'Desaquecimento',
};
export const TECHNIQUE_LABELS: Record<string, string> = {
  DROP_SET: 'drop-set',
  REST_PAUSE: 'rest-pause',
  CLUSTER_SET: 'cluster',
  SUPERSET: 'superset',
  ISOMETRIC_HOLD: 'isometria',
  CONTROLLED_TEMPO: 'cadência controlada',
  PYRAMID: 'pirâmide',
};

type Doc = PDFKit.PDFDocument;

/** Segmento da URL pública (`/pdf/treino`) → protocolo. */
export const PLAN_PDF_KINDS = { treino: 'training', alimentacao: 'nutrition' } as const;
export type PlanPdfKind = keyof typeof PLAN_PDF_KINDS;

/** Mantém o que a fonte padrão do PDF desenha (Latin-1 e pontuação comum); o resto sai. */
export function pdfText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[^\n\x20-\x7E\u00A0-\u00FF–—‘’“”•…]/gu, '')
    .trim();
}

export function dayLabel(date: string, slot: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const short = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const when = SLOT_LABELS[slot];
  return `${WEEKDAYS[d.getUTCDay()] ?? ''}, ${short}${when ? ` · ${when}` : ''}`;
}

export function pace(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

export function targetLabel(target: EnduranceTarget): string {
  switch (target.by) {
    case 'ZONE':
      return `zona ${target.zone.slice(1)}`;
    case 'PACE':
      return `ritmo ${pace(target.secondsPerKm.min)}–${pace(target.secondsPerKm.max)}/km`;
    case 'HEART_RATE':
      return `FC ${target.bpm.min}–${target.bpm.max} bpm`;
    case 'RPE':
      return `esforço ${target.rpe.min}–${target.rpe.max}/10`;
  }
}

export function volume(distanceMeters?: number, durationSeconds?: number): string {
  if (distanceMeters !== undefined) {
    return distanceMeters >= 1000
      ? `${(distanceMeters / 1000).toLocaleString('pt-BR')} km`
      : `${distanceMeters} m`;
  }
  const seconds = durationSeconds ?? 0;
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

/** Linhas de detalhe de uma sessão, por modalidade. */
export function sessionLines(session: PlanSession): string[] {
  const { content } = session;
  if (content.modality === 'STRENGTH') {
    return [
      content.focus,
      ...content.exercises.map((e, i) => {
        const amount = e.durationSeconds
          ? `${e.sets} × ${volume(undefined, e.durationSeconds)}`
          : `${e.sets} × ${e.reps ? (e.reps.min === e.reps.max ? e.reps.min : `${e.reps.min}–${e.reps.max}`) : ''} reps`;
        const extras = [
          `descanso ${e.restSeconds} s`,
          e.rir !== undefined ? `${e.rir} rep. em reserva` : null,
          e.technique ? TECHNIQUE_LABELS[e.technique] : null,
          e.group ? `bloco ${e.group}` : null,
        ].filter(Boolean);
        const warmup = e.warmup?.length
          ? ` (aquecimento: ${e.warmup.map((w) => `${w.sets} × ${w.reps ? `${w.reps.min}–${w.reps.max}` : volume(undefined, w.durationSeconds)}`).join(', ')})`
          : '';
        return `${i + 1}. ${e.name} — ${amount} · ${extras.join(' · ')}${warmup}${e.notes ? `. ${e.notes}` : ''}`;
      }),
    ];
  }
  if (content.modality === 'RUNNING') {
    return [
      RUNNING_SESSION_KIND_LABELS[content.kind],
      ...content.segments.map((s) => {
        const reps = s.repeat && s.repeat > 1 ? `${s.repeat} × ` : '';
        const notes = s.notes ? `. ${s.notes}` : '';
        return `${SEGMENT_LABELS[s.type] ?? s.type}: ${reps}${volume(s.distanceMeters, s.durationSeconds)} · ${targetLabel(s.target)}${notes}`;
      }),
    ];
  }
  if (content.modality === 'HYROX') {
    return [
      content.rounds > 1 ? `${content.rounds} voltas pelo circuito:` : 'Circuito:',
      ...content.blocks.map((b) => {
        if (b.type === 'RUN') {
          return `Corrida ${volume(b.distanceMeters)} · ${targetLabel(b.target)}`;
        }
        if (b.type === 'REST') return `Pausa ${volume(undefined, b.durationSeconds)}`;
        const amount = b.reps ? `${b.reps} reps` : volume(b.distanceMeters, b.durationSeconds);
        return `${HYROX_STATION_LABELS[b.station]} — ${amount}${b.loadKg ? ` (${b.loadKg} kg)` : ''}`;
      }),
    ];
  }
  return [
    `${EXTERNAL_SPORT_LABELS[content.sport]}: ${content.plannedMinutes} min, esforço ~${content.plannedRpe}/10. Você já pratica; o plano se organiza em volta.`,
  ];
}

export function render(title: string, build: (doc: Doc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN + 24, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `MOVIVO — ${title}`, Author: 'MOVIVO' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    header(doc, title);
    build(doc);
    footers(doc);
    doc.end();
  });
}

function header(doc: Doc, title: string): void {
  const width = doc.page.width;
  doc.rect(0, 0, width, 96).fill(COLOR.petroleo);
  doc.fillColor(COLOR.branco).font('Helvetica-Bold').fontSize(24).text('MOVIVO', MARGIN, 30);
  doc.fillColor(COLOR.pulso).font('Helvetica').fontSize(10).text('move your potential', MARGIN, 60);
  doc
    .fillColor(COLOR.branco)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(title, MARGIN, 40, { width: width - MARGIN * 2, align: 'right' });
  doc.x = MARGIN;
  doc.y = 124;
}

function footers(doc: Doc): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // escrever no rodapé não pode abrir página nova
    const y = doc.page.height - MARGIN;
    doc
      .fillColor(COLOR.musgo)
      .font('Helvetica')
      .fontSize(7.5)
      .text(FOOTER, MARGIN, y - 10, { width: doc.page.width - MARGIN * 2 - 40 })
      .text(`${i + 1}/${range.count}`, doc.page.width - MARGIN - 30, y - 10, {
        width: 30,
        align: 'right',
      });
    doc.page.margins.bottom = bottom;
  }
}

export function heading(doc: Doc, text: string): void {
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.moveDown(0.8);
  doc.fillColor(COLOR.grafite).font('Helvetica-Bold').fontSize(14).text(pdfText(text), MARGIN);
  const y = doc.y + 2;
  doc
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + 36, y)
    .lineWidth(2)
    .strokeColor(COLOR.pulso)
    .stroke();
  doc.moveDown(0.6);
}

export function paragraph(doc: Doc, text: string, color: string = COLOR.grafite, size = 10): void {
  doc
    .fillColor(color)
    .font('Helvetica')
    .fontSize(size)
    .text(pdfText(text), MARGIN, doc.y, {
      width: doc.page.width - MARGIN * 2,
      lineGap: 2,
    });
}

export function bullets(doc: Doc, items: readonly string[], size = 10): void {
  for (const item of items) {
    doc
      .fillColor(COLOR.grafite)
      .font('Helvetica')
      .fontSize(size)
      .text(`•  ${pdfText(item)}`, MARGIN + 8, doc.y, {
        width: doc.page.width - MARGIN * 2 - 8,
        lineGap: 2,
      });
  }
}
