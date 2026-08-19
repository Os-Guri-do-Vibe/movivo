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
  await page.getByRole('button', { name: 'Acessar' }).click();
  // Rota padrão por papel (US-7.1): PROFESSIONAL cai na Fila do Profissional.
  await expect(page).toHaveURL(/\/dashboard\/educacao-fisica$/);
  await expect(page.getByRole('heading', { name: 'Fila de supervisão' })).toBeVisible();
}

async function openQueue(page: Page) {
  await page.getByRole('link', { name: 'Fila do Profissional' }).first().click();
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
  // Fila de supervisão (achado 2026-08-18): só protocolo (Opcional) + PAR-Q bloqueado
  // (Obrigatória) — handoff/check-in ficam fora desta tela.
  const mandatory = page.getByRole('list', { name: 'Revisão Humana Obrigatória' });
  const optional = page.getByRole('list', { name: 'Revisão Humana Opcional' });
  await expect(mandatory.getByRole('listitem')).toHaveCount(1);
  await expect(optional.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('status')).toContainText('Atualização em tempo real ativa');

  const emitted = await request.post('http://127.0.0.1:3101/__emit');
  expect(emitted.ok()).toBe(true);

  await expect(mandatory.getByRole('listitem')).toHaveCount(1);
  await expect(optional.getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Novo protocolo recebido em tempo real')).toBeVisible();
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
  // A categoria "Sistema" começa recolhida (a rota atual é de Alunos) — abre antes de clicar.
  await page.getByRole('button', { name: 'Sistema' }).first().click();
  await page.getByRole('link', { name: 'Filas & Jobs', exact: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/operacoes$/);
  await expect(page.getByText('Sem amostra suficiente')).toBeVisible();
  await expect(
    page.getByLabel('Primeiro treino reportado: métrica ainda indisponível'),
  ).toBeVisible();
  await expect(page.getByText('[PESSOA] relatou dificuldade.')).toBeVisible();
});

/**
 * TASK-7.9.4 — o fluxo de integração completo num teste só: login → rota padrão do papel
 * → pilar → drill-down no item. É o caminho que o fundador percorre para responder "esse
 * aluno vai cancelar?"; quebrar qualquer elo dele quebra o produto, não só uma tela.
 */
test('login → rota padrão do papel → pilar Alunos → ficha do aluno', async ({ page }) => {
  // `login()` já assere a rota padrão do PROFESSIONAL (/dashboard/educacao-fisica).
  await login(page);

  await page.getByRole('link', { name: 'Base de Alunos', exact: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/alunos$/);
  await expect(page.getByRole('heading', { name: 'Base de Alunos' })).toBeVisible();

  // `> li` e não `getByRole('listitem')`: a lista de sinais de risco dentro do card
  // também é uma `<ul>`, e o papel casaria com os `li` aninhados.
  const students = page.getByRole('list', { name: 'Alunos autorizados' }).locator('> li');
  await expect(students).toHaveCount(1);
  await expect(students.first()).toContainText('Pessoa Teste');
  // O risco de cancelamento vem nomeado — número sozinho não gera ação (US-7.4).
  await expect(students.first()).toContainText('Sem mensagem recebida há 14 dias');

  await students.first().getByRole('link', { name: 'Abrir ficha do aluno' }).click();
  await expect(page).toHaveURL(/\/dashboard\/alunos\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Pessoa Teste' })).toBeVisible();
  // Timeline única com as 6 origens (US-7.4, TASK-7.4.1).
  for (const label of [
    'Anamnese concluída',
    'Protocolo v1 gerado',
    'Trial iniciado',
    'Check-in da semana 2',
    '12 mensagens trocadas no dia',
    'Atendimento humano resolvido',
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
