/**
 * Configuração do Playwright — smoke E2E do frontend (US-0.8 / TASK-0.8.2).
 *
 * Escopo da Sprint 0: UM smoke que prova que a casca sobe de verdade num browser real
 * (home carrega + um componente do design system aparece). Os fluxos de produto
 * (anamnese, dashboard CREF) chegam com telas nas próximas sprints.
 *
 * `webServer` sobe o dev server na 3000 (recado de Felipe, US-0.5) e o reaproveita se já
 * estiver no ar localmente; no CI ele sempre sobe do zero. Chromium só — cobertura de
 * navegadores é decisão de sprint posterior, não de fundação.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
