const { chromium } = require(require.resolve('@playwright/test', { paths: [require('path').resolve(__dirname, '../../../apps/web')] }));
const fs = require('fs'), path = require('path');
(async () => {
  const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'caption_states.json'), 'utf8'));
  const dir = path.join(__dirname, 'caps'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 300 } });
  await p.goto(require('url').pathToFileURL(path.join(__dirname, 'captions.html')).href);
  await p.evaluate(() => document.fonts.load('700 54px Satoshi'));
  await p.evaluate(() => window.show([], 0));
  await p.screenshot({ path: path.join(dir, 'empty.png'), omitBackground: true });
  for (let i = 0; i < st.length; i++) {
    await p.evaluate(([w, k]) => window.show(w, k), [st[i][2], st[i][3]]);
    await p.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.png`), omitBackground: true });
  }
  await b.close();
})();
