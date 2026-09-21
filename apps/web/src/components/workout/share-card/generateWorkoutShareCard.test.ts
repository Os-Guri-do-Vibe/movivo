import { describe, expect, it, vi } from 'vitest';

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));
import { toBlob } from 'html-to-image';
import { formatShareCardDuration, generateWorkoutShareCard } from './generateWorkoutShareCard';

describe('formatShareCardDuration', () => {
  it.each([
    [45, '45min'],
    [65, '1h 05min'],
    [90, '1h 30min'],
    [720, '12h 00min'],
    [0, '0min'],
    [0.5, '<1min'],
    [-1, '—'],
    [NaN, '—'],
  ])('%s → %s', (minutes, text) => {
    expect(formatShareCardDuration(minutes as number)).toBe(text);
  });
});

it('espera os corpos e exporta exatamente 1080×1920, sem multiplicar pelo DPR', async () => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const decode = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = decode;
    },
  );
  const node = document.createElement('div');
  node.innerHTML =
    '<img src="/brand/movivo-logo-horizontal.svg"><svg><image href="/front.webp" /></svg><svg><image href="/back.webp" /></svg>';
  const png = new Blob(['png'], { type: 'image/png' });
  vi.mocked(toBlob).mockResolvedValueOnce(png);
  expect(await generateWorkoutShareCard(node)).toBe(png);
  expect(decode).toHaveBeenCalledTimes(3);
  expect(toBlob).toHaveBeenCalledWith(
    node,
    expect.objectContaining({
      width: 1080,
      height: 1920,
      canvasWidth: 1080,
      canvasHeight: 1920,
      pixelRatio: 1,
    }),
  );
  expect(vi.mocked(toBlob).mock.calls[0]?.[1]).not.toHaveProperty('backgroundColor');
  vi.mocked(toBlob).mockResolvedValueOnce(null);
  await expect(generateWorkoutShareCard(node)).rejects.toThrow('Não foi possível');
  vi.unstubAllGlobals();
});
