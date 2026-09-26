/**
 * E2E do onboarding v2 (Sprint 6 · TASK-6.12.3) contra `mock-dashboard-api.mjs` (porta
 * 3101), o mesmo mock server real usado pelo dashboard — necessário aqui porque o BFF
 * `/api/anamnesis/*` chama a API a partir do SERVIDOR Next, e `page.route()` só
 * intercepta chamadas do browser. O fluxo contra a API real é validado por `test:int`.
 *
 * Cobre as 3 etapas nas DUAS saídas (V1 READY / V2 PENDING_REVIEW), a retomada no F5, a
 * CSP com nonce e que o token da sessão nunca aparece na URL nem ao JavaScript da página.
 * A variante da tela de sucesso é decidida pelo `outcome` do servidor: o mock avalia o
 * PAR-Q no submit, exatamente como a API.
 */
import { expect, test, type Page } from '@playwright/test';

// O mock guarda UMA sessão por processo, sob o token fixo `e2e-onboarding-token`.
// Rodar em série evita que duas jornadas disputem a mesma sessão sob `fullyParallel`.
test.describe.configure({ mode: 'serial' });

async function fillStep1(page: Page) {
  await page.goto('/anamnese');
  await expect(page.getByRole('heading', { name: 'Vamos começar por você' })).toBeVisible();
  await expect(page).toHaveURL(/\/anamnese$/);
  await expect(page.getByRole('button', { name: /tema/i })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'MOVIVO' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Progresso do cadastro' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  );

  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const onboardingTheme = await page.locator('.onboarding-light').evaluate((element) => {
    const style = getComputedStyle(element);
    const header = element.querySelector('header');
    return {
      background: style.backgroundColor,
      colorScheme: style.colorScheme,
      headerBackground: header ? getComputedStyle(header).backgroundColor : null,
    };
  });
  expect(onboardingTheme).toEqual({
    background: 'rgb(255, 255, 255)',
    colorScheme: 'light',
    headerBackground: 'rgb(6, 48, 42)',
  });
  await expect(page.getByText(/Este link fica disponível/i)).toHaveCount(0);

  await page.getByLabel('Qual é o seu nome completo?').fill('Maria Teste');
  await page.getByLabel('Qual é a sua data de nascimento?').fill('01/01/1990');
  await page.getByText('Feminino').click();
  await page.getByLabel(/Qual é a sua altura/).fill('165');
  await page.getByLabel(/Qual é o seu peso/).fill('60');
  await page.getByLabel('Qual é o seu WhatsApp?').fill('11999998888');
  await page.getByLabel('Qual é o seu e-mail?').fill('maria.teste@example.com');

  // OTP: aparece assim que o telefone tem 11 dígitos; colar também auto-verifica no 6º dígito.
  await expect(page.getByText(/Confirme seu WhatsApp/)).toBeVisible();
  const otp = page.getByLabel('Código de verificação de 6 dígitos');
  await otp.focus();
  await expect(page.getByTestId('otp-caret')).toBeVisible();
  await otp.evaluate((input) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', '123456');
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: clipboard }));
  });
  await expect(page.getByText('✓ WhatsApp confirmado')).toBeVisible();

  await page.getByLabel(/Li e aceito os Termos/).check();
  await page.getByLabel(/dados de saúde/).check();
  await page.getByLabel(/inteligência artificial/).check();

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Seus objetivos' })).toBeVisible();
}

