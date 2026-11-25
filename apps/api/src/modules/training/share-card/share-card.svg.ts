/**
 * Desenho dos cartões de Story (1080 × 1920), sempre com fundo transparente: o aluno cola a
 * imagem sobre a própria foto. Todas as coordenadas são absolutas e nenhum layout depende de
 * medir texto: a saída é idêntica em qualquer aparelho, porque quem desenha é o servidor. Os
 * textos variáveis são cortados num tamanho máximo para nunca vazar da área.
 *
 * O "Clássico" é o cartão da versão anterior, com as mesmas coordenadas; os outros modelos ficam
 * na parte de baixo, acima da faixa que o Instagram cobre com a barra de resposta.
 */
import {
  HYROX_STATION_LABELS,
  formatShareCardClock,
  formatShareCardDuration,
  formatShareCardKg,
  formatShareCardKm,
  shareCardModalityLabel,
  type ShareCardData,
  type ShareCardLayout,
  type ShareCardMuscle,
} from '@movivo/shared';

import {
  SHARE_CARD_FONT_FAMILY,
  type CardBody,
  type CardView,
  type ShareCardAssets,
} from './share-card.assets';

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1920;
const CENTER = SHARE_CARD_WIDTH / 2;
/** Faixa que o Instagram cobre com a barra de resposta: o bloco transparente termina antes. */
const STORY_BOTTOM_SAFE = 1700;

const GREEN = '#25E27E';

/** Cores sobre foto: texto claro, verde da marca e linhas translúcidas. */
interface Palette {
  fg: string;
  muted: string;
  accent: string;
  line: string;
  /** Traço do ✓ dentro do círculo verde. */
  check: string;
  barMuted: string;
}

const PALETTE: Palette = {
  fg: '#FFFFFF',
  muted: '#D8E8DF',
  accent: GREEN,
  line: '#FFFFFF',
  check: '#06271A',
  barMuted: '#9FD9BA',
};

