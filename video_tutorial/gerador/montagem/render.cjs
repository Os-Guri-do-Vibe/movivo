const { chromium } = require(require.resolve('@playwright/test', { paths: [require('path').resolve(__dirname, '../../../apps/web')] }));
const fs = require('fs'), path = require('path');
const dir = __dirname, FPS = 30;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const logo = JSON.parse(fs.readFileSync(path.join(dir, 'logo_parts.json'), 'utf8'));
  await page.addInitScript(l => { window.LOGO = l; }, logo);
  await page.goto(require('url').pathToFileURL(path.join(dir, 'scene.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => render('frame', 0));
  await page.screenshot({ path: path.join(dir, 'frame.png'), omitBackground: true });
  const only = process.argv[2];
  for (const [mode, secs] of [['intro', 4], ['outro', 7]]) {
    if (only && only !== mode) continue;
    const out = path.join(dir, mode); fs.mkdirSync(out, { recursive: true });
    const n = only === 'preview' ? 0 : secs * FPS;
    for (let i = 0; i < n; i++) {
      await page.evaluate(([m, t]) => render(m, t), [mode, i / FPS]);
      await page.screenshot({ path: path.join(out, String(i).padStart(4, '0') + '.png') });
    }
  }
  await browser.close();
})();
