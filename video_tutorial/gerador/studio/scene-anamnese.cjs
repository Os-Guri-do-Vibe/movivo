// Cena 1+2: landing → anamnese completa. `node scene-anamnese.cjs [--dry]`
const { Studio, BASE } = require('./lib.cjs');
const DRY = process.argv.includes('--dry');

(async () => {
  await fetch('http://127.0.0.1:3201/__reset', { method: 'POST' }).catch(() => {});
  const s = new Studio(DRY ? 'dry-anamnese' : 'anamnese');
  const p = await s.open();
  // etapa nova do formulário abre no topo, antes do primeiro quadro pintado (sem "pulo")
  await p.addInitScript(() => {
    let last = '';
    new MutationObserver(() => {
      const h = document.querySelector('main h1, main h2, h1, h2');
      const t = h && h.textContent;
      if (t && t !== last) { last = t; window.scrollTo({ top: 0, behavior: 'instant' }); }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  let shot = 0;
  const snap = async (n) => { if (DRY) await p.screenshot({ path: `${s.dir}/${String(shot++).padStart(2, '0')}-${n}.png` }); };
  const label = (t) => p.getByLabel(t);
  const radio = (n) => p.getByRole('radio', { name: n, exact: true }).or(p.getByRole('checkbox', { name: n, exact: true })).or(p.getByRole('button', { name: n, exact: true })).locator('visible=true').first();
  const btn = (n) => p.getByRole('button', { name: n, exact: true }).locator('visible=true').first();
  const heading = (n) => p.getByRole('heading', { name: n });

  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  if (!DRY) await s.record();
  s.mark('landing');
  await s.wait(DRY ? 300 : 5200);                      // animação do título
  await snap('landing');
  s.mark('cta');
  await s.tap(p.locator('[data-analytics-event="hero_start_trial"]'), { reveal: false });
  await s.wait(1800);                                   // rolagem nativa até os planos
  s.mark('planos');
  await snap('planos');
  const plan = p.locator('#planos [aria-live="polite"]').getByRole('link', { name: /começar 7 dias grátis/i });
  await s.reveal(plan, { ms: 1100, top: 0.1, bottom: 0.85 });
  await s.wait(1400);
  await snap('plano');
  await s.tap(plan);
  await heading('Vamos começar por você').waitFor();
  s.mark('anamnese');
  await s.wait(1400);
  await snap('step1');

  await s.type(label('Qual é o seu nome completo?'), 'Rodrigo de Barros');
  await s.type(label('Qual é a sua data de nascimento?'), '18072001');
  await snap('nasc');
  await s.tap(radio('Masculino'));
  await s.type(label(/Qual é a sua altura/), '178');
  await s.type(label(/Qual é o seu peso/), '78');
  s.mark('whatsapp');
  await s.type(label('Qual é o seu WhatsApp?'), '11987654321');
  await p.getByText(/Confirme seu WhatsApp/).waitFor();
  await s.reveal(label('Código de verificação de 6 dígitos'), { ms: 600 });
  await s.wait(700);
  s.mark('notif');                       // o "plim" entra aqui na montagem
  const banner = p.evaluate(() => window.__notify('MOVIVO', 'Seu código de confirmação da MOVIVO é <b>123456</b>. Ele confirma que este WhatsApp é seu.', 2700));
  await s.wait(1300);
  await snap('otp');
  await banner;
  await s.wait(300);
  await s.type(label('Código de verificação de 6 dígitos'), '123456', { delay: 170 });
  await p.getByText('✓ WhatsApp confirmado').waitFor();
  await s.wait(1000);
  await snap('otp-ok');
  await s.type(label('Qual é o seu e-mail?'), 'rodrigo@exemplo.com');
  await p.keyboard.press('Tab').catch(() => {});
  s.mark('consents');
  // desce com calma até os consentimentos (antes era um pulo rápido)
  await s.reveal(label(/Li e aceito os Termos/), { ms: 1600, top: 0.3, bottom: 0.5 });
  await s.wait(400);
  for (const re of [/Li e aceito os Termos/, /dados de saúde/, /inteligência artificial/, /Quero receber novidades/]) {
    await s.tap(label(re), { pause: 450 });
  }
  await snap('consents');
  await s.tap(btn('Continuar'));

  // Etapa 2 — objetivos
  await heading('Seus objetivos').waitFor();
  s.mark('objetivos');
  await s.wait(900);
  await s.tap(radio('Hipertrofia'), { pause: 500 });
  const emphasis = p.getByRole('group', { name: /Em quais regiões você gostaria de dar mais ênfase/ });
  await s.tap(emphasis.getByRole('button', { name: 'Peitoral' }), { pause: 400 });
  await s.tap(emphasis.getByRole('button', { name: 'Costas' }), { pause: 600 });
  await snap('objetivos');
  await s.tap(btn('Continuar'));

  await heading('Seu histórico').waitFor();
  s.mark('historico');
  await s.wait(800);
  await s.tap(radio('Treino regularmente'), { pause: 500 });
  await snap('historico');
  const exp = p.getByRole('combobox', { name: 'Qual é a sua experiência com musculação?' });
  await s.tap(exp, { pause: 600 });
  await s.tap(p.getByRole('option', { name: /^Intermediário/ }), { reveal: false, pause: 600 });
  await s.tap(radio('Musculação'), { pause: 500 });
  await snap('historico2');
  await s.tap(btn('Continuar'));

  await heading('Sua rotina').waitFor();
  s.mark('rotina');
  await s.wait(800);
  await s.tap(p.getByRole('combobox', { name: 'Quantos dias por semana você consegue treinar?' }), { pause: 600 });
  await s.tap(p.getByRole('option', { name: '5 dias' }), { reveal: false, pause: 600 });
  await snap('rotina-dias');
  const days = p.getByRole('group', { name: /Quais dias da semana/ });
  if (await days.count()) {
    for (const d of ['Segunda', 'Terça', 'Quarta', 'Sexta', 'Sábado']) {
      await s.tap(radio(d), { pause: 250 });
    }
  }
  await s.tap(radio('Aproximadamente 60 minutos'), { pause: 400 });
  await s.tap(radio('Academia completa'), { pause: 400 });
  await s.tap(radio('Noite'), { pause: 500 });
  await snap('rotina');
  await s.tap(btn('Continuar'));

  await heading('Dores e limitações').waitFor();
  s.mark('dores');
  await s.wait(900);
  await snap('dores');
  const no = radio('Não');
  if (await no.count()) await s.tap(no.first(), { pause: 600 });
  await s.tap(btn('Continuar'));

  await heading('Suas preferências').waitFor();
  s.mark('preferencias');
  await s.wait(900);
  await snap('preferencias');
  await s.tap(btn('Continuar para saúde'));

  await heading('Última parte: sua segurança').waitFor();
  s.mark('parq');
  await s.wait(1200);
  await snap('parq-intro');
  await s.tap(btn('Começar'));
  // PAR-Q: duas respostas com calma, avança, um "Sim" com comentário, avança até o fim
  const YES_AT = 5;   // "problema em osso, articulação ou coluna"
  for (let i = 0; i < 9; i += 1) {
    s.mark(`parq-q${i + 1}`);
    await s.wait(i < 2 || i === YES_AT ? 900 : 400);
    if (i === 0) await snap('parq-1');
    if (i === YES_AT) {
      await s.tap(radio('Sim'), { pause: 900 });
      await snap('parq-sim');
      const note = p.getByRole('textbox').locator('visible=true').last();
      await s.type(note, 'Tive tendinite no ombro direito há dois anos. Hoje não sinto dor.', { delay: 40, pause: 900 });
      await snap('parq-sim-nota');
    } else {
      await s.tap(radio('Não'), { pause: i < 2 ? 600 : 250 });
    }
    await s.tap(btn('Continuar'), { pause: 200 });
  }
  s.mark('confirmar');
  await s.wait(900);
  await snap('confirmar');
  const decl = p.getByRole('checkbox');
  for (let i = 0; i < (await decl.count()); i += 1) await s.tap(decl.nth(i), { pause: 450 });
  s.mark('finalizar');
  await s.tap(btn('Finalizar avaliação'));
  await heading(/Tudo pronto|Recebemos suas informações/).waitFor();
  // a tela nova herda a rolagem do formulário: volta ao topo antes de mostrar
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await s.wait(250);
  s.mark('pronto');
  await s.wait(2600);
  await snap('pronto');
  const max = await p.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
  await p.evaluate((m) => window.__scrollTo(m, 3200), max);
  await s.wait(2000);
  await snap('pronto2');
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
