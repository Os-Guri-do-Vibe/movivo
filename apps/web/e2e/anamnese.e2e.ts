/**
 * Smoke E2E do onboarding v2 (Sprint 6) contra `mock-dashboard-api.mjs` (porta 3101),
 * o mesmo mock server real usado pelo dashboard — necessário aqui porque a página
 * `/anamnese/[token]` busca a sessão no SERVIDOR (RSC), e `page.route()` só intercepta
 * chamadas do browser. O fluxo completo contra a API real é validado por `test:int`.
 */
import { expect, test } from '@playwright/test';

test('cadastro (etapa 1): preenche, verifica o WhatsApp e avança para a anamnese', async ({ page }) => {
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

  // Respaldo CREF sempre visível, mesmo neste ponto do funil (guardrail).
  await expect(page.locator('body')).not.toContainText(/diagnóstico|tratamento|cura/i);
});
