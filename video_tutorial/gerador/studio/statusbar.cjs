const { chromium } = require(require.resolve('@playwright/test', { paths: [require('path').resolve(__dirname, '../../../apps/web')] }));
const path = require('path'); const { pathToFileURL } = require('url');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 393, height: 53 }, deviceScaleFactor: 830 / 393 });
  await p.goto(pathToFileURL(path.join(__dirname, 'statusbar.html')).href, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  for (const t of ['14:47', '19:39']) {
    await p.evaluate((v) => { document.getElementById('clock').textContent = v; }, t);
    await p.screenshot({ path: path.join(__dirname, `statusbar-${t.replace(':', '')}.png`) });
  }
  await b.close();
})();
