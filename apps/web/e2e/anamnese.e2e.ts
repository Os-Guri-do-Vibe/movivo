/**
 * Smoke E2E da anamnese (US-1.6). O webServer do Playwright sobe só o front; a API
 * (3001) não está no ar, então interceptamos `POST /anamnesis/start` para provar que
 * a rota monta e chega ao bloco 1. O fluxo completo contra a API real é US-1.8.
 */
import { expect, test } from '@playwright/test';

test('a anamnese carrega o bloco 1 de identificação', async ({ page }) => {
  await page.route('**/anamnesis/start', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ token: 'e2e-token', expiresAt: '2099-01-01', lastBlock: 1 }),
    }),
  );

  await page.goto('/anamnese?goal=perder_peso');

  await expect(page.getByLabel('Seu nome')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible();
  // Guardrail: o respaldo do profissional CREF aparece na tela-ponte de consentimento.
  await page.getByLabel('Seu nome').fill('Maria Teste');
  await page.getByLabel(/WhatsApp/).fill('+5511999998888');
});
