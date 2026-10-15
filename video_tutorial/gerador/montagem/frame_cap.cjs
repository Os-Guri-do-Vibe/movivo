// Moldura reduzida (86%) e mais alta, abrindo uma faixa embaixo para a legenda.
const { chromium } = require(require.resolve('@playwright/test', { paths: [require('path').resolve(__dirname, '../../../apps/web')] }));
const fs = require('fs'), path = require('path');
const G = { dx: 171, dy: 40, dw: 738, dh: 1570, dr: 98, sx: 183, sy: 52, sw: 714, sh: 1546, sr: 86 };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.addInitScript((l) => { window.LOGO = l; }, JSON.parse(fs.readFileSync(path.join(__dirname, 'logo_parts.json'), 'utf8')));
  await p.goto(require('url').pathToFileURL(path.join(__dirname, 'scene.html')).href);
  await p.evaluate(() => render('frame', 0));
  await p.evaluate((g) => {
    const d = document.getElementById('device');
    Object.assign(d.style, { left: g.dx + 'px', top: g.dy + 'px', width: g.dw + 'px', height: g.dh + 'px', borderRadius: g.dr + 'px' });
    const r = g.sr, x0 = g.sx, y0 = g.sy, x1 = g.sx + g.sw, y1 = g.sy + g.sh;
    const hole = `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;
    const svg = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1080' height='1920'><path fill-rule='evenodd' fill='white' d='M0 0H1080V1920H0Z ${hole}'/></svg>`;
    const fw = document.getElementById('fw'); fw.style.webkitMask = `url("${svg}")`; fw.style.mask = `url("${svg}")`;
  }, G);
  await p.screenshot({ path: path.join(__dirname, 'frame_cap.png'), omitBackground: true });
  await b.close();
})();
