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
  await expect(page.getByRole('heading', { name: 'Fila do Profissional' })).toBeVisible();
}

async function openQueue(page: Page) {
  await page.getByRole('link', { name: 'Fila do Profissional' }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/educacao-fisica$/);
  await expect(page.getByRole('heading', { name: 'Fila do Profissional' })).toBeVisible();
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
  // Fila de supervisão (2026-08-24): só protocolo — o obrigatório é o de origem PAR-Q,
  // o opcional é o resto. Handoff/check-in ficam fora desta tela.
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

/**
 * 2026-08-24: PAR-Q bloqueante deixou de ter tela e ação próprias. Ele é um protocolo
 * `MANDATORY` na fila, marcado só pela severidade e pela legenda de origem, e a
 * liberação acontece dentro do "Assinar e liberar" — o MESMO fluxo do protocolo
 * opcional. O teste percorre exatamente esse caminho.
 */
test('PAR-Q bloqueante é revisado e liberado pelo fluxo normal de assinatura', async ({ page }) => {
  await login(page);
  await openQueue(page);
  const mandatory = page.getByRole('list', { name: 'Revisão Humana Obrigatória' });
  const card = mandatory.getByRole('listitem').first();
  await expect(card).toContainText('Origem: PAR-Q bloqueante');

  await card.getByRole('link', { name: 'Abrir protocolo' }).click();
  await expect(page).toHaveURL(/\/dashboard\/fila\/protocol\/[0-9a-f-]+$/);
  // Nenhuma ação de liberação separada sobrou: só a tela padrão de revisão.
  await expect(page.getByRole('button', { name: 'Registrar liberação' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Protocolo · versão 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Editar Protocolo' })).toBeVisible();

  await page.getByRole('button', { name: 'Assinar e liberar' }).click();
  await page.getByRole('button', { name: 'Confirmar e assinar' }).click();
  await expect(page.getByRole('status')).toContainText('auditoria registrada');
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
  // Timeline única com as 6 origens (US-7.4, TASK-7.4.1).
  for (const label of [
    'Formulário de anamnese enviado',
    'Versão 1 do protocolo gerada',
    'Assinatura mensal criada',
    'Check-in da semana 2 enviado',
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
