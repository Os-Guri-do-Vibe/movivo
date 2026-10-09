import type { ShareCardMuscle } from '@movivo/shared';

import {
  SHARE_CARD_FONT_FAMILY,
  type CardGender,
  type CardView,
  type ShareCardAssets,
} from './share-card.assets';

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1920;

const GREEN = '#25E27E';
// Mesmo viewBox da ilustração em `js-rich-body-highlighter` (1365×2048 px a 96 dpi, em mm).
const PX2MM = 25.4 / 96;
const BODY_VIEWBOX = `0 0 ${1365 * PX2MM} ${2048 * PX2MM}`;

/**
 * Larguras (px) dos textos fixos em Hanken Grotesk, medidas com o próprio resvg (+ o espaçamento final, como o CSS faz). Servem só para
 * centralizar o ícone ao lado do texto; mudar a fonte exige remedir (ver o spec).
 */
export const SHARE_CARD_TEXT_WIDTH = { badge: 247.5, legend: 247 } as const;

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface TextOptions {
  x: number;
  y: number;
  size: number;
  fill: string;
  weight?: 400 | 700;
  anchor?: 'start' | 'middle';
  spacing?: number;
}

function text(content: string, o: TextOptions): string {
  return `<text x="${o.x}" y="${o.y}" font-size="${o.size}" font-weight="${o.weight ?? 400}" fill="${o.fill}" text-anchor="${o.anchor ?? 'middle'}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}>${content}</text>`;
}

/** Corpo + máscaras dos músculos em destaque: mesma composição `hard-light` da prévia web. */
function body(
  assets: ShareCardAssets,
  gender: CardGender,
  view: CardView,
  groups: ReadonlySet<ShareCardMuscle>,
  x: number,
  y: number,
): string {
  const key = `${gender}-${view}` as const;
  const paths = assets.muscles[key]
    .filter((mask) => groups.has(mask.group))
    .map(
      (mask) =>
        `<path d="${mask.d}" fill="${GREEN}" style="mix-blend-mode:hard-light" opacity="0.9"${mask.transform ? ` transform="${mask.transform}"` : ''}/>`,
    )
    .join('');
  return `<svg x="${x}" y="${y}" width="360" height="540.1" viewBox="${BODY_VIEWBOX}"><g style="isolation:isolate"><image href="${assets.bodies[key]}" x="0" y="0" width="${1365 * PX2MM}" height="${2048 * PX2MM}"/>${paths}</g></svg>`;
}

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

function accent(cx: number, cy: number): string {
  // Cápsula 500×150 girada −48°, borda de 2 px (mesma geometria do card HTML original).
  return `<rect x="${cx - 249}" y="${cy - 74}" width="498" height="148" rx="74" fill="none" stroke="${GREEN}" stroke-width="2" opacity="0.5" transform="rotate(-48 ${cx} ${cy})"/>`;
}

export interface ShareCardSvgInput {
  gender: CardGender;
  groups: ReadonlySet<ShareCardMuscle>;
  durationLabel: string;
}

/**
 * Card de Story 1080×1920 com fundo transparente (o aluno sobrepõe a uma foto). Todas as
 * coordenadas são absolutas — o layout do card nunca depende de conteúdo —, então a saída é
 * idêntica em qualquer dispositivo: o que o navegador não decide, não pode variar.
 */
export function buildShareCardSvg(assets: ShareCardAssets, input: ShareCardSvgInput): string {
  const { gender, groups } = input;
  const font = `font-family="${SHARE_CARD_FONT_FAMILY}, sans-serif"`;
  const badgeContent = 30 + 15 + SHARE_CARD_TEXT_WIDTH.badge;
  const badgeStart = 798 - badgeContent / 2;
  const legendContent = 13 + 12 + SHARE_CARD_TEXT_WIDTH.legend;
  const legendStart = 291 - legendContent / 2;
  const bodies = (['front', 'back'] as const)
    .map((view, index) => {
      const x = index === 0 ? -16 : 239;
      return (
        body(assets, gender, view, groups, x, 1115.7) +
        (gender === 'female' ? hair(view, x, 1115.7) : '') +
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}" ${font}>
${accent(1055, 1830)}
${bodies}
<circle cx="${legendStart + 6.5}" cy="1759" r="6.5" fill="${GREEN}"/>
${text('MÚSCULOS TRABALHADOS', { x: legendStart + 25, y: 1764.8, size: 17, fill: '#a3c1b3', anchor: 'start', spacing: 2 })}
<image href="${assets.logo}" x="572" y="1184.3" width="452" height="117.5"/>
<rect x="573" y="1328.8" width="450" height="68" rx="34" fill="none" stroke="${GREEN}" stroke-width="2"/>
<circle cx="${badgeStart + 15}" cy="1362.8" r="15" fill="${GREEN}"/>
<path d="M20 6 9 17l-5-5" transform="translate(${badgeStart + 4} 1351.8) scale(0.9167)" fill="none" stroke="#06271A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
${text('TREINO CONCLUÍDO', { x: badgeStart + 45, y: 1371, size: 23, fill: GREEN, weight: 700, anchor: 'start', spacing: 2 })}
<rect x="572" y="1441.8" width="452" height="1" fill="#28553F"/>
<rect x="572" y="1579.1" width="452" height="1" fill="#28553F"/>
<g transform="translate(572 1487) scale(2)" fill="none" stroke="${GREEN}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6h4"/></g>
${text('Tempo de Treino', { x: 798, y: 1489.7, size: 19, fill: GREEN, spacing: 4 })}
${text(esc(input.durationLabel), { x: 798, y: 1541.7, size: 46, fill: '#f4f7f5', weight: 700 })}
${text('MOVE YOUR POTENTIAL.', { x: 798, y: 1637.8, size: 24, fill: '#ffffff', weight: 700 })}
<text x="798" y="1693.8" font-size="25" fill="${GREEN}" text-anchor="middle">Siga <tspan font-weight="700">@movivo.club</tspan></text>
</svg>`;
}
