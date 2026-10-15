// Cena 4: link do dia → check-in do treino → "Treino concluído" com o card de Story.
const fs = require('fs');
const path = require('path');
const { Studio, BASE } = require('./lib.cjs');
const DRY = process.argv.includes('--dry');

const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const ex = (exerciseId, name, sets, min, max, restSeconds) => ({
  exerciseId, name, sets, reps: { min, max }, loadStrategy: 'DOUBLE_PROGRESSION', restSeconds,
});
const EXERCISES = [
  ex('agachamento-barra', 'Agachamento (Barra)', 4, 6, 10, 120),
  ex('leg-press-45', 'Leg Press 45° (Máquina)', 3, 10, 12, 90),
  ex('cadeira-extensora', 'Cadeira Extensora (Máquina)', 3, 12, 15, 60),
  ex('mesa-flexora', 'Mesa Flexora (Máquina)', 3, 12, 15, 60),
  ex('panturrilha-em-pe', 'Panturrilha em Pé (Máquina)', 4, 15, 20, 45),
];
// cargas da semana passada: aparecem como "Treino passado" e geram o "+Xkg" verde
const PREVIOUS = {
  'agachamento-barra': [[8, 95], [8, 95], [7, 100], [6, 100]],
  'leg-press-45': [[12, 170], [11, 180], [10, 180]],
  'cadeira-extensora': [[15, 45], [14, 45], [12, 50]],
  'mesa-flexora': [[15, 40], [13, 40], [12, 40]],
  'panturrilha-em-pe': [[20, 60], [18, 60], [16, 60], [15, 60]],
};
const sets = EXERCISES.flatMap((e) => Array.from({ length: e.sets }, (_, i) => ({
  exerciseId: e.exerciseId, setNumber: i + 1, reps: null, loadValue: null, loadUnit: 'KG',
  durationSeconds: null, completed: false, skipped: false,
  previous: { reps: PREVIOUS[e.exerciseId][i][0], loadValue: PREVIOUS[e.exerciseId][i][1], loadUnit: 'KG', durationSeconds: null, date: '2026-10-07' },
})));
const DAYS = [['2026-10-11', 'SUN', 'REST'], ['2026-10-12', 'MON', 'COMPLETED'], ['2026-10-13', 'TUE', 'COMPLETED'],
  ['2026-10-14', 'WED', 'PLANNED'], ['2026-10-15', 'THU', 'REST'], ['2026-10-16', 'FRI', 'FUTURE'], ['2026-10-17', 'SAT', 'FUTURE']];

const state = {
  status: 'PLANNED', startedAt: null, finishedAt: null, durationSeconds: null, perceivedEffort: null, sets, shareCard: null,
};
const journal = () => ({
  firstName: 'Rodrigo', today: '2026-10-14', selectedDate: '2026-10-14', firstProtocolDate: '2026-10-05',
  week: DAYS.map(([date, weekday, st]) => ({ date, weekday, state: date === '2026-10-14' && state.status !== 'PLANNED' ? state.status : st })),
  workout: {
    id: SESSION_ID, status: state.status,
    prescription: { dayLabel: 'Pernas', weekday: 'WED', focus: 'Membros inferiores com ênfase em quadríceps', exercises: EXERCISES },
    startedAt: state.startedAt, finishedAt: state.finishedAt, durationSeconds: state.durationSeconds,
    perceivedEffort: state.perceivedEffort, painReported: false, sets: state.sets, shareCard: state.shareCard,
  },
});

async function mock(page) {
  const card = fs.readFileSync(path.join(__dirname, 'story-card.png'));
  await page.route('**/api/workout/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (p.endsWith('/access/peek')) return route.fulfill({ json: { firstName: 'Rodrigo' } });
    if (p.endsWith('/access')) return route.fulfill({ json: { ok: true } });
    if (p.endsWith('/journal')) return route.fulfill({ json: journal() });
    if (p.endsWith('/start')) {
      state.status = 'IN_PROGRESS';
      // o cronômetro já marca quase uma hora: o take é curto, o treino de verdade não
      state.startedAt = new Date(Date.now() - 54 * 60_000).toISOString();
      return route.fulfill({ json: { ok: true } });
    }
    if (p.endsWith('/sets')) {
      const { entries } = req.postDataJSON();
      state.sets = state.sets.map((s) => {
        const e = entries.find((x) => x.exerciseId === s.exerciseId && x.setNumber === s.setNumber);
        return e ? { ...s, ...e, previous: s.previous } : s;
      });
      return route.fulfill({ json: { ok: true } });
    }
    if (p.endsWith('/finish')) {
      const body = req.postDataJSON();
      Object.assign(state, {
        status: 'COMPLETED', finishedAt: new Date().toISOString(), durationSeconds: 3480,
        perceivedEffort: body.perceivedEffort,
        shareCard: {
          user: { name: 'Rodrigo', gender: 'male' },
          workout: {
            name: 'Pernas', durationSeconds: 3480,
            trainedMuscles: ['Quadríceps', 'Posteriores de coxa', 'Glúteos', 'Panturrilhas'],
            muscleGroupsForHighlighter: ['quads', 'hamstrings', 'glutes', 'calves'],
            completedAt: new Date().toISOString(),
          },
        },
      });
      return route.fulfill({ json: { ok: true } });
    }
    if (p.endsWith('/share-card')) return route.fulfill({ body: card, contentType: 'image/png' });
    return route.fulfill({ json: {} });
  });
}

