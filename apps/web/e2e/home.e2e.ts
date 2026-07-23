/**
 * Smoke E2E da home (US-0.8 / TASK-0.8.2).
 *
 * Num browser real, prova que a fundação do frontend sobe e renderiza:
 *  - a home responde e traz o título da marca (a página não quebrou no servidor);
 *  - um componente do design system "O Pulso" (Button) aparece de fato;
 *  - o alternador de tema fica interativo após hidratar (recado de Felipe: nasce
 *    desabilitado e só assume rótulo/ação depois de montado).
 *
 * Não valida copy de produto — esta é a casca da Sprint 0, não a landing.
 */
import { expect, test } from '@playwright/test';

test('a home carrega e mostra o design system', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'MOVIVO' })).toBeVisible();

  // Componente do design system renderizado (prova o pipeline shadcn/ui + tokens).
  await expect(page.getByRole('button', { name: 'Ação primária' })).toBeVisible();

  // Prova de consumo de @movivo/shared: a versão vinda do pacote aparece na página.
  await expect(page.getByText('0.1.0').first()).toBeVisible();
});

test('o alternador de tema fica interativo após hidratar', async ({ page }) => {
  await page.goto('/');

  // Após a hidratação o botão assume o rótulo da ação e deixa de estar desabilitado.
  const toggle = page.getByRole('button', { name: /Ativar tema/ });
  await expect(toggle).toBeEnabled();
});
