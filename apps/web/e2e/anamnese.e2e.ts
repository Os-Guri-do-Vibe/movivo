/**
 * E2E da anamnese contra `mock-dashboard-api.mjs` (porta 3101), o mesmo mock server do
 * painel: o BFF `/api/anamnesis/*` chama a API a partir do SERVIDOR Next, e `page.route()` só
 * intercepta chamadas do browser. Aqui fica o que só um navegador real prova: o cadastro
 * (etapa 1) atravessando o BFF, a retomada no F5, a CSP com nonce e que o token da sessão
 * nunca aparece na URL nem ao JavaScript da página. As etapas seguintes e o gate do PAR-Q
 * têm teste de componente (`onboarding-wizard.test.tsx`) e de integração (`anamnesis.int-spec.ts`).
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
  await expect(page.getByRole('heading', { name: 'Qual é o seu objetivo?' })).toBeVisible();
}

test('retomada: F5 volta na etapa salva, não do zero, e o token não vai para a URL', async ({
  page,
}) => {
  await fillStep1(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Qual é o seu objetivo?' })).toBeVisible();
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
  const csp = (await documentResponse.allHeaders())['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
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

  // A escolha anterior não vale mais: o CTA do Hero volta ao plano mensal.
  const heroCta = page.locator('[data-analytics-event="hero_start_trial"]');
  await expect(heroCta).toHaveAttribute('href', '/anamnese?plano=MONTHLY');
});

test('Termos e Privacidade beta abrem nas rotas públicas com pendências visíveis', async ({
  page,
}) => {
  for (const [path, title] of [
    ['/termos', 'Termos de Uso'],
    ['/privacidade', 'Política de Privacidade'],
  ] as const) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('note')).toContainText('Versão beta para consulta');
    await expect(page.getByRole('article', { name: title })).toContainText('[CNPJ]');
  }
});
