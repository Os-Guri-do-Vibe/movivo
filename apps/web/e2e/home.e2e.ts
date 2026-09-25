/**
 * Smoke E2E da landing pública.
 *
 * Num browser real, prova que a landing sobe e que o funil existente continua intacto:
 *  - hero com o H1 único, CTA sem plano rolando para os planos;
 *  - planos com valores do catálogo e o plano preservado até `/anamnese?plano=ID`;
 *  - respaldo CREF sempre visível (guardrail inegociável de linguagem);
 *  - navegação, menu mobile, CTA fixo mobile, movimento reduzido e WebGL sem bloquear;
 *  - nenhuma largura com overflow horizontal.
 */
import { expect, test } from '@playwright/test';

test('a landing carrega com hero, CTA e respaldo CREF', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole('heading', { level: 1, name: /Move your potential\./i }),
  ).toBeVisible();

  // CTA principal sem plano escolhido leva à escolha do plano (fluxo existente).
  const cta = page.locator('[data-analytics-event="hero_start_trial"]');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '#planos');
  await expect(page.getByText('Teste sem cadastrar nenhum cartão')).toBeVisible();

  // Guardrail de linguagem: o respaldo do profissional CREF é visível.
  await expect(page.getByText(/registro no CREF/i).first()).toBeAttached();
  await expect(page.getByText(/Regulamentado pelo CREF/).first()).toBeAttached();
});

test('a landing expõe navegação e seções principais', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  for (const name of ['Como funciona', 'Tecnologia', 'MOVIVO Club', 'Planos']) {
    await expect(nav.getByRole('link', { name })).toBeVisible();
  }
  for (const id of ['#como-funciona', '#tecnologia', '#club', '#planos']) {
    await expect(page.locator(id)).toBeAttached();
  }

  // A seção chega sem `#hash` na URL: F5 e "voltar" nunca caem no meio da página.
  await nav.getByRole('link', { name: 'Planos' }).click();
  await expect(page.locator('#planos')).toBeInViewport();
  expect(new URL(page.url()).hash).toBe('');

  await page.reload();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#topo')).toBeInViewport();
});

test('"Conheça a MOVIVO" leva a Como funciona', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.getByRole('link', { name: 'Conheça a MOVIVO' }).click();
  await expect(page.locator('#como-funciona')).toBeInViewport();
  expect(new URL(page.url()).hash).toBe('');
});

test('link externo com âncora leva à seção e limpa a URL', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#planos', { waitUntil: 'networkidle' });

  await expect(page.locator('#planos')).toBeInViewport();
  await expect.poll(() => new URL(page.url()).hash).toBe('');
});

test('planos no desktop: valores do catálogo, destaque verdadeiro e plano preservado', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const cards = page.locator('#planos article');
  await expect(cards).toHaveCount(4);
  await expect(page.getByText(/mais vendido|mais popular/i)).toHaveCount(0);

  const annual = page.locator('#planos article', { hasText: 'Anual' });
  await expect(annual).toContainText('67,90');
  await expect(annual).toContainText('814,80 por ano');
  await expect(annual).toContainText('15% OFF');
  // Destaque no plano recomendado pelo catálogo, com selo factual.
  await expect(page.locator('#planos article', { hasText: 'Semestral' })).toContainText(
    'Recomendado',
  );

  const hrefs = await cards.evaluateAll((elements) =>
    elements.map((card) => card.querySelector('a')?.getAttribute('href')),
  );
  expect(hrefs).toEqual([
    '/anamnese?plano=MONTHLY',
    '/anamnese?plano=QUARTERLY',
    '/anamnese?plano=SEMIANNUAL',
    '/anamnese?plano=ANNUAL',
  ]);

  // Cartões alinhados e CTAs dentro dos cartões.
  const geometry = await cards.evaluateAll((elements) =>
    elements.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const buttonRect = card.querySelector('a')?.getBoundingClientRect();
      return {
        top: Math.round(cardRect.top),
        fits:
          !!buttonRect && buttonRect.left >= cardRect.left && buttonRect.right <= cardRect.right,
      };
    }),
  );
  expect(new Set(geometry.map(({ top }) => top)).size).toBe(1);
  expect(geometry.every(({ fits }) => fits)).toBe(true);

  await annual.getByRole('link').click();
  await expect(page).toHaveURL(/\/anamnese/);
});

test('mobile: seletor de plano leva o plano escolhido à anamnese', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.locator('#planos').scrollIntoViewIfNeeded();
  await page.getByRole('radio', { name: /Trimestral/ }).check();
  const detailCta = page.locator('#planos a[href="/anamnese?plano=QUARTERLY"]:visible');
  await expect(detailCta).toHaveCount(1);
  await expect(page.locator('#planos')).toContainText('227,70 a cada 3 meses');

  // Depois da escolha, os CTAs genéricos já levam o plano escolhido.
  await expect(page.locator('[data-analytics-event="hero_start_trial"]')).toHaveAttribute(
    'href',
    '/anamnese?plano=QUARTERLY',
  );
});

