// Estúdio de gravação: Chrome real em viewport de iPhone, captura por screencast CDP.
const { chromium } = require(require.resolve('@playwright/test', { paths: [require('path').resolve(__dirname, '../../../apps/web')] }));
const fs = require('fs');
const path = require('path');

const W = 393;                 // largura CSS de um iPhone 15 Pro
const H = 852 - 54;            // altura útil: a barra de status do iOS entra na montagem
const DPR = 830 / W;           // sai exatamente na largura da tela da moldura (830 px)
const BASE = 'http://localhost:3000';

const TAP_SCRIPT = `
(() => {
  window.__tap = (x, y) => {
    const d = document.createElement('div');
    const s = d.style;
    s.position = 'fixed'; s.left = (x - 23) + 'px'; s.top = (y - 23) + 'px';
    s.width = '46px'; s.height = '46px'; s.borderRadius = '50%';
    s.background = 'rgba(37, 226, 126, 0.28)';
    s.border = '2px solid rgba(255, 255, 255, 0.9)';
    s.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.28)';
    s.zIndex = '2147483647'; s.pointerEvents = 'none';
    s.transform = 'scale(0.55)'; s.opacity = '0';
    s.transition = 'transform 0.32s cubic-bezier(.2,.8,.2,1), opacity 0.32s ease';
    document.documentElement.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => { s.transform = 'scale(1)'; s.opacity = '1'; }));
    setTimeout(() => { s.transform = 'scale(1.35)'; s.opacity = '0'; }, 420);
    setTimeout(() => d.remove(), 900);
  };
  // pinça: dois "dedos" que se afastam (zoom in, d0<d1) ou se aproximam (zoom out)
  window.__pinch = (x, y, d0, d1, ms) => {
    const mk = () => {
      const d = document.createElement('div'); const st = d.style;
      Object.assign(st, { position: 'fixed', left: '0px', top: '0px', width: '46px', height: '46px', borderRadius: '50%',
        background: 'rgba(37, 226, 126, 0.28)', border: '2px solid rgba(255, 255, 255, 0.9)', boxShadow: '0 2px 12px rgba(0,0,0,.28)',
        zIndex: '2147483647', pointerEvents: 'none', opacity: '0', transition: 'opacity .2s ease' });
      document.documentElement.appendChild(d); return d;
    };
    const a = mk(), b = mk(), t0 = performance.now(), k = Math.SQRT1_2;
    const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const place = (dist) => {
      a.style.transform = \`translate(\${x - dist * k - 23}px, \${y + dist * k - 23}px)\`;
      b.style.transform = \`translate(\${x + dist * k - 23}px, \${y - dist * k - 23}px)\`;
    };
    place(d0); requestAnimationFrame(() => { a.style.opacity = '1'; b.style.opacity = '1'; });
    return new Promise((res) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0 - 180) / ms);
        place(d0 + (d1 - d0) * ease(Math.max(0, p)));
        if (p < 1) requestAnimationFrame(step);
        else { a.style.opacity = '0'; b.style.opacity = '0'; setTimeout(() => { a.remove(); b.remove(); res(); }, 260); }
      };
      requestAnimationFrame(step);
    });
  };
  // banner de notificação do iOS (WhatsApp)
  window.__notify = (title, body, ms = 2600) => new Promise((res) => {
    const n = document.createElement('div'); const st = n.style;
    Object.assign(st, { position: 'fixed', left: '8px', right: '8px', top: '6px', zIndex: '2147483646', borderRadius: '22px',
      background: 'rgba(242, 242, 244, 0.86)', backdropFilter: 'blur(24px) saturate(1.6)', webkitBackdropFilter: 'blur(24px) saturate(1.6)',
      boxShadow: '0 10px 30px rgba(0,0,0,.18)', padding: '11px 14px', display: 'flex', gap: '11px', alignItems: 'center',
      fontFamily: '-apple-system, "Inter", "Segoe UI", sans-serif', color: '#111', transform: 'translateY(-130%)',
      transition: 'transform .55s cubic-bezier(.2,1.1,.3,1)' });
    n.innerHTML = \`<div style="width:38px;height:38px;border-radius:9px;background:#25d366;display:flex;align-items:center;justify-content:center;flex:none">
      <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCIgd2lkdGg9IjQ4cHgiIGhlaWdodD0iNDhweCIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik00Ljg2OCw0My4zMDNsMi42OTQtOS44MzVDNS45LDMwLjU5LDUuMDI2LDI3LjMyNCw1LjAyNywyMy45NzlDNS4wMzIsMTMuNTE0LDEzLjU0OCw1LDI0LjAxNCw1YzUuMDc5LDAuMDAyLDkuODQ1LDEuOTc5LDEzLjQzLDUuNTY2YzMuNTg0LDMuNTg4LDUuNTU4LDguMzU2LDUuNTU2LDEzLjQyOGMtMC4wMDQsMTAuNDY1LTguNTIyLDE4Ljk4LTE4Ljk4NiwxOC45OGMtMC4wMDEsMCwwLDAsMCwwaC0wLjAwOGMtMy4xNzctMC4wMDEtNi4zLTAuNzk4LTkuMDczLTIuMzExTDQuODY4LDQzLjMwM3oiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNNC44NjgsNDMuODAzYy0wLjEzMiwwLTAuMjYtMC4wNTItMC4zNTUtMC4xNDhjLTAuMTI1LTAuMTI3LTAuMTc0LTAuMzEyLTAuMTI3LTAuNDgzbDIuNjM5LTkuNjM2Yy0xLjYzNi0yLjkwNi0yLjQ5OS02LjIwNi0yLjQ5Ny05LjU1NkM0LjUzMiwxMy4yMzgsMTMuMjczLDQuNSwyNC4wMTQsNC41YzUuMjEsMC4wMDIsMTAuMTA1LDIuMDMxLDEzLjc4NCw1LjcxM2MzLjY3OSwzLjY4Myw1LjcwNCw4LjU3Nyw1LjcwMiwxMy43ODFjLTAuMDA0LDEwLjc0MS04Ljc0NiwxOS40OC0xOS40ODYsMTkuNDhjLTMuMTg5LTAuMDAxLTYuMzQ0LTAuNzg4LTkuMTQ0LTIuMjc3bC05Ljg3NSwyLjU4OUM0Ljk1Myw0My43OTgsNC45MTEsNDMuODAzLDQuODY4LDQzLjgwM3oiLz48cGF0aCBmaWxsPSIjY2ZkOGRjIiBkPSJNMjQuMDE0LDVjNS4wNzksMC4wMDIsOS44NDUsMS45NzksMTMuNDMsNS41NjZjMy41ODQsMy41ODgsNS41NTgsOC4zNTYsNS41NTYsMTMuNDI4Yy0wLjAwNCwxMC40NjUtOC41MjIsMTguOTgtMTguOTg2LDE4Ljk4aC0wLjAwOGMtMy4xNzctMC4wMDEtNi4zLTAuNzk4LTkuMDczLTIuMzExTDQuODY4LDQzLjMwM2wyLjY5NC05LjgzNUM1LjksMzAuNTksNS4wMjYsMjcuMzI0LDUuMDI3LDIzLjk3OUM1LjAzMiwxMy41MTQsMTMuNTQ4LDUsMjQuMDE0LDUgTTI0LjAxNCw0Mi45NzRDMjQuMDE0LDQyLjk3NCwyNC4wMTQsNDIuOTc0LDI0LjAxNCw0Mi45NzRDMjQuMDE0LDQyLjk3NCwyNC4wMTQsNDIuOTc0LDI0LjAxNCw0Mi45NzQgTTI0LjAxNCw0Mi45NzRDMjQuMDE0LDQyLjk3NCwyNC4wMTQsNDIuOTc0LDI0LjAxNCw0Mi45NzRDMjQuMDE0LDQyLjk3NCwyNC4wMTQsNDIuOTc0LDI0LjAxNCw0Mi45NzQgTTI0LjAxNCw0QzI0LjAxNCw0LDI0LjAxNCw0LDI0LjAxNCw0QzEyLjk5OCw0LDQuMDMyLDEyLjk2Miw0LjAyNywyMy45NzljLTAuMDAxLDMuMzY3LDAuODQ5LDYuNjg1LDIuNDYxLDkuNjIybC0yLjU4NSw5LjQzOWMtMC4wOTQsMC4zNDUsMC4wMDIsMC43MTMsMC4yNTQsMC45NjdjMC4xOSwwLjE5MiwwLjQ0NywwLjI5NywwLjcxMSwwLjI5N2MwLjA4NSwwLDAuMTctMC4wMTEsMC4yNTQtMC4wMzNsOS42ODctMi41NGMyLjgyOCwxLjQ2OCw1Ljk5OCwyLjI0Myw5LjE5NywyLjI0NGMxMS4wMjQsMCwxOS45OS04Ljk2MywxOS45OTUtMTkuOThjMC4wMDItNS4zMzktMi4wNzUtMTAuMzU5LTUuODQ4LTE0LjEzNUMzNC4zNzgsNi4wODMsMjkuMzU3LDQuMDAyLDI0LjAxNCw0TDI0LjAxNCw0eiIvPjxwYXRoIGZpbGw9IiM0MGMzNTEiIGQ9Ik0zNS4xNzYsMTIuODMyYy0yLjk4LTIuOTgyLTYuOTQxLTQuNjI1LTExLjE1Ny00LjYyNmMtOC43MDQsMC0xNS43ODMsNy4wNzYtMTUuNzg3LDE1Ljc3NGMtMC4wMDEsMi45ODEsMC44MzMsNS44ODMsMi40MTMsOC4zOTZsMC4zNzYsMC41OTdsLTEuNTk1LDUuODIxbDUuOTczLTEuNTY2bDAuNTc3LDAuMzQyYzIuNDIyLDEuNDM4LDUuMiwyLjE5OCw4LjAzMiwyLjE5OWgwLjAwNmM4LjY5OCwwLDE1Ljc3Ny03LjA3NywxNS43OC0xNS43NzZDMzkuNzk1LDE5Ljc3OCwzOC4xNTYsMTUuODE0LDM1LjE3NiwxMi44MzJ6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMTkuMjY4LDE2LjA0NWMtMC4zNTUtMC43OS0wLjcyOS0wLjgwNi0xLjA2OC0wLjgyYy0wLjI3Ny0wLjAxMi0wLjU5My0wLjAxMS0wLjkwOS0wLjAxMWMtMC4zMTYsMC0wLjgzLDAuMTE5LTEuMjY1LDAuNTk0Yy0wLjQzNSwwLjQ3NS0xLjY2MSwxLjYyMi0xLjY2MSwzLjk1NmMwLDIuMzM0LDEuNyw0LjU5LDEuOTM3LDQuOTA2YzAuMjM3LDAuMzE2LDMuMjgyLDUuMjU5LDguMTA0LDcuMTYxYzQuMDA3LDEuNTgsNC44MjMsMS4yNjYsNS42OTMsMS4xODdjMC44Ny0wLjA3OSwyLjgwNy0xLjE0NywzLjIwMi0yLjI1NWMwLjM5NS0xLjEwOCwwLjM5NS0yLjA1NywwLjI3Ny0yLjI1NWMtMC4xMTktMC4xOTgtMC40MzUtMC4zMTYtMC45MDktMC41NTRzLTIuODA3LTEuMzg1LTMuMjQyLTEuNTQzYy0wLjQzNS0wLjE1OC0wLjc1MS0wLjIzNy0xLjA2OCwwLjIzOGMtMC4zMTYsMC40NzQtMS4yMjUsMS41NDMtMS41MDIsMS44NTljLTAuMjc3LDAuMzE3LTAuNTU0LDAuMzU3LTEuMDI4LDAuMTE5Yy0wLjQ3NC0wLjIzOC0yLjAwMi0wLjczOC0zLjgxNS0yLjM1NGMtMS40MS0xLjI1Ny0yLjM2Mi0yLjgxLTIuNjM5LTMuMjg1Yy0wLjI3Ny0wLjQ3NC0wLjAzLTAuNzMxLDAuMjA4LTAuOTY4YzAuMjEzLTAuMjEzLDAuNDc0LTAuNTU0LDAuNzEyLTAuODMxYzAuMjM3LTAuMjc3LDAuMzE2LTAuNDc1LDAuNDc0LTAuNzkxYzAuMTU4LTAuMzE3LDAuMDc5LTAuNTk0LTAuMDQtMC44MzFDMjAuNjEyLDE5LjMyOSwxOS42OSwxNi45ODMsMTkuMjY4LDE2LjA0NXoiIGNsaXAtcnVsZT0iZXZlbm9kZCIvPjwvc3ZnPgo=" style="width:26px;height:26px"></div>
      <div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600">
      <span>\${title}</span><span style="font-weight:400;color:#777;font-size:13px">agora</span></div>
      <div style="font-size:14.5px;line-height:1.3;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">\${body}</div></div>\`;
    document.documentElement.appendChild(n);
    requestAnimationFrame(() => requestAnimationFrame(() => { st.transform = 'translateY(0)'; }));
    setTimeout(() => { st.transition = 'transform .4s cubic-bezier(.4,0,1,1)'; st.transform = 'translateY(-130%)'; }, ms);
    setTimeout(() => { n.remove(); res(); }, ms + 450);
  });
  // "câmera": zoom suave na página inteira, centrado num ponto da tela
  window.__camera = (x, y, scale, ms) => {
    const el = document.documentElement;
    el.style.transformOrigin = \`\${x}px \${y + scrollY}px\`;
    el.style.transition = \`transform \${ms}ms cubic-bezier(.45,0,.2,1)\`;
    el.style.transform = scale === 1 ? '' : \`scale(\${scale})\`;
  };
  // rolagem suave e determinística (easeInOutCubic) da janela ou de um contêiner
  window.__scrollTo = (target, ms, sel) => new Promise((resolve) => {
    const el = sel ? document.querySelector(sel) : (document.scrollingElement || document.documentElement);
    const from = el.scrollTop, delta = target - from, t0 = performance.now();
    const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      el.scrollTop = from + delta * ease(k);
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  // sem caret piscando nem barras de rolagem: tela limpa
  const css = document.createElement('style');
  css.textContent = '::-webkit-scrollbar{display:none} html{scrollbar-width:none;scroll-behavior:auto !important}'
    // estúdio: o app usa scroll-behavior smooth; aqui a rolagem é sempre a animação controlada do __scrollTo
    // estúdio: no Chrome o flex-1 dentro do flex-col-reverse achata os botões (Safari não)
    + ' [class*="h-[52px]"]{min-height:52px}'
    // estúdio: altura e peso lado a lado — o rótulo da altura quebra em 2 linhas e desalinha os campos
    + ' .grid.grid-cols-2:has(#heightCm) > *{display:flex;flex-direction:column;justify-content:space-between}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
})();
`;

