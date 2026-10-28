/**
 * Gera as imagens SINTÉTICAS de avaliação da visão (prints de relógio/app e uma tela que não é
 * treino) e escreve `src/modules/vision/fixtures.generated.ts`. Não há dado de pessoa real: são
 * telas desenhadas com texto, com os valores exatos que a avaliação espera extrair.
 *
 *   node scripts/make-vision-fixtures.mjs
 */
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const W = 390;
const H = 700;

function svg(body, background = '#0b0f14') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${background}"/>${body}</svg>`;
}
const text = (x, y, size, content, fill = '#f4f7f3', weight = 400, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${content}</text>`;
const row = (y, label, value) =>
  text(28, y, 20, label, '#9aa7a0') + text(W - 28, y, 24, value, '#f4f7f3', 700, 'end');

const screens = {
  corridaPtBr: svg(
    text(28, 70, 26, 'Corrida ao ar livre', '#25e27e', 700) +
      text(28, 102, 17, 'seg., 2 de nov. · 06:12', '#9aa7a0') +
      text(28, 220, 92, '5,02', '#ffffff', 800) +
      text(28, 262, 26, 'quilômetros', '#9aa7a0') +
      row(350, 'Tempo', '28:14') +
      row(410, 'Ritmo médio', '5:37 /km') +
      row(470, 'FC média', '152 bpm') +
      row(530, 'Cadência', '172 ppm') +
      row(590, 'Ganho de elevação', '38 m'),
  ),
  ciclismoIngles: svg(
    text(28, 70, 26, 'Outdoor Cycle', '#ff6a3d', 700) +
      text(28, 102, 17, 'Sat, Nov 7 · 07:40', '#9aa7a0') +
      text(28, 220, 92, '32.4', '#ffffff', 800) +
      text(28, 262, 26, 'km', '#9aa7a0') +
      row(350, 'Time', '1:12:05') +
      row(410, 'Avg Speed', '27.0 km/h') +
      row(470, 'Avg HR', '141 bpm') +
      row(530, 'Elev Gain', '210 m'),
    '#10141c',
  ),
  naoTreino: svg(
    `<rect x="28" y="80" width="260" height="64" rx="16" fill="#25324a"/>` +
      text(44, 120, 20, 'Bora jantar hoje?') +
      `<rect x="102" y="170" width="260" height="64" rx="16" fill="#25e27e"/>` +
      text(118, 210, 20, 'Pode ser às 20h', '#06302a') +
      `<rect x="28" y="260" width="300" height="64" rx="16" fill="#25324a"/>` +
      text(44, 300, 20, 'Fechado, reservo a mesa') +
      text(W / 2, 640, 16, 'Mensagens', '#9aa7a0', 400, 'middle'),
    '#0e1624',
  ),
};

const lines = [
  '/**',
  ' * IMAGENS SINTÉTICAS de avaliação da visão (geradas por `scripts/make-vision-fixtures.mjs`).',
  ' * Telas desenhadas com texto — nenhuma pessoa real. NÃO editar à mão.',
  ' */',
];
for (const [name, content] of Object.entries(screens)) {
  const png = new Resvg(content, { font: { loadSystemFonts: true }, fitTo: { mode: 'original' } })
    .render()
    .asPng();
  lines.push(`export const ${name.replace(/([A-Z])/g, '_$1').toUpperCase()} = '${png.toString('base64')}';`);
  console.log(`${name}: ${(png.length / 1024).toFixed(1)} KB`);
}
writeFileSync(new URL('../src/modules/vision/fixtures.generated.ts', import.meta.url), lines.join('\n') + '\n');
