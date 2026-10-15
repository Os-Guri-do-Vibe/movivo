// Cenas de WhatsApp (réplica animada). `node scene-whatsapp.cjs <wa1|wa2|wa3> [--dry]`
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Studio } = require('./lib.cjs');

const WHICH = process.argv[2];
const DRY = process.argv.includes('--dry');
const PAGE = pathToFileURL(path.join(__dirname, 'whatsapp.html')).href;
const SYMBOL_D = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'montagem', 'logo_parts.json'), 'utf8')).symbol;
const PDF_NAME = 'protocolo-rodrigo-de-barros-movivo.pdf';

const M = {
  otp: 'Seu código de confirmação da MOVIVO é *123456*.\n\nEle confirma que este WhatsApp é seu e é válido por 10 minutos.\n\nNão compartilhe este código com ninguém.',
  welcome: 'Olá, Rodrigo! 💚\n\nRecebemos suas informações e seu processo na MOVIVO já começou.\n\nAgora vamos analisar seus objetivos, sua rotina e tudo o que você compartilhou com a gente para preparar um treino que realmente faça sentido para você.\n\nAssim que estiver pronto, você recebe tudo por aqui.',
  coach: 'Oi! Muito prazer. Eu sou o Leonardo e vou acompanhar você por aqui durante sua jornada com a MOVIVO.\n\nJá recebi suas informações e estou preparando seu protocolo de treino com base nos seus objetivos, na sua rotina e no que faz sentido para você neste momento.\n\nAssim que estiver tudo pronto, envio por aqui e te explico os próximos passos. 💚',
  pdfCaption: 'Rodrigo, seu treino está pronto. 💚\n\nMontamos seu protocolo considerando seus objetivos, sua rotina, sua disponibilidade e tudo o que você compartilhou com a gente.',
  protocol: 'Nele você encontra a divisão semanal com cinco treinos, com ênfase em peito, costas, pernas e ombros, mais um estímulo complementar de superiores. Cada sessão está detalhada com exercícios, séries, repetições e intervalos, seguindo a progressão do primeiro bloco de hipertrofia.',
  answer: 'A cadeira extensora trabalha principalmente o quadríceps, com ênfase no reto femoral e nos vastos. É um exercício isolado, então o foco fica todo na frente da coxa.\n\nComo você faz agachamento e leg press antes, ela entra como complemento pra dar mais volume no quadríceps sem sobrecarregar tanto o resto do corpo.',
  morning: 'Bom dia, Rodrigo! 💚\n\nSeu treino de hoje é *Pernas*, com ênfase em quadríceps. Não esqueça de fazer seu check-in quando for treinar:\nhttps://movivo.com.br/check-in/k7Qm2Rx\n\nAgora é com você. Bora se mover. 👊',
  analyzed: 'Acabei de analisar os resultados do seu treino de hoje!',
  feedback: 'Você completou agachamento, leg press, cadeira extensora e mesa flexora com todas as séries planejadas e ainda subiu a carga em relação à semana passada: +5 kg no agachamento e +10 kg no leg press. 💪\n\nA panturrilha ficou de fora hoje. Com esforço percebido em 7 e técnica mantida até o fim, a sessão ficou dentro do estímulo planejado.\n\nNa próxima, faça a panturrilha logo no início, enquanto a energia está alta, e mantenha as cargas para consolidar a progressão.',
};
const OG = { img: 'og.jpg', title: 'Movivo - Assessoria de Treino', desc: 'Orientação de treino individualizada pelo WhatsApp, com tecnologia e IA e supervisão de profissional de Educação Física com CREF. Teste grátis por 7 dias.' };

