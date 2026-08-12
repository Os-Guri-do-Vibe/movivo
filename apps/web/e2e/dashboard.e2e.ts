import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  const response = await request.post('http://127.0.0.1:3101/__reset');
  expect(response.ok()).toBe(true);
});

async function login(page: Page) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail corporativo').fill('profissional@movivo.test');
  await page.getByLabel('Senha').fill('senha-segura');
  await page.getByRole('button', { name: 'Entrar com segurança' }).click();
  await expect(page).toHaveURL(/\/dashboard\/alunos$/);
  await expect(page.getByRole('heading', { name: 'Alunos' })).toBeVisible();
}

async function openQueue(page: Page) {
  await page.getByRole('link', { name: 'Educação Física' }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/educacao-fisica$/);
  await expect(page.getByRole('heading', { name: 'Fila de supervisão' })).toBeVisible();
}

test('protege a rota e cria sessão somente em cookies httpOnly', async ({
  context,
  page,
  request,
}) => {
  const deniedStream = await request.get('/api/dashboard/queue/events');
  expect(deniedStream.status()).toBe(401);
  expect(deniedStream.headers()['cache-control']).toContain('no-store');

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

test('invalida e recarrega a fila ao receber queue.updated por SSE', async ({ page, request }) => {
  await login(page);
  await openQueue(page);
  const cases = page
    .getByRole('list', { name: 'Itens pendentes por prioridade' })
    .getByRole('listitem');
  await expect(cases).toHaveCount(4);
  await expect(page.getByRole('status')).toContainText('Atualização em tempo real ativa');

  const emitted = await request.post('http://127.0.0.1:3101/__emit');
  expect(emitted.ok()).toBe(true);

  await expect(cases).toHaveCount(5);
  await expect(page.getByText('Novo protocolo recebido em tempo real')).toBeVisible();
});

test('aceita ADMIN e mostra o overview executivo', async ({ context, page }) => {
  await page.goto('/entrar');
  await page.getByLabel('E-mail corporativo').fill('admin@movivo.test');
  await page.getByLabel('Senha').fill('senha-segura');
  await page.getByRole('button', { name: 'Entrar com segurança' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
  expect(
    (await context.cookies()).filter((cookie) => cookie.name.startsWith('movivo_bff_')),
  ).toHaveLength(2);
});

test('prioriza segurança e resolve CHECKIN pelo handoff com confirmação explícita', async ({
  page,
}) => {
  await login(page);
  await openQueue(page);
  const cases = page
    .getByRole('list', { name: 'Itens pendentes por prioridade' })
    .getByRole('listitem');
  await expect(cases).toHaveCount(4);
  await expect(cases.first()).toContainText('Segurança');
  await expect(cases.first()).toContainText('Check-in exige revisão profissional');

  await cases.first().getByRole('link').click();
  await expect(page).toHaveURL(/\/dashboard\/fila\/checkin\//);
  await expect(
    page.getByRole('heading', { name: /check-in exige revisão profissional/i }),
  ).toBeVisible();
  await expect(page.getByText('SEGURANÇA · PRIORIDADE')).toBeVisible();
  await page.getByLabel('Observações').fill('Revisão registrada pela equipe responsável.');
  await page.getByRole('button', { name: 'Resolver sinalização' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect(page).toHaveURL(/\/dashboard\/educacao-fisica$/);
  await expect(cases).toHaveCount(3);
});

test('PAR-Q começa sem decisão e libera apenas após seleção consciente', async ({ page }) => {
  await login(page);
  await openQueue(page);
  const parq = page.getByRole('listitem').filter({ hasText: 'PAR-Q aguardando liberação' });
  await parq.getByRole('link').click();
  const release = page.getByRole('button', { name: 'Registrar liberação' });
  await page.getByLabel(/registro profissional/i).fill('Revisão profissional concluída.');
  await expect(release).toBeDisabled();
  await page.getByLabel('Decisão').selectOption('RELEASED');
  await expect(release).toBeEnabled();
  await release.click();
  await page.getByRole('button', { name: 'Confirmar liberação' }).click();
  await expect(page.getByRole('status')).toContainText('Liberação PAR-Q registrada');
});

test('exibe ausência de amostra sem transformar dado desconhecido em zero', async ({ page }) => {
  await login(page);
  await openQueue(page);
  await page.getByRole('link', { name: 'Ver operações CREF' }).click();
  await expect(page).toHaveURL(/\/dashboard\/operacoes$/);
  await expect(page.getByText('Sem amostra suficiente')).toBeVisible();
  await expect(
    page.getByLabel('Primeiro treino reportado: métrica ainda indisponível'),
  ).toBeVisible();
  await expect(page.getByText('[PESSOA] relatou dificuldade.')).toBeVisible();
});

test('envia CSP com nonce e bloqueia enquadramento do dashboard', async ({ page }) => {
  const response = await page.goto('/entrar');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response?.headers()['x-frame-options']).toBe('DENY');
});