async function fillStep2(page: Page) {
  await page.getByRole('radio', { name: 'Hipertrofia' }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  const emphasisGroup = page.getByRole('group', {
    name: 'Em quais regiões você gostaria de dar mais ênfase? (opcional)',
  });
  const emphasisCards = emphasisGroup.getByRole('button');
  await expect(emphasisGroup.getByText('Corpo todo, sem preferência')).toHaveCount(0);
  await expect(emphasisCards).toHaveCount(9);
  await expect(emphasisGroup.locator('[data-icons8-icon]')).toHaveCount(9);
  await expect(emphasisGroup.getByRole('button', { name: 'Braço' })).toBeVisible();
  await expect(emphasisGroup.getByRole('button', { name: 'Bíceps' })).toHaveCount(0);
  await expect(emphasisGroup.getByRole('button', { name: 'Tríceps' })).toHaveCount(0);
  await expect(
    page.getByRole('contentinfo').getByRole('link', { name: 'Ícones por Icons8' }),
  ).toHaveAttribute('href', 'https://icons8.com');
  const [firstCard, secondCard, thirdCard, fourthCard] = await Promise.all([
    emphasisCards.nth(0).boundingBox(),
    emphasisCards.nth(1).boundingBox(),
    emphasisCards.nth(2).boundingBox(),
    emphasisCards.nth(3).boundingBox(),
  ]);
  if (!firstCard || !secondCard || !thirdCard || !fourthCard) {
    throw new Error('Os cards de ênfase precisam estar visíveis para validar a grade.');
  }
  expect(Math.abs(firstCard.width - firstCard.height)).toBeLessThanOrEqual(1);
  expect(firstCard.y).toBe(secondCard.y);
  expect(firstCard.y).toBe(thirdCard.y);
  expect(fourthCard.y).toBeGreaterThan(firstCard.y);
  await emphasisGroup.getByRole('button', { name: 'Peitoral' }).click();
  await expect(emphasisGroup.getByRole('button', { name: 'Peitoral' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(emphasisGroup.getByText('1 de 2')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Seu histórico' })).toBeVisible();
  await page.getByRole('radio', { name: 'Nunca treinei', exact: true }).click();
  await page.getByRole('combobox', { name: 'Qual é a sua experiência com musculação?' }).click();
  await page.getByRole('option', { name: /^Iniciante/ }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Sua rotina' })).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Quantos dias por semana você consegue treinar?' })
    .click();
  await page.getByRole('option', { name: '3 dias' }).click();
  await page.getByRole('radio', { name: 'Aproximadamente 45 minutos' }).click();
  await page.getByRole('radio', { name: 'Em casa' }).click();
  await page.getByRole('radio', { name: 'Manhã' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Dores e limitações' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Suas preferências' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar para saúde' }).click();
  await expect(page.getByRole('heading', { name: 'Última parte: sua segurança' })).toBeVisible();
}

/** Responde o PAR-Q inteiro; `yesAt` marca "Sim" numa das 9 perguntas (gate de risco). */
async function fillStep3(page: Page, yesAt: number | null) {
  await page.getByRole('button', { name: 'Começar' }).click();
  for (let i = 0; i < 9; i += 1) {
    await page.getByRole('radio', { name: i === yesAt ? 'Sim' : 'Não' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
  }

  const declarations = page.getByRole('checkbox');
  for (let i = 0; i < (await declarations.count()); i += 1) {
    await declarations.nth(i).check();
  }
  await page.getByRole('button', { name: 'Finalizar avaliação' }).click();
}

test('jornada V1: 3 etapas com PAR-Q limpo terminam em "Tudo pronto"', async ({ page }) => {
  await fillStep1(page);
  await fillStep2(page);
  await fillStep3(page, null);

  await expect(page.getByRole('heading', { name: /Tudo pronto/ })).toBeVisible();
  // Guardrail de linguagem em todo o funil (Clóvis/Gabriel).
  await expect(page.locator('body')).not.toContainText(/diagnóstico|tratamento|cura/i);
});

test('jornada V2: um "Sim" no PAR-Q leva à tela de supervisão, sem revelar o motivo', async ({
  page,
}) => {
  await fillStep1(page);
  await fillStep2(page);
  await fillStep3(page, 1); // "Sim" na 2ª pergunta do PAR-Q

  await expect(page.getByRole('heading', { name: /Recebemos suas informações/ })).toBeVisible();
  await expect(page.locator('body')).toContainText(/profissional responsável/);
  // A tela NUNCA devolve a resposta que travou nem o estado clínico interno (Sofia §9.3).
  await expect(page.locator('body')).not.toContainText(/Q[1-9]\b|BLOQUEADO|PAR-?Q/);
  await expect(page.locator('body')).not.toContainText(/diagnóstico|tratamento|cura/i);
});

test('retomada: F5 volta na etapa salva, não do zero, e o token não vai para a URL', async ({
  page,
}) => {
  await fillStep1(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Seus objetivos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vamos começar por você' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/anamnese$/);
  expect(page.url()).not.toContain('e2e-onboarding-token');
});

test('segurança: CSP com nonce sem violações e token fora do alcance do JavaScript', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.assign(window, { __cspViolations: violations });
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  const [documentResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().resourceType() === 'document' &&
        new URL(response.url()).pathname === '/anamnese',
    ),
    fillStep1(page),
  ]);
  // Etapa 2 inclui a grade de ênfase com os ícones do Icons8 (img-src liberado só aqui).
  await fillStep2(page);

  const csp = (await documentResponse.allHeaders())['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("img-src 'self' blob: data: https://img.icons8.com");
  // Violações do layout raiz, iguais em toda rota com CSP (/entrar, /dashboard, /treino):
  // script e estilos inline do next-themes sem nonce e a sonda `Function("")` do Zod 4.
  // Bloqueadas como deve ser, sem efeito aqui (o onboarding é sempre claro). Qualquer
  // outra — imagem, conexão, script novo — é regressão desta rota.
  const knownRootLayout = new Set([
    'script-src-elem inline',
    'script-src eval',
    'style-src-elem inline',
  ]);
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations.filter((violation) => !knownRootLayout.has(violation))).toEqual([]);

  const cookie = (await context.cookies()).find(({ name }) => name === 'movivo_anamnesis_session');
  expect(cookie).toMatchObject({
    value: 'e2e-onboarding-token',
    httpOnly: true,
    sameSite: 'Strict',
    path: '/api/anamnesis',
    expires: -1,
  });
  const visibleToScripts = await page.evaluate(() =>
    [document.cookie, JSON.stringify(sessionStorage), JSON.stringify(localStorage)].join(' '),
  );
  expect(visibleToScripts).not.toContain('e2e-onboarding-token');
});

test('CTA com plano abre /anamnese limpa e "voltar" leva à landing no topo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/', { waitUntil: 'networkidle' });
  // Passa por uma seção antes, como quem lê a landing antes de escolher o plano.
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Planos' })
    .click();
  await page.locator('#planos article', { hasText: 'Trimestral' }).getByRole('link').click();

  await expect(page.getByRole('heading', { name: 'Vamos começar por você' })).toBeVisible();
  await expect(page).toHaveURL(/\/anamnese$/);

  await page.goBack();
  await expect(
    page.getByRole('heading', { level: 1, name: /Move your potential\./i }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vamos começar por você' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // A escolha anterior não vale mais: o CTA genérico leva aos planos, não ao formulário.
  const heroCta = page.locator('[data-analytics-event="hero_start_trial"]');
  await expect(heroCta).toHaveAttribute('href', '#planos');
  await heroCta.click();
  await expect(page.locator('#planos')).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Vamos começar por você' })).toHaveCount(0);
});
