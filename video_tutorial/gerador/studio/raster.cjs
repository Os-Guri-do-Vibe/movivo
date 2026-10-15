const { chromium } = require(require.resolve('@playwright/test', { paths: [require('path').resolve(__dirname, '../../../apps/web')] }));
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage();
  await p.setContent('<html><body></body></html>');
  await p.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js' });
  const data = fs.readFileSync(path.join(__dirname, 'protocolo-rodrigo-de-barros-movivo.pdf')).toString('base64');
  const pages = await p.evaluate(async (b64) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i); const v1 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: 1600 / v1.width });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      out.push(c.toDataURL('image/png'));
    }
    return out;
  }, data);
  pages.forEach((u, i) => fs.writeFileSync(path.join(__dirname, 'pdfpages', `p${i + 1}.png`), Buffer.from(u.split(',')[1], 'base64')));
  console.log(pages.length, 'páginas');
  await b.close();
})();
