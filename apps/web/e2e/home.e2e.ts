/**
 * Smoke E2E da home / landing (US-1.5).
 *
 * Num browser real, prova que a landing sobe e renderiza o essencial do funil:
 *  - o hero com a proposta de valor;
 *  - o CTA principal para a anamnese (client component `GoalCta`);
 *  - o respaldo CREF sempre visível (guardrail inegociável de linguagem);
 *  - o alternador de tema fica interativo após hidratar (recado de Felipe: nasce
 *    desabilitado e só assume rótulo/ação depois de montado).
 */
import { expect, test } from '@playwright/test';

test('a landing carrega com hero, CTA e respaldo CREF', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: /Treino de verdade/ })).toBeVisible();

  // CTA principal do funil (client component GoalCta): leva à anamnese.
  await expect(page.getByRole('link', { name: 'Começar agora' })).toBeVisible();

  // Guardrail de linguagem: o respaldo do profissional CREF é sempre visível.
  await expect(page.getByText(/registrado no CREF/i).first()).toBeVisible();
});

test('o alternador de tema fica interativo após hidratar', async ({ page }) => {
  await page.goto('/');

  // Após a hidratação o botão assume o rótulo da ação e deixa de estar desabilitado.
  const toggle = page.getByRole('button', { name: /Ativar tema/ });
  await expect(toggle).toBeEnabled();
});
