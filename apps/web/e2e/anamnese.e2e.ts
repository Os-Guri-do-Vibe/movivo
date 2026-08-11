/**
 * E2E do onboarding v2 (Sprint 6 · TASK-6.12.3) contra `mock-dashboard-api.mjs` (porta
 * 3101), o mesmo mock server real usado pelo dashboard — necessário aqui porque a página
 * `/anamnese/[token]` busca a sessão no SERVIDOR (RSC), e `page.route()` só intercepta
 * chamadas do browser. O fluxo contra a API real é validado por `test:int`.
 *
 * Cobre as 3 etapas nas DUAS saídas (V1 READY / V2 PENDING_REVIEW) e a retomada por
 * token. A variante da tela de sucesso é decidida pelo `outcome` do servidor: o mock
 * avalia o PAR-Q no submit, exatamente como a API.
 */
import { expect, test, type Page } from '@playwright/test';

// O mock guarda UMA sessão por processo, sob o token fixo `e2e-onboarding-token`.
// Rodar em série evita que duas jornadas disputem a mesma sessão sob `fullyParallel`.
test.describe.configure({ mode: 'serial' });

async function fillStep1(page: Page) {
  await page.goto('/anamnese');
  await expect(page).toHaveURL(/\/anamnese\/e2e-onboarding-token$/);
  await expect(page.getByRole('heading', { name: 'Cadastro pessoal' })).toBeVisible();

  await page.getByLabel('Qual é o seu nome completo?').fill('Maria Teste');
  await page.getByLabel('Qual é a sua data de nascimento?').fill('1990-01-01');
  await page.getByText('Feminino').click();
  await page.getByLabel('Qual é o seu WhatsApp?').fill('11999998888');

  // OTP: aparece assim que o telefone tem 11 dígitos; auto-verifica no 6º dígito.
  await expect(page.getByText(/Confirme seu WhatsApp/)).toBeVisible();
  await page.getByLabel('Código de verificação de 6 dígitos').fill('123456');
  await expect(page.getByText('✓ WhatsApp confirmado')).toBeVisible();

  await page.getByLabel(/Li e aceito os Termos/).check();
  await page.getByLabel(/dados de saúde/).check();
  await page.getByLabel(/inteligência artificial/).check();

  await page.getByRole('button', { name: 'CONTINUAR' }).click();
  await expect(page.getByRole('heading', { name: 'Conte um pouco sobre você' })).toBeVisible();
}

async function fillStep2(page: Page) {
  await page.getByRole('radio', { name: 'Ganhar massa muscular' }).click();
  await page.getByRole('radio', { name: 'Nunca treinei', exact: true }).click();
  await page.getByRole('radio', { name: /^Iniciante/ }).click();
  await page.getByRole('radio', { name: '3 dias' }).click();
  await page.getByRole('radio', { name: 'Aproximadamente 45 minutos' }).click();
  await page.getByRole('radio', { name: 'Em casa' }).click();
  await page.getByRole('radio', { name: 'Manhã' }).click();
  await page.getByRole('button', { name: 'CONTINUAR' }).click();
  await expect(page.getByRole('heading', { name: 'Avaliação de segurança' })).toBeVisible();
}

/** Responde o PAR-Q inteiro; `yesAt` marca "Sim" numa das 9 perguntas (gate de risco). */
async function fillStep3(page: Page, yesAt: number | null) {
  const groups = page.locator('fieldset', { has: page.getByRole('radio', { name: 'Não' }) });
  const total = await groups.count();
  for (let i = 0; i < total; i += 1) {
    const group = groups.nth(i);
    await group.getByRole('radio', { name: i === yesAt ? 'Sim' : 'Não' }).click();
  }

  const declarations = page.getByRole('checkbox');
  for (let i = 0; i < (await declarations.count()); i += 1) {
    await declarations.nth(i).check();
  }
  await page.getByRole('button', { name: 'FINALIZAR AVALIAÇÃO' }).click();
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

test('retomada por token: recarregar o link volta na etapa salva, não do zero', async ({
  page,
}) => {
  await fillStep1(page);

  await page.goto('/anamnese/e2e-onboarding-token');
  await expect(page.getByRole('heading', { name: 'Conte um pouco sobre você' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cadastro pessoal' })).toHaveCount(0);
});