// --- Primitivas ---------------------------------------------------------------------------------

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Corta o texto no limite de caracteres (com reticências) e escapa. */
export function clip(value: string, max: number): string {
  const text = value.trim();
  return esc(text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
}

interface TextOptions {
  x: number;
  y: number;
  size: number;
  fill: string;
  weight?: 400 | 700;
  anchor?: 'start' | 'middle' | 'end';
  spacing?: number;
  opacity?: number;
}

function text(content: string, o: TextOptions): string {
  return `<text x="${o.x}" y="${o.y}" font-size="${o.size}" font-weight="${o.weight ?? 400}" fill="${o.fill}" text-anchor="${o.anchor ?? 'middle'}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''}>${content}</text>`;
}

/** Valor grande com a unidade menor ao lado ("5,02 km"). */
function valueWithUnit(
  value: string,
  unit: string | null,
  o: Omit<TextOptions, 'weight'> & { unitSize?: number },
): string {
  const unitPart = unit
    ? `<tspan font-size="${o.unitSize ?? Math.round(o.size * 0.42)}" font-weight="400" dx="8">${esc(unit)}</tspan>`
    : '';
  return `<text x="${o.x}" y="${o.y}" font-size="${o.size}" font-weight="700" fill="${o.fill}" text-anchor="${o.anchor ?? 'middle'}">${esc(value)}${unitPart}</text>`;
}

function logo(assets: ShareCardAssets, _palette: Palette, width: number, y: number): string {
  const height = (width * 260) / 1000;
  return `<image href="${assets.logo}" x="${CENTER - width / 2}" y="${y}" width="${width}" height="${height}"/>`;
}

/** Selo "✓ TREINO CONCLUÍDO · CORRIDA": cápsula de largura fixa, texto centralizado. */
function badge(data: ShareCardData, palette: Palette, y: number): string {
  const label = `TREINO CONCLUÍDO · ${shareCardModalityLabel(data).toUpperCase()}`;
  return [
    `<rect x="${CENTER - 330}" y="${y}" width="660" height="68" rx="34" fill="none" stroke="${palette.accent}" stroke-width="2"/>`,
    `<circle cx="${CENTER - 290}" cy="${y + 34}" r="15" fill="${GREEN}"/>`,
    `<path d="M20 6 9 17l-5-5" transform="translate(${CENTER - 301} ${y + 23}) scale(0.9167)" fill="none" stroke="${palette.check}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    text(clip(label, 34), {
      x: CENTER + 15,
      y: y + 43,
      size: 23,
      fill: palette.accent,
      weight: 700,
      spacing: 2,
    }),
  ].join('');
}

function footer(palette: Palette, y: number): string {
  return `<text x="${CENTER}" y="${y}" font-size="28" fill="${palette.accent}" text-anchor="middle">Siga <tspan font-weight="700">@movivo.club</tspan></text>`;
}

function divider(palette: Palette, y: number, width = 820): string {
  return `<rect x="${CENTER - width / 2}" y="${y}" width="${width}" height="1.5" fill="${palette.line}" opacity="0.35"/>`;
}

// --- Números de cada modalidade --------------------------------------------------------------

interface Stat {
  label: string;
  value: string;
  unit: string | null;
}

const effort = (rpe: number | null): Stat | null =>
  rpe === null ? null : { label: 'ESFORÇO', value: String(Math.round(rpe)), unit: '/10' };

const duration = (seconds: number | null, label = 'TEMPO'): Stat | null =>
  seconds === null ? null : { label, value: formatShareCardDuration(seconds), unit: null };

/** Os números principais, na ordem de importância (o cartão usa os primeiros que couberem). */
export function statsOf(data: ShareCardData): Stat[] {
  const all: (Stat | null)[] = (() => {
    switch (data.modality) {
      case 'STRENGTH':
        return [
          duration(data.durationSeconds),
          data.volumeKg > 0
            ? { label: 'VOLUME', value: formatShareCardKg(data.volumeKg), unit: 'kg' }
            : null,
          { label: 'SÉRIES', value: String(data.sets), unit: null },
          { label: 'EXERCÍCIOS', value: String(data.exercises), unit: null },
          effort(data.rpe),
        ];
      case 'RUNNING':
        return [
          data.distanceMeters
            ? { label: 'DISTÂNCIA', value: formatShareCardKm(data.distanceMeters), unit: 'km' }
            : null,
          data.avgPaceSecondsPerKm
            ? {
                label: 'RITMO MÉDIO',
                value: formatShareCardDuration(data.avgPaceSecondsPerKm),
                unit: '/km',
              }
            : null,
          duration(data.durationSeconds),
          data.avgHeartRate
            ? { label: 'FC MÉDIA', value: String(data.avgHeartRate), unit: 'bpm' }
            : null,
          data.elevationGainMeters
            ? { label: 'SUBIDA', value: String(Math.round(data.elevationGainMeters)), unit: 'm' }
            : null,
          effort(data.rpe),
        ];
      case 'HYROX':
        return [
          duration(data.durationSeconds, 'TEMPO TOTAL'),
          data.runDistanceMeters
            ? { label: 'CORRIDA', value: formatShareCardKm(data.runDistanceMeters), unit: 'km' }
            : null,
          { label: 'ESTAÇÕES', value: String(data.stations.length), unit: null },
          data.rounds > 1 ? { label: 'VOLTAS', value: String(data.rounds), unit: null } : null,
          effort(data.rpe),
        ];
      case 'EXTERNAL_SPORT':
        return [duration(data.durationSeconds), effort(data.rpe)];
    }
  })();
  return all.filter((stat): stat is Stat => stat !== null);
}

/**
 * Unidade na linha corrida do "Destaque": número sem unidade leva o rótulo ("18 séries", "8
 * estações"), senão a linha vira uma sequência de números soltos.
 */
export function inlineUnit(stat: Stat): string {
  if (stat.unit) return stat.unit;
  return stat.label.startsWith('TEMPO') ? 'de treino' : stat.label.toLowerCase();
}

/** O número que ganha destaque no modelo "Destaque". */
function heroOf(data: ShareCardData, stats: readonly Stat[]): Stat {
  const pick = (label: string) => stats.find((s) => s.label === label);
  const hero =
    data.modality === 'RUNNING'
      ? (pick('DISTÂNCIA') ?? pick('TEMPO'))
      : data.modality === 'STRENGTH'
        ? (pick('VOLUME') ?? pick('TEMPO'))
        : (pick('TEMPO TOTAL') ?? pick('TEMPO'));
  return hero ?? stats[0] ?? { label: 'TREINO', value: '✓', unit: null };
}

// --- Blocos (cada modelo devolve a altura e o desenho a partir de y) -----------------------------

interface Block {
  height: number;
  draw: (y: number) => string;
}

/** Resumo: logo, selo, título e os números em grade de 2 colunas. */
function summaryBlock(assets: ShareCardAssets, data: ShareCardData, palette: Palette): Block {
  const stats = statsOf(data).slice(0, 4);
  const rows = Math.max(1, Math.ceil(stats.length / 2));
  const gridTop = 380;
  const rowHeight = 190;
  const height = gridTop + rows * rowHeight + 70;
  return {
    height,
    draw: (y) => {
      const cells = stats.map((stat, index) => {
        const single = stats.length === 1 || (stats.length % 2 === 1 && index === stats.length - 1);
        const x = single ? CENTER : index % 2 === 0 ? 315 : 765;
        const top = y + gridTop + Math.floor(index / 2) * rowHeight;
        return (
          text(stat.label, { x, y: top + 30, size: 24, fill: palette.muted, spacing: 4 }) +
          valueWithUnit(stat.value, stat.unit, { x, y: top + 122, size: 84, fill: palette.fg })
        );
      });
      return [
        logo(assets, palette, 360, y),
        badge(data, palette, y + 140),
        text(clip(data.title, 28), {
          x: CENTER,
          y: y + 300,
          size: 52,
          fill: palette.fg,
          weight: 700,
        }),
        divider(palette, y + gridTop - 30),
        ...cells,
        footer(palette, y + height - 10),
      ].join('');
    },
  };
}

/** Destaque: um número enorme, o rótulo dele e os outros números numa linha só. */
function highlightBlock(assets: ShareCardAssets, data: ShareCardData, palette: Palette): Block {
  const stats = statsOf(data);
  const hero = heroOf(data, stats);
  const rest = stats.filter((s) => s !== hero).slice(0, 3);
  const height = 760;
  return {
    height,
    draw: (y) =>
      [
        logo(assets, palette, 300, y),
        text(clip(data.title, 30), { x: CENTER, y: y + 170, size: 40, fill: palette.muted }),
        valueWithUnit(hero.value, hero.unit, {
          x: CENTER,
          y: y + 400,
          size: hero.value.length > 6 ? 170 : 220,
          fill: palette.fg,
          unitSize: 64,
        }),
        text(hero.label, {
          x: CENTER,
          y: y + 470,
          size: 30,
          fill: palette.accent,
          weight: 700,
          spacing: 8,
        }),
        divider(palette, y + 530, 700),
        rest.length > 0
          ? `<text x="${CENTER}" y="${y + 610}" font-size="38" fill="${palette.fg}" text-anchor="middle">${rest
              .map(
                (s, i) =>
                  `${i > 0 ? `<tspan fill="${palette.muted}">  ·  </tspan>` : ''}<tspan font-weight="700">${esc(s.value)}</tspan><tspan font-size="26" fill="${palette.muted}"> ${esc(inlineUnit(s))}</tspan>`,
              )
              .join('')}</text>`
          : '',
        footer(palette, y + height - 10),
      ].join(''),
  };
}

/** Parciais: o ritmo de cada km em barras (a mais rápida em verde cheio). */
function splitsBlock(assets: ShareCardAssets, data: ShareCardData, palette: Palette): Block {
  const splits = data.modality === 'RUNNING' ? data.splits.slice(0, 12) : [];
  const fastest = Math.min(...splits);
  const slowest = Math.max(...splits);
  const rowHeight = 62;
  const listTop = 300;
  const height = listTop + splits.length * rowHeight + 150;
  return {
    height,
    draw: (y) => {
      const rows = splits.map((pace, index) => {
        const top = y + listTop + index * rowHeight;
        // Mais rápido = barra mais longa; a mais lenta ainda tem 45% da largura.
        const share =
          slowest === fastest ? 1 : 0.45 + (0.55 * (slowest - pace)) / (slowest - fastest);
        const width = Math.round(560 * share);
        const best = pace === fastest;
        return (
          text(`${index + 1} km`, {
            x: 150,
            y: top + 38,
            size: 30,
            fill: palette.muted,
            anchor: 'start',
          }) +
          `<rect x="260" y="${top + 10}" width="${width}" height="38" rx="19" fill="${best ? GREEN : palette.barMuted}"/>` +
          text(formatShareCardDuration(pace), {
            x: 930,
            y: top + 40,
            size: 32,
            fill: best ? palette.accent : palette.fg,
            weight: 700,
            anchor: 'end',
          })
        );
      });
      const summary = statsOf(data)
        .filter((s) => ['DISTÂNCIA', 'TEMPO', 'RITMO MÉDIO'].includes(s.label))
        .map((s) => `${s.value}${s.unit ? ` ${s.unit}` : ''}`)
        .join('  ·  ');
      return [
        logo(assets, palette, 300, y),
        text('PARCIAIS POR KM', {
          x: CENTER,
          y: y + 190,
          size: 30,
          fill: palette.accent,
          weight: 700,
          spacing: 8,
        }),
        text(clip(data.title, 30), { x: CENTER, y: y + 245, size: 36, fill: palette.muted }),
        ...rows,
        divider(palette, y + listTop + splits.length * rowHeight + 20, 780),
        text(esc(summary), {
          x: CENTER,
          y: y + listTop + splits.length * rowHeight + 85,
          size: 34,
          fill: palette.fg,
          weight: 700,
        }),
        footer(palette, y + height - 10),
      ].join('');
    },
  };
}

/** Estações: o circuito do HYROX, uma por linha, com o tempo quando o relógio registrou. */
function stationsBlock(assets: ShareCardAssets, data: ShareCardData, palette: Palette): Block {
  const stations = data.modality === 'HYROX' ? data.stations.slice(0, 10) : [];
  const rowHeight = 72;
  const listTop = 320;
  const height = listTop + stations.length * rowHeight + 150;
  return {
    height,
    draw: (y) => {
      const rows = stations.map((item, index) => {
        const top = y + listTop + index * rowHeight;
        return (
          `<circle cx="172" cy="${top + 30}" r="20" fill="${GREEN}"/>` +
          `<path d="M20 6 9 17l-5-5" transform="translate(160 ${top + 18}) scale(1)" fill="none" stroke="${palette.check}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
          text(esc(HYROX_STATION_LABELS[item.station]), {
            x: 215,
            y: top + 42,
            size: 36,
            fill: palette.fg,
            weight: 700,
            anchor: 'start',
          }) +
          (item.seconds !== null
            ? text(formatShareCardDuration(item.seconds), {
                x: 910,
                y: top + 42,
                size: 34,
                fill: palette.muted,
                anchor: 'end',
              })
            : '') +
          (index < stations.length - 1
            ? `<rect x="215" y="${top + rowHeight - 6}" width="695" height="1" fill="${palette.line}" opacity="0.3"/>`
            : '')
        );
      });
      const total = statsOf(data).find((s) => s.label === 'TEMPO TOTAL');
      return [
        logo(assets, palette, 300, y),
        text('ESTAÇÕES', {
          x: CENTER,
          y: y + 190,
          size: 30,
          fill: palette.accent,
          weight: 700,
          spacing: 8,
        }),
        total
          ? valueWithUnit(total.value, null, { x: CENTER, y: y + 275, size: 72, fill: palette.fg })
          : text(clip(data.title, 30), {
              x: CENTER,
              y: y + 260,
              size: 40,
              fill: palette.fg,
              weight: 700,
            }),
        ...rows,
        footer(palette, y + height - 10),
      ].join('');
    },
  };
}