test('menu mobile abre em tela cheia, fecha com ESC e navega', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });

  await page.getByRole('button', { name: 'Abrir menu' }).click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Navegação mobile' });
  await expect(mobileNavigation).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: /Começar 7 dias grátis/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(mobileNavigation).toHaveCount(0);

  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page
    .getByRole('navigation', { name: 'Navegação mobile' })
    .getByRole('link', { name: /Como funciona/ })
    .click();
  await expect(page.locator('#como-funciona')).toBeInViewport();
  expect(new URL(page.url()).hash).toBe('');
});

test('mobile: CTA fixo aparece depois do hero e some nos planos', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'networkidle' });

  const sticky = page.locator('[data-analytics-event="sticky_mobile_start_trial"]');
  await expect(sticky).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
  await expect(sticky).toBeVisible();
  await page.locator('#planos').scrollIntoViewIfNeeded();
  await expect(sticky).toBeHidden();
});

test('WebGL não bloqueia a página e só carrega perto da seção', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);

  await page.locator('#sistema').scrollIntoViewIfNeeded();
  await expect(page.locator('#sistema canvas')).toHaveCount(1, { timeout: 10_000 });
});

test('movimento reduzido: sem WebGL, sem conteúdo escondido', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('#sistema').scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await expect(page.locator('canvas')).toHaveCount(0);
  // Hero: com movimento reduzido fica só o pôster, nenhum vídeo.
  await expect(page.locator('#topo video')).toHaveCount(0);
  await expect(page.locator('#topo img[src*="hero-poster"]')).toHaveCount(1);
  // Why we move: sem revezamento automático, as seis frases ficam empilhadas e visíveis.
  await expect(page.locator('[data-motion="manifesto"]')).not.toHaveAttribute(
    'data-motion-live',
    '',
  );
  await expect(page.locator('[data-manifesto-item]')).toHaveCount(6);
  const hidden = await page
    .locator('[data-reveal], [data-message], [data-manifesto-item], [data-fold-piece]')
    .evaluateAll(
      (elements) =>
        elements.filter((element) => Number(getComputedStyle(element).opacity) < 1).length,
    );
  expect(hidden).toBe(0);
  await context.close();
});

test('hero: filme decorativo sobre pôster prioritário, sem bloquear cliques', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });

  // Pôster (quadro 0) já no HTML do servidor, carregado com prioridade.
  const poster = page.locator('#topo img[src*="hero-poster"]');
  await expect(poster).toHaveAttribute('loading', 'eager');
  await expect(poster).toHaveAttribute('fetchpriority', 'high');
  await expect(poster).toHaveAttribute('alt', '');

  // Vídeo montado após a hidratação: mudo, inline, em loop, sem controles, decorativo.
  const video = page.locator('#topo video');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute('aria-hidden', 'true');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('loop', '');
  await expect(video).not.toHaveAttribute('controls');
  expect(await video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
  await expect(video.locator('source')).toHaveAttribute(
    'src',
    '/assets/movivo/video/cena-hero.mp4',
  );

  // Máscaras e filme não interceptam o CTA.
  const cta = page.locator('[data-analytics-event="hero_start_trial"]');
  const box = await cta.boundingBox();
  if (!box) throw new Error('CTA do hero sem caixa');
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.dataset.analyticsEvent,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe('hero_start_trial');
});

test('hero: se o filme não carregar, o pôster continua sendo a imagem', async ({ page }) => {
  await page.route('**/cena-hero.mp4', (route) => route.abort());
  await page.goto('/', { waitUntil: 'networkidle' });
  const layer = page.locator('#topo video').locator('xpath=..');
  await expect(layer).toHaveCSS('opacity', '0');
  await expect(page.locator('#topo img[src*="hero-poster"]')).toBeVisible();
});

test('why we move: uma frase por vez, trocando sozinha', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.locator('#manifesto').scrollIntoViewIfNeeded();

  const items = page.locator('[data-manifesto-item]');
  await expect(items.nth(0)).toHaveAttribute('data-active', '');
  await expect(items.nth(0)).toBeVisible();
  // As outras ficam escondidas no mesmo lugar (a caixa não muda de altura).
  expect(
    await items.evaluateAll(
      (all) => all.filter((item) => item.checkVisibility({ visibilityProperty: true })).length,
    ),
  ).toBe(1);
  // Sem scroll nenhum, a próxima frase entra sozinha.
  await expect(items.nth(1)).toHaveAttribute('data-active', '', { timeout: 8_000 });
  await expect(items.nth(0)).not.toHaveAttribute('data-active', '');
});

test('teclado: link de pular conteúdo é o primeiro foco', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
});

for (const width of [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560, 3440]) {
  test(`não cria overflow horizontal em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.goto('/');

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));

    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  });
}
