import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';

import {
  fullBodyShareCardMock,
  workoutShareCardMock,
} from '../src/components/workout/share-card/workout-share-card.mocks';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';

/** PNG RGBA 1080×1920 totalmente transparente: o servidor real é coberto pelos testes da API. */
function storyPng(): Buffer {
  const width = 1080;
  const height = 1920;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function mockJournal(page: Page, data: typeof workoutShareCardMock) {
  await page.route('**/api/workout/journal*', (route) =>
    route.fulfill({
      json: {
        firstName: data.user.name,
        today: '2026-09-17',
        selectedDate: '2026-09-17',
        week: [],
        workout: {
          id: SESSION_ID,
          status: 'COMPLETED',
          prescription: { dayLabel: 'A', focus: 'Treino', exercises: [] },
          startedAt: '2026-09-17T13:30:00.000Z',
          finishedAt: data.workout.completedAt,
          durationSeconds: data.workout.durationMinutes * 60,
          perceivedEffort: 5,
          painReported: false,
          sets: [],
          shareCard: data,
        },
      },
    }),
  );
}

for (const [name, data] of [
  ['masculino', workoutShareCardMock],
  ['feminino-completo', fullBodyShareCardMock],
] as const) {
  test(`mostra o card pronto do servidor e baixa o PNG — ${name}`, async ({ page }, testInfo) => {
    const png = storyPng();
    await page.setViewportSize({ width: 390, height: 844 });
    await mockJournal(page, data);
    await page.route('**/api/workout/sessions/*/share-card', (route) =>
      route.fulfill({ body: png, contentType: 'image/png' }),
    );
    await page.goto('/treino');
    const downloadButton = page.getByRole('button', { name: 'Baixar imagem', exact: true });
    // O PNG já vem pronto: nada de "gerar" no aparelho, então não pode demorar.
    await expect(downloadButton).toBeEnabled({ timeout: 5_000 });
    await expect(page.locator('img[alt^="Card do treino:"]')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const downloadEvent = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('movivo-treino-2026-09-17.png');
    const path = testInfo.outputPath(`workout-share-card-${name}.png`);
    await download.saveAs(path);
    const saved = await readFile(path);
    expect(saved.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([saved.readUInt32BE(16), saved.readUInt32BE(20)]).toEqual([1080, 1920]);
  });
}

test('recupera sozinho de falha transitória do servidor (503) sem o aluno fazer nada', async ({
  page,
}) => {
  let calls = 0;
  await mockJournal(page, workoutShareCardMock);
  await page.route('**/api/workout/sessions/*/share-card', (route) => {
    calls += 1;
    return calls < 3
      ? route.fulfill({ status: 503, json: { message: 'indisponível' } })
      : route.fulfill({ body: storyPng(), contentType: 'image/png' });
  });
  await page.goto('/treino');
  await expect(page.getByRole('button', { name: 'Baixar imagem', exact: true })).toBeEnabled({
    timeout: 10_000,
  });
  expect(calls).toBe(3);
});

test('falha persistente mostra "Gerar novamente" e a nova tentativa funciona', async ({ page }) => {
  let healthy = false;
  await mockJournal(page, workoutShareCardMock);
  await page.route('**/api/workout/sessions/*/share-card', (route) =>
    healthy
      ? route.fulfill({ body: storyPng(), contentType: 'image/png' })
      : route.fulfill({ status: 503, json: { message: 'indisponível' } }),
  );
  await page.goto('/treino');
  const retry = page.getByRole('button', { name: 'Gerar novamente' });
  await expect(retry).toBeVisible({ timeout: 10_000 });
  healthy = true;
  await retry.click();
  await expect(page.getByRole('button', { name: 'Baixar imagem', exact: true })).toBeEnabled({
    timeout: 5_000,
  });
});