// --- Músculos (a composição do cartão antigo) ---------------------------------------------------

// Mesmo viewBox da ilustração em `js-rich-body-highlighter` (1365×2048 px a 96 dpi, em mm).
const PX2MM = 25.4 / 96;
const BODY_VIEWBOX = `0 0 ${1365 * PX2MM} ${2048 * PX2MM}`;

function body(
  assets: ShareCardAssets,
  kind: CardBody,
  view: CardView,
  groups: ReadonlySet<ShareCardMuscle>,
  x: number,
  y: number,
  width = 420,
): string {
  const key = `${kind}-${view}` as const;
  const paths = assets.muscles[key]
    .filter((mask) => groups.has(mask.group))
    .map(
      (mask) =>
        `<path d="${mask.d}" fill="${GREEN}" style="mix-blend-mode:hard-light" opacity="0.9"${mask.transform ? ` transform="${mask.transform}"` : ''}/>`,
    )
    .join('');
  const height = Math.round(width * (2048 / 1365) * 10) / 10;
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${BODY_VIEWBOX}"><g style="isolation:isolate"><image href="${assets.bodies[key]}" x="0" y="0" width="${1365 * PX2MM}" height="${2048 * PX2MM}"/>${paths}</g></svg>`;
}

/** Músculos: frente e costas com o que foi trabalhado em verde, e o tempo do treino. */
function musclesBlock(assets: ShareCardAssets, data: ShareCardData, palette: Palette): Block {
  const height = 1080;
  return {
    height,
    draw: (y) => {
      if (data.modality !== 'STRENGTH' || !data.body) return '';
      const groups = new Set(data.muscles);
      const bodies = (['front', 'back'] as const)
        .map((view, index) => {
          const x = index === 0 ? 110 : 550;
          return (
            body(assets, data.body as CardBody, view, groups, x, y + 300) +
            text(view === 'front' ? 'FRENTE' : 'COSTAS', {
              x: x + 210,
              y: y + 960,
              size: 22,
              fill: palette.muted,
              spacing: 6,
            })
          );
        })
        .join('');
      const time = statsOf(data).find((s) => s.label === 'TEMPO');
      return [
        logo(assets, palette, 360, y),
        badge(data, palette, y + 140),
        bodies,
        `<circle cx="${CENTER - 150}" cy="${y + 1012}" r="8" fill="${GREEN}"/>`,
        text('MÚSCULOS TRABALHADOS', {
          x: CENTER - 130,
          y: y + 1020,
          size: 22,
          fill: palette.muted,
          anchor: 'start',
          spacing: 3,
        }),
        time
          ? text(`Tempo de treino ${time.value}`, {
              x: CENTER,
              y: y + 270,
              size: 34,
              fill: palette.fg,
              weight: 700,
            })
          : '',
        footer(palette, y + height - 10),
      ].join('');
    },
  };
}

