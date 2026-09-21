import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import {
  fullBodyShareCardMock,
  workoutShareCardMock,
} from '../src/components/workout/share-card/workout-share-card.mocks';

for (const [name, data] of [
  ['masculino', workoutShareCardMock],
  ['feminino-completo', fullBodyShareCardMock],
] as const) {
  test(`gera e baixa PNG de Story — ${name}`, async ({ page }, testInfo) => {
    let finished = name !== 'masculino';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/workout/sessions/*/sets', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/workout/sessions/*/finish', (route) => {
      finished = true;
      return route.fulfill({ json: {} });
    });
    await page.route('**/api/workout/journal*', (route) =>
      route.fulfill({
        json: {
          firstName: data.user.name,
          today: '2026-09-17',
          selectedDate: '2026-09-17',
          week: [],
          workout: {
            id: '22222222-2222-4222-8222-222222222222',
            status: finished ? 'COMPLETED' : 'IN_PROGRESS',
            prescription: { dayLabel: 'A', focus: 'Treino', exercises: [] },
            startedAt: '2026-09-17T13:30:00.000Z',
            finishedAt: data.workout.completedAt,
            durationSeconds: data.workout.durationMinutes * 60,
            perceivedEffort: 5,
            painReported: false,
            sets: [],
            shareCard: finished ? data : null,
          },
        },
      }),
    );
    await page.goto('/treino');
    if (!finished) {
      await expect(page.getByRole('button', { name: 'Baixar imagem', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Finalizar treino', exact: true }).click();
      await page.getByRole('button', { name: 'Enviar e finalizar', exact: true }).click();
    }
    const downloadButton = page.getByRole('button', { name: 'Baixar imagem', exact: true });
    await expect(downloadButton).toBeEnabled({ timeout: 45_000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const downloadEvent = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadEvent;
    const path = testInfo.outputPath(`workout-share-card-${name}.png`);
    await download.saveAs(path);
    const png = await readFile(path);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);
    expect(png.length).toBeGreaterThan(50_000);
    await testInfo.attach(`card-${name}`, { path, contentType: 'image/png' });
    // Verifica o alfa do PNG real, não só o fundo transparente do componente HTML.
    const alpha = await page.locator('img[alt^="Card do treino:"]').evaluate((element) => {
      const img = element as HTMLImageElement;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas indisponível');
      context.drawImage(img, 0, 0);
      return [
        [540, 100],
        [1000, 100],
        [540, 500],
        [540, 1800],
      ].map(([x = 0, y = 0]) => context.getImageData(x, y, 1, 1).data[3]);
    });
    expect(alpha).toEqual([0, 0, 0, 0]);
    expect(
      await page.locator('[data-workout-share-card]').evaluate((card) => {
        const motto = [...card.querySelectorAll('p')].find(
          (p) => p.textContent === 'BETTER THAN YESTERDAY.',
        );
        if (!motto) return false;
        const singleLine =
          motto.getBoundingClientRect().height <=
          parseFloat(getComputedStyle(motto).lineHeight) + 1;
        return (
          singleLine &&
          motto.scrollWidth <= motto.clientWidth &&
          !card.querySelector('ul, li, footer') &&
          !/CIÊNCIA QUE TREINA|GRUPOS MUSCULARES|profissional CREF/.test(card.textContent ?? '')
        );
      }),
    ).toBe(true);
  });
}
