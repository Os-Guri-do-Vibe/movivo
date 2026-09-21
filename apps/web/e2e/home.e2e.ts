/**
 * Smoke E2E da home / landing (US-1.5).
 *
 * Num browser real, prova que a landing sobe e renderiza o essencial do funil:
 *  - o hero com a proposta de valor;
 *  - o CTA principal para a anamnese (client component `StartCta`);
 *  - o respaldo CREF sempre visível (guardrail inegociável de linguagem);
 *  - as seções e âncoras principais da nova experiência editorial existem.
 */
import { expect, test } from '@playwright/test';

test('a landing carrega com hero, CTA e respaldo CREF', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /Seu potencial\s*precisa de\s*movimento\./i,
    }),
  ).toBeVisible();

  // CTA principal do funil (client component StartCta): leva à anamnese, sem coletar
  // nada de anamnese na landing (o objetivo é perguntado no bloco 1 do formulário).
  const cta = page.locator('[data-analytics-event="hero_anamnesis_click"]');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', '/anamnese');
  await expect(page.getByText('Qual é o seu foco agora?')).toHaveCount(0);

  // Guardrail de linguagem: o respaldo do profissional CREF é sempre visível.
  await expect(page.getByText(/registrado no CREF/i).first()).toBeVisible();
});

test('a landing expõe navegação e seções principais', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#como-funciona')).toBeVisible();
  await expect(page.locator('#planos')).toBeVisible();
  await expect(page.locator('#faq')).toBeVisible();
});

test('os quatro planos permanecem alinhados no grid desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');

  const cards = page.locator('#planos article');
  await expect(cards).toHaveCount(4);
  await expect(page.getByText('Para criar constância', { exact: true })).toBeVisible();

  const geometry = await cards.evaluateAll((elements) =>
    elements.map((card) => {
      const cardRect = card.getBoundingClientRect();
      const priceRect = card.querySelector('strong')?.getBoundingClientRect();
      const buttonRect = card.querySelector('a')?.getBoundingClientRect();
      const firstFeatureRect = card.querySelector('li')?.getBoundingClientRect();
      const checks = [...card.querySelectorAll('li > span')].map((check) => {
        const rect = check.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });

      return {
        top: cardRect.top,
        priceTop: priceRect ? priceRect.top - cardRect.top : -1,
        buttonTop: buttonRect ? buttonRect.top - cardRect.top : -1,
        featuresTop: firstFeatureRect ? firstFeatureRect.top - cardRect.top : -1,
        priceFits:
          !!priceRect && priceRect.left >= cardRect.left && priceRect.right <= cardRect.right,
        buttonFits:
          !!buttonRect && buttonRect.left >= cardRect.left && buttonRect.right <= cardRect.right,
        checks,
      };
    }),
  );

  expect(new Set(geometry.map(({ top }) => Math.round(top))).size).toBe(1);
  expect(new Set(geometry.map(({ priceTop }) => Math.round(priceTop))).size).toBe(1);
  expect(new Set(geometry.map(({ buttonTop }) => Math.round(buttonTop))).size).toBe(1);
  expect(new Set(geometry.map(({ featuresTop }) => Math.round(featuresTop))).size).toBe(1);
  expect(geometry.every(({ priceFits, buttonFits }) => priceFits && buttonFits)).toBe(true);
  expect(
    geometry.every(({ checks }) =>
      checks.every(({ width, height }) => Math.abs(width - height) < 0.5 && width >= 19),
    ),
  ).toBe(true);
});

for (const width of [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440, 1728, 1920, 2560, 3440]) {
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

test('menu mobile e FAQ funcionam por teclado e toque', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Abrir menu' }).click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Navegação mobile' });
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: 'Começar agora' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(mobileNavigation).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir menu' })).toBeFocused();

  const firstQuestion = page.locator('#faq details').first();
  await firstQuestion.locator('summary').click();
  await expect(firstQuestion).toHaveAttribute('open', '');
});

test('demonstração responde sem salvar dados e o CTA preserva a origem', async ({ page }) => {
  await page.goto('/?utm_source=instagram&utm_medium=social&utm_campaign=landing-redesign');
  await page.getByRole('button', { name: 'RPE 8', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('RPE 8 registrado nesta demonstração.');
  await expect(page.getByRole('button', { name: 'RPE 8', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const attribution = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('movivo.first_touch') ?? '{}'),
  );
  expect(attribution).toMatchObject({
    utmSource: 'instagram',
    utmMedium: 'social',
    utmCampaign: 'landing-redesign',
  });
  await page.locator('[data-analytics-event="hero_anamnesis_click"]').click();
  await expect(page).toHaveURL(/\/anamnese$/);
});

test('CTA mobile aparece depois do hero e recolhe em planos e rodapé', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const sticky = page.getByRole('complementary', { name: 'Comece seu acompanhamento' });
  await expect(sticky).not.toBeVisible();
  await page.locator('#produto').scrollIntoViewIfNeeded();
  await expect(sticky).toBeVisible();
  await page.locator('#planos h2').scrollIntoViewIfNeeded();
  await expect(sticky).not.toBeVisible();
  await page.locator('#rodape').scrollIntoViewIfNeeded();
  await expect(sticky).not.toBeVisible();
});

test('conteúdo e CTA permanecem disponíveis sem JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('[data-analytics-event="hero_anamnesis_click"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Navegação', exact: true })).toBeVisible();
  const faq = page.locator('#faq details').first();
  await faq.locator('summary').click();
  await expect(faq).toHaveAttribute('open', '');
  await context.close();
});

test('reduced motion preserva leitura sem animações contínuas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  expect(
    await page
      .locator('h1 > span')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await page.locator('#produto').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'RPE 7', exact: true })).toBeVisible();
});