// --- Clássico (o cartão da versão anterior, mesmas coordenadas) ---------------------------------

/**
 * Larguras (px) dos textos fixos em Hanken Grotesk, medidas com o próprio resvg (+ o espaçamento
 * final). Servem só para centralizar o ícone ao lado do texto; mudar a fonte exige remedir.
 */
export const SHARE_CARD_TEXT_WIDTH = { badge: 247.5, legend: 247 } as const;

/** Cabelo desenhado sobre a silhueta feminina (a ilustração base é a mesma dos dois corpos). */
function hair(view: CardView, x: number, y: number): string {
  const id = `hair-${view}`;
  const scalp =
    view === 'front'
      ? 'M565 228 C557 182 565 137 600 119 C626 105 657 105 681 120 C714 138 724 182 715 228 L702 247 C705 210 693 182 681 160 C661 169 632 158 618 145 C591 160 579 202 578 247 Z'
      : 'M565 229 C557 183 565 138 599 119 C625 104 657 105 681 119 C713 137 724 183 715 229 L702 265 C685 276 663 271 643 263 C623 271 602 276 584 265 Z';
  const strands =
    view === 'front'
      ? 'M574 201 Q570 151 610 129 M584 181 Q589 147 615 137 M630 124 Q688 123 707 193 M637 135 Q681 139 699 178'
      : 'M577 234 Q566 163 619 127 M594 250 Q579 177 627 128 M613 258 Q596 186 636 130 M665 258 Q687 183 649 130 M687 248 Q709 175 658 127 M706 228 Q722 164 666 125';
  return `<svg x="${x}" y="${y}" width="360" height="540" viewBox="0 0 1280 1920"><defs><radialGradient id="${id}" cx="35%" cy="25%" r="80%"><stop offset="0" stop-color="#7e8791"/><stop offset="0.45" stop-color="#424a55"/><stop offset="1" stop-color="#1e252e"/></radialGradient></defs><g fill="url(#${id})" stroke="#343c46" stroke-width="3"><ellipse cx="642" cy="106" rx="40" ry="35"/><path d="${scalp}"/></g><g fill="none" stroke="#a0a8b0" stroke-width="2" opacity="0.4" stroke-linecap="round"><path d="M615 112 C607 93 627 79 645 81 M626 112 C618 98 637 85 654 90 M639 112 C634 100 651 95 666 104"/><path d="${strands}"/></g></svg>`;
}