(async () => {
  const s = new Studio(DRY ? 'dry-checkin' : 'checkin');
  const p = await s.open();
  await mock(p);
  let shot = 0;
  const snap = async (n) => { if (DRY) await p.screenshot({ path: `${s.dir}/${String(shot++).padStart(2, '0')}-${n}.png` }); };
  const btn = (n) => p.getByRole('button', { name: n, exact: true }).locator('visible=true').first();
  const card = (name) => p.locator('details', { has: p.getByText(name, { exact: true }) });

  await p.goto(BASE + '/treino/acessar#token=demo-link-do-dia', { waitUntil: 'networkidle' });
  await p.getByText(/Rodrigo/).first().waitFor();
  if (!DRY) await s.record();
  s.mark('acessar');
  await s.wait(2200);
  await snap('acessar');
  await s.tap(p.getByRole('button', { name: /abrir meu treino/i }));
  await p.getByText('Agachamento (Barra)').first().waitFor();
  s.mark('treino');
  await s.wait(2600);
  await snap('treino');
  await s.tap(btn('Iniciar'));
  s.mark('iniciado');
  await s.wait(1400);
  await snap('iniciado');

  // abre o exercício, preenche as séries, conclui
  async function exercise(name, values, { skip = false } = {}) {
    const c = card(name);
    if (!(await c.evaluate((d) => d.open))) await s.tap(c.locator('summary'), { pause: 700 });
    s.mark(name);
    if (skip) {
      await s.wait(600);
      await s.tap(c.getByRole('button', { name: 'Pular este exercício' }), { pause: 1200 });
      return;
    }
    const inputs = c.locator('input');
    for (let i = 0; i < values.length; i += 1) {
      await s.type(inputs.nth(i * 2), String(values[i][0]), { delay: 110, pause: 200 });
      await s.type(inputs.nth(i * 2 + 1), String(values[i][1]), { delay: 110, pause: 350 });
    }
    await p.keyboard.press('Tab').catch(() => {});
    await s.wait(500);
    if (name === 'Agachamento (Barra)') await snap('agachamento');
    await s.tap(c.getByRole('button', { name: 'Concluído' }), { pause: 1100 });
  }
  await exercise('Agachamento (Barra)', [[8, 100], [8, 100], [7, 105], [6, 105]]);
  await exercise('Leg Press 45° (Máquina)', [[12, 180], [11, 190], [10, 190]]);
  await exercise('Cadeira Extensora (Máquina)', [[15, 50], [13, 50], [12, 55]]);
  await exercise('Mesa Flexora (Máquina)', [[15, 45], [13, 45], [12, 45]]);
  await exercise('Panturrilha em Pé (Máquina)', [], { skip: true });
  await snap('lista');

  s.mark('finalizar');
  await s.tap(btn('Finalizar treino'));
  await p.getByText('Como foi para você?').waitFor();
  s.mark('feedback');
  await s.wait(1500);
  await snap('feedback');
  // arrasta a percepção de esforço de 5 até 7
  const range = p.getByLabel('Percepção de esforço');
  await s.reveal(range);
  const box = await range.boundingBox();
  const at = (v) => box.x + 10 + ((v - 1) / 9) * (box.width - 20);
  const y = box.y + box.height / 2;
  await p.evaluate(([x, yy]) => window.__tap(x, yy), [at(5), y]);
  await p.mouse.move(at(5), y);
  await p.mouse.down();
  await p.mouse.move(at(7), y, { steps: 24 });
  await p.mouse.up();
  await s.wait(700);
  await s.type(p.getByPlaceholder('Conte o que foi leve, difícil ou diferente hoje.'), 'Treino puxado, mas mantive a técnica até o fim.', { delay: 45, pause: 600 });
  await s.tap(btn('Não'), { pause: 900 });
  await snap('feedback2');
  await s.tap(btn('Enviar e finalizar'));
  await p.getByText('Treino concluído').first().waitFor();
  s.mark('concluido');
  await s.wait(2200);
  await snap('concluido');
  // desce só até o fim do conteúdo do card (texto de ajuda), sem chegar no vazio da página
  await p.locator('img[alt^="Card do treino:"]').waitFor();
  await s.wait(300);
  const target = await p.evaluate(() => {
    const hint = [...document.querySelectorAll('p')].find((e) => e.textContent.includes('No celular, escolha'));
    const r = hint.getBoundingClientRect();
    return Math.max(0, scrollY + r.bottom + 24 - innerHeight);
  });
  await p.evaluate((t) => window.__scrollTo(t, 1800), target);
  s.mark('story');
  await s.wait(1900);
  // zoom de câmera no card
  const cardBox = await p.locator('img[alt^="Card do treino:"]').boundingBox();
  s.mark('zoom');
  await p.evaluate(([x, y]) => window.__camera(x, y, 1.3, 1400), [cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height * 0.5]);
  await s.wait(3600);
  await snap('story');
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