(async () => {
  const s = new Studio(DRY ? `dry-${WHICH}` : WHICH, { height: 852, colorScheme: 'dark' });
  const p = await s.open();
  await p.addInitScript((d) => { window.SYMBOL_D = d; }, SYMBOL_D);
  await p.goto(PAGE, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const wa = (fn, ...a) => p.evaluate(([f, args]) => window.wa[f](...args), [fn, a]);
  const el = (sel) => p.locator(sel).last();
  let shot = 0;
  const snap = async (n) => { if (DRY) await p.screenshot({ path: `${s.dir}/${String(shot++).padStart(2, '0')}-${n}.png` }); };
  async function arrive(fn, args, typingMs = 1600) {
    await wa('typing'); await wa('bottom', 350);
    await s.wait(typingMs);
    await wa('untyping');
    await wa(fn, ...args);
  }
  // rola até o topo da última mensagem (se for longa) e depois desce devagar até o fim
  async function readLast(holdMs = 1500, downMs = 1600) {
    await p.evaluate(() => { const r = document.querySelector('#chat').lastElementChild; return window.wa.top(r, 12, 900); });
    await s.wait(holdMs);
    await wa('bottom', downMs);
  }

  if (WHICH === 'wa1') {
    await wa('chip', 'Hoje');
    await wa('text', 'in', M.otp, '14:48', false);
    await wa('text', 'in', M.welcome, '14:51', false);
    await wa('clock', '14:51');
    await wa('bottom', 0);
    await s.wait(300);
    if (!DRY) await s.record();
    s.mark('inicio');
    await s.wait(1800);
    await snap('inicio');
    await arrive('text', ['in', M.coach, '14:51'], 1800);
    s.mark('coach');
    await readLast(1800, 1800);
    await s.wait(1600);
    await snap('coach');
    await wa('clock', '14:52');
    await arrive('pdf', [PDF_NAME, M.pdfCaption, '14:52'], 2200);
    s.mark('pdf');
    await readLast(1200, 1200);
    await s.wait(500);
    await arrive('text', ['in', M.protocol, '14:52'], 1300);
    await readLast(1000, 1400);
    await s.wait(1500);
    await snap('pdf');
    // volta ao PDF e abre
    await p.evaluate(() => window.wa.top(document.querySelector('[data-pdf]').closest('.row'), 60, 900));
    await s.wait(700);
    s.mark('abre-pdf');
    await s.tap(el('[data-pdf]'), { reveal: false, pause: 100 });
    await wa('openPdf', PDF_NAME, 'pdfpages/p1.png');
    await s.wait(1600);
    await snap('viewer');
    await wa('scrollPdf', 470, 2200);
    await s.wait(600);
    // pinça no treino de pernas (Quarta · Treino C) para a tabela ficar legível
    const pinch = await p.evaluate(() => { const img = document.querySelector('#pages img'); const pages = document.getElementById('pages'); const r = img.getBoundingClientRect(); return { y: r.top, h: r.height, st: pages.scrollTop, top: pages.getBoundingClientRect().top }; });
    const tableY = pinch.h * (2770 / 5334);   // posição da tabela de Quarta na página (px do PNG)
    const py = pinch.y + tableY;
    const pin = p.evaluate(([x, y]) => window.__pinch(x, y, 28, 120, 900), [150, py]);
    await s.wait(180);
    await wa('zoomPdf', 1.75, 0, tableY);
    await pin;
    await s.wait(400);
    await snap('viewer2');
    await s.wait(2300);
    const pout = p.evaluate(([x, y]) => window.__pinch(x, y, 120, 28, 800), [150, py]);
    await s.wait(180);
    await wa('zoomPdf', 1, 0, tableY);
    await pout;
    await s.wait(500);
    await wa('scrollPdf', 1050, 1800);
    await s.wait(700);
    await s.tap(el('#vx'), { reveal: false, pause: 100 });
    await wa('closePdf');
    await s.wait(900);
    await wa('bottom', 700);
    await s.wait(800);
    // pergunta por áudio
    s.mark('audio');
    await wa('clock', '14:53');
    const mic = await el('#mic').boundingBox();
    await p.evaluate(([x, y]) => window.__tap(x, y), [mic.x + mic.width / 2, mic.y + mic.height / 2]);
    await s.wait(200);
    await snap('rec');
    await wa('record', 5);
    await wa('stopRecord');
    await wa('audio', '14:53', 5);
    await wa('bottom', 350);
    await s.wait(1200);
    s.mark('resposta');
    await s.wait(600);
    await wa('clock', '14:54');
    await arrive('text', ['in', M.answer, '14:54'], 1800);
    await readLast(1500, 1500);
    await s.wait(3500);
    await snap('resposta');
  }

  if (WHICH === 'wa2') {
    await wa('chip', 'Ontem');
    await wa('text', 'in', M.protocol, '14:52', false);
    await p.evaluate(() => window.wa.audio('14:53', 5).classList.remove('enter'));
    await wa('text', 'in', M.answer, '14:54', false);
    await wa('clock', '7:00');
    await wa('bottom', 0);
    await s.wait(300);
    if (!DRY) await s.record();
    s.mark('inicio');
    await s.wait(1200);
    await wa('chip', 'Hoje', true);
    await arrive('link', [OG.img, OG.title, OG.desc, M.morning, '07:00'], 1500);
    s.mark('bomdia');
    await readLast(1400, 1600);
    await s.wait(2200);
    await snap('bomdia');
    s.mark('toque-link');
    await s.tap(el('.row:last-child a'), { reveal: false, pause: 600 });
    await snap('toque');
    await s.wait(300);
  }

  if (WHICH === 'wa3') {
    await wa('chip', 'Hoje');
    await wa('link', OG.img, OG.title, OG.desc, M.morning, '07:00', false);
    await wa('clock', '19:42');
    await wa('bottom', 0);
    await s.wait(300);
    if (!DRY) await s.record();
    s.mark('inicio');
    await s.wait(1500);
    await arrive('text', ['in', M.analyzed, '19:42'], 1500);
    await s.wait(500);
    s.mark('feedback');
    await arrive('text', ['in', M.feedback, '19:42'], 2600);
    await readLast(2000, 2600);
    await s.wait(4000);
    await snap('feedback');
  }
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