/** Lado esquerdo do clássico na musculação: frente e costas com os músculos trabalhados. */
function classicBodies(
  assets: ShareCardAssets,
  kind: CardBody,
  muscles: readonly ShareCardMuscle[],
) {
  const groups = new Set(muscles);
  const legendContent = 13 + 12 + SHARE_CARD_TEXT_WIDTH.legend;
  const legendStart = 291 - legendContent / 2;
  const bodies = (['front', 'back'] as const)
    .map((view, index) => {
      const x = index === 0 ? -16 : 239;
      return (
        body(assets, kind, view, groups, x, 1115.7, 360) +
        (kind === 'female' ? hair(view, x, 1115.7) : '') +
        text(view === 'front' ? 'FRENTE' : 'COSTAS', {
          x: index === 0 ? 163.5 : 418.5,
          y: 1694.7,
          size: 17,
          fill: '#83a294',
          spacing: 5,
        })
      );
    })
    .join('');
  return (
    bodies +
    `<circle cx="${legendStart + 6.5}" cy="1759" r="6.5" fill="${GREEN}"/>` +
    text('MÚSCULOS TRABALHADOS', {
      x: legendStart + 25,
      y: 1764.8,
      size: 17,
      fill: '#a3c1b3',
      anchor: 'start',
      spacing: 2,
    })
  );
}

