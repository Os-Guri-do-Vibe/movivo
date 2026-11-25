import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail corporativo').fill('profissional@movivo.test');
  await page.getByLabel('Senha').fill('senha-segura');
  await page.getByRole('button', { name: 'Acessar' }).click();
  // Rota padrão por papel: o profissional cai na Fila de exceções do seu conselho.
  await expect(page).toHaveURL(/\/dashboard\/fila$/);
  await expect(page.getByRole('heading', { name: 'Fila de exceções' })).toBeVisible();
}

test('protege a rota e cria sessão somente em cookies httpOnly', async ({
  context,
  page,
  request,
}) => {
  const denied = await request.get('/api/dashboard/control/exceptions');
  expect(denied.status()).toBe(401);
  expect(denied.headers()['cache-control']).toContain('no-store');

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/entrar$/);
  await login(page);

  const sessionCookies = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith('movivo_bff_'),
  );
  expect(sessionCookies).toHaveLength(2);
  for (const cookie of sessionCookies) {
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('movivo_bff_');
});

test('lista os casos da fila de exceções do conselho', async ({ page }) => {
  await login(page);
  const list = page.getByRole('list').filter({ hasText: 'Maria Teste' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Sinal de segurança');
});

test('aceita ADMIN e mostra o overview executivo', async ({ context, page }) => {
  await page.goto('/entrar');
  await page.getByLabel('E-mail corporativo').fill('admin@movivo.test');
  await page.getByLabel('Senha').fill('senha-segura');
  await page.getByRole('button', { name: 'Acessar' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  expect(
    (await context.cookies()).filter((cookie) => cookie.name.startsWith('movivo_bff_')),
  ).toHaveLength(2);
});

/**
 * TASK-7.9.4 — o fluxo de integração completo num teste só: login → rota padrão do papel
 * → pilar → drill-down no item. É o caminho que o fundador percorre para responder "esse
 * aluno vai cancelar?"; quebrar qualquer elo dele quebra o produto, não só uma tela.
 */
test('login → rota padrão do papel → pilar Alunos → ficha do aluno', async ({ page }) => {
  // `login()` já assere a rota padrão do PROFESSIONAL (/dashboard/fila).
  await login(page);

  await page.getByRole('link', { name: 'Base de Alunos', exact: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/alunos$/);
  await expect(page.getByRole('heading', { name: 'Base de Alunos' })).toBeVisible();

  // Base de Alunos virou tabela (achado 2026-08-19, a pedido do fundador): a
  // ordenação/filtro por coluna substituiu a lista de cards.
  const table = page.getByRole('region', { name: 'Tabela da base de alunos' });
  await expect(table.getByRole('row')).toHaveCount(2); // cabeçalho + 1 aluno
  await expect(table.getByRole('link', { name: 'Pessoa Teste' })).toBeVisible();

  await table.getByRole('link', { name: 'Pessoa Teste' }).click();
  await expect(page).toHaveURL(/\/dashboard\/alunos\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Pessoa Teste' })).toBeVisible();
  // O risco de cancelamento vem nomeado — número sozinho não gera ação (US-7.4).
  // Na tabela não cabe o motivo do risco; ele mora na ficha do aluno.
  await expect(page.getByText('Sem mensagem recebida há 14 dias')).toBeVisible();
  // Timeline única com as origens do Estado do Aluno.
  for (const label of [
    'Anamnese enviada',
    'Plano de treino v1 publicado',
    'Assinatura mensal criada',
    '12 mensagens trocadas no dia',
    'Caso da fila resolvido',
  ]) {
    await expect(page.getByText(label)).toBeVisible();
  }
});

test('envia CSP com nonce e bloqueia enquadramento do dashboard', async ({ page }) => {
  const response = await page.goto('/entrar');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response?.headers()['x-frame-options']).toBe('DENY');
});

test.describe('aba Conversas — o "WhatsApp dentro da plataforma"', () => {
  for (const [name, viewport] of [
    ['desktop', { width: 1280, height: 720 }],
    ['celular', { width: 390, height: 700 }],
    // Janela baixa (ex.: DevTools aberto embaixo): o chat tinha altura mínima e empurrava a
    // página para uma rolagem externa, sem nada abaixo dele.
    ['janela baixa', { width: 1100, height: 420 }],
  ] as const) {
    test(`sem rolagem da página: só a lista e as mensagens rolam (${name})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await login(page);
      await page.goto('/dashboard/conversas');
      // A lista de conversas (40 alunos) rola só por dentro e não estica a página.
      const conversations = page.getByRole('list', { name: 'Conversas' });
      await expect(conversations).toBeVisible();
      expect(await conversations.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height,
      );

      await page.getByRole('button', { name: /Ana Souza/ }).click();
      const log = page.getByRole('log', { name: 'Mensagens' });
      await expect(log.getByText('Mensagem de teste 1', { exact: true })).toBeAttached();

      // A página inteira cabe na janela: não existe barra de rolagem externa.
      const page_ = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        bodyScrollHeight: document.body.scrollHeight,
      }));
      expect(page_.scrollHeight).toBeLessThanOrEqual(page_.innerHeight);
      expect(page_.bodyScrollHeight).toBeLessThanOrEqual(page_.innerHeight);

      // Já a conversa é longa e rola por dentro, terminando na última mensagem.
      const inner = await log.evaluate((el) => ({
        scrollable: el.scrollHeight > el.clientHeight,
        atBottom: el.scrollHeight - el.scrollTop - el.clientHeight < 4,
      }));
      expect(inner.scrollable).toBe(true);
      expect(inner.atBottom).toBe(true);

      // Rolar a roda do mouse sobre o chat não move a página.
      await log.hover();
      await page.mouse.wheel(0, -2000);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }

  test('mostra negrito, itálico e lista como o WhatsApp', async ({ page }) => {
    await login(page);
    await page.goto('/dashboard/conversas');
    await page.getByRole('button', { name: /Ana Souza/ }).click();
    const log = page.getByRole('log', { name: 'Mensagens' });
    await expect(log.locator('strong', { hasText: 'Treino de hoje' })).toBeVisible();
    await expect(log.locator('em', { hasText: 'com calma' })).toBeVisible();
    await expect(log.getByRole('listitem')).toHaveCount(2);
    await expect(log).not.toContainText('*Treino');
  });
});