class Studio {
  constructor(name, opts = {}) {
    this.name = name;
    this.dir = path.join(__dirname, 'takes', name);
    this.opts = opts;
    this.frames = [];
    this.marks = [];
  }

  async open() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(this.dir, 'f'), { recursive: true });
    this.browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', '--force-color-profile=srgb'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: W, height: this.opts.height ?? H },
      deviceScaleFactor: DPR,
      isMobile: true,
      hasTouch: true,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      colorScheme: this.opts.colorScheme ?? 'light',
      bypassCSP: true,
      reducedMotion: 'no-preference',
    });
    await this.context.addInitScript(TAP_SCRIPT);
    if (this.opts.clock) await this.context.clock.install({ time: this.opts.clock });
    this.page = await this.context.newPage();
    return this.page;
  }

  async record() {
    this.cdp = await this.context.newCDPSession(this.page);
    let n = 0;
    this.cdp.on('Page.screencastFrame', async (f) => {
      const file = String(n++).padStart(6, '0') + '.jpg';
      fs.writeFileSync(path.join(this.dir, 'f', file), Buffer.from(f.data, 'base64'));
      this.frames.push({ file, t: f.metadata.timestamp });
      try { await this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
    });
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 94, maxWidth: 830, maxHeight: 2000, everyNthFrame: 1,
    });
    this.t0 = Date.now() / 1000;
  }

  mark(label) { this.marks.push({ label, t: Date.now() / 1000 }); }
  wait(ms) { return this.page.waitForTimeout(ms); }

  /** Rola suavemente até deixar o elemento numa faixa confortável da tela. */
  async reveal(locator, { ms = 1100, top = 0.18, bottom = 0.72, sel } = {}) {
    await locator.waitFor({ state: 'visible' });
    const box = await locator.boundingBox();
    const vh = this.opts.height ?? H;
    if (box.y >= vh * top && box.y + box.height <= vh * bottom) return;
    const cur = await this.page.evaluate((s) => (s ? document.querySelector(s) : document.scrollingElement).scrollTop, sel);
    const target = Math.max(0, cur + box.y - vh * 0.32);
    await this.page.evaluate(([t, d, s]) => window.__scrollTo(t, d, s), [target, ms, sel]);
    await this.wait(120);
  }

  async scrollBy(dy, ms = 800, sel) {
    const cur = await this.page.evaluate((s) => (s ? document.querySelector(s) : document.scrollingElement).scrollTop, sel);
    await this.page.evaluate(([t, d, s]) => window.__scrollTo(t, d, s), [Math.max(0, cur + dy), ms, sel]);
  }

  async tap(locator, { pause = 260, reveal = true } = {}) {
    if (reveal) await this.reveal(locator);
    const box = await locator.boundingBox();
    await this.page.evaluate(([x, y]) => window.__tap(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
    await this.wait(140);
    await locator.click({ force: true });
    await this.wait(pause);
  }

  async type(locator, text, { delay = 65, pause = 300 } = {}) {
    await this.tap(locator, { pause: 150 });
    await locator.pressSequentially(text, { delay });
    await this.wait(pause);
  }

  async close() {
    try { await this.cdp?.send('Page.stopScreencast'); } catch {}
    this.t1 = Date.now() / 1000;
    fs.writeFileSync(path.join(this.dir, 'take.json'), JSON.stringify({
      frames: this.frames, marks: this.marks, t0: this.t0, t1: this.t1,
    }));
    await this.browser.close();
  }
}

module.exports = { Studio, BASE, W, H, DPR };