/**
 * Lado esquerdo do clássico nas outras modalidades (e na musculação sem silhueta): os números
 * principais empilhados, no lugar das silhuetas. O tempo fica do lado direito, como sempre.
 */
function classicStats(data: ShareCardData): string {
  const column = 270;
  const stats = statsOf(data)
    .filter((stat) => !stat.label.startsWith('TEMPO'))
    .slice(0, 3);
  const items: { label: string; value: string; unit: string | null; size: number }[] =
    data.modality === 'EXTERNAL_SPORT'
      ? [
          { label: 'ESPORTE', value: clip(data.sport, 14), unit: null, size: 58 },
          ...stats.map((stat) => ({ ...stat, value: esc(stat.value), size: 84 })),
        ]
      : stats.map((stat) => ({ ...stat, value: esc(stat.value), size: 84 }));
  const step = 190;
  const top = 1765 - items.length * step + 40;
  return items
    .map((item, index) => {
      const y = top + index * step;
      const unit = item.unit
        ? `<tspan font-size="34" font-weight="400" fill="#a3c1b3" dx="8">${esc(item.unit)}</tspan>`
        : '';
      return (
        text(item.label, { x: column, y, size: 19, fill: '#a3c1b3', spacing: 4 }) +
        `<text x="${column}" y="${y + item.size + 6}" font-size="${item.size}" font-weight="700" fill="#f4f7f5" text-anchor="middle">${item.value}${unit}</text>`
      );
    })
    .join('');
}

/** O cartão clássico inteiro: lado esquerdo da modalidade, marca e tempo do treino à direita. */
function classic(assets: ShareCardAssets, data: ShareCardData): string {
  const badgeContent = 30 + 15 + SHARE_CARD_TEXT_WIDTH.badge;
  const badgeStart = 798 - badgeContent / 2;
  const left =
    data.modality === 'STRENGTH' && data.body && data.muscles.length > 0
      ? classicBodies(assets, data.body, data.muscles)
      : classicStats(data);
  return `${left}
<image href="${assets.logo}" x="572" y="1184.3" width="452" height="117.5"/>
<rect x="573" y="1328.8" width="450" height="68" rx="34" fill="none" stroke="${GREEN}" stroke-width="2"/>
<circle cx="${badgeStart + 15}" cy="1362.8" r="15" fill="${GREEN}"/>
<path d="M20 6 9 17l-5-5" transform="translate(${badgeStart + 4} 1351.8) scale(0.9167)" fill="none" stroke="#06271A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
${text('TREINO CONCLUÍDO', { x: badgeStart + 45, y: 1371, size: 23, fill: GREEN, weight: 700, anchor: 'start', spacing: 2 })}
<rect x="572" y="1441.8" width="452" height="1" fill="#28553F"/>
<rect x="572" y="1579.1" width="452" height="1" fill="#28553F"/>
<g transform="translate(572 1487) scale(2)" fill="none" stroke="${GREEN}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6h4"/></g>
${text('Tempo de Treino', { x: 798, y: 1489.7, size: 19, fill: GREEN, spacing: 4 })}
${text(esc(formatShareCardClock(data.durationSeconds)), { x: 798, y: 1541.7, size: 46, fill: '#f4f7f5', weight: 700 })}
${text('MOVE YOUR POTENTIAL.', { x: 798, y: 1637.8, size: 24, fill: '#ffffff', weight: 700 })}
<text x="798" y="1693.8" font-size="25" fill="${GREEN}" text-anchor="middle">Siga <tspan font-weight="700">@movivo.club</tspan></text>`;
}

const BLOCKS: Readonly<
  Record<
    Exclude<ShareCardLayout, 'CLASSIC'>,
    (assets: ShareCardAssets, data: ShareCardData, palette: Palette) => Block
  >
> = {
  SUMMARY: summaryBlock,
  HIGHLIGHT: highlightBlock,
  MUSCLES: musclesBlock,
  SPLITS: splitsBlock,
  STATIONS: stationsBlock,
};

/** Cápsula decorativa da marca, cortada pela borda (mesma do cartão clássico). */
function accent(): string {
  const cx = 1055;
  const cy = 1830;
  return `<rect x="${cx - 249}" y="${cy - 74}" width="498" height="148" rx="74" fill="none" stroke="${GREEN}" stroke-width="2" opacity="0.5" transform="rotate(-48 ${cx} ${cy})"/>`;
}

export interface ShareCardSvgInput {
  data: ShareCardData;
  layout: ShareCardLayout;
}

export function buildShareCardSvg(assets: ShareCardAssets, input: ShareCardSvgInput): string {
  const content =
    input.layout === 'CLASSIC'
      ? classic(assets, input.data)
      : (() => {
          const block = BLOCKS[input.layout](assets, input.data, PALETTE);
          return block.draw(Math.max(60, STORY_BOTTOM_SAFE - block.height));
        })();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}" font-family="${SHARE_CARD_FONT_FAMILY}, sans-serif">
${accent()}
${content}
</svg>`;
}
