/**
 * Filme do Hero: vídeo decorativo mudo/inline só com movimento permitido e sem economia
 * de dados; aparece apenas quando está tocando (senão o pôster continua); no desktop,
 * Film Drift e playbackRate em degraus ligados à saída do Hero.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as GsapModule from '../motion/gsap';
import type { HeroMediaAssets } from '@/lib/landing/assets';

import {
  ALL_OFF,
  DESKTOP_MOTION,
  MOBILE_MOTION,
  createFakeGsap,
  mockMatchMedia,
  type FakeTrigger,
} from '../../../../test/landing-fakes';

type FakeGsap = ReturnType<typeof createFakeGsap>;
const { gsapState } = vi.hoisted(() => ({ gsapState: { fake: null as null | FakeGsap } }));
vi.mock('../motion/gsap', async (importOriginal) => ({
  ...(await importOriginal<typeof GsapModule>()),
  loadGsap: () => Promise.resolve(gsapState.fake?.api),
}));

import { HeroMedia } from './hero-media';
import { HeroPoster } from './hero-poster';

const EMPTY: HeroMediaAssets = {
  desktopVideoWebm: null,
  desktopVideoMp4: null,
  mobileVideoWebm: null,
  mobileVideoMp4: null,
  desktopPoster: null,
  mobilePoster: null,
};

const FILM: HeroMediaAssets = {
  ...EMPTY,
  desktopVideoWebm: '/d.webm',
  desktopVideoMp4: '/d.mp4',
  desktopPoster: '/p.webp',
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderInHero(assets: HeroMediaAssets) {
  return render(
    <section>
      <div data-hero-film="">
        <HeroMedia assets={assets} />
      </div>
    </section>,
  );
}

beforeEach(() => {
  gsapState.fake = createFakeGsap(ALL_OFF);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HeroMedia', () => {
  it('sem vídeo registrado não monta nada (fica o pôster)', () => {
    mockMatchMedia((query) => query.includes('no-preference'));
    const { container } = renderInHero(EMPTY);
    expect(container.querySelector('video')).toBeNull();
  });

  it('com movimento permitido: mudo, inline, em loop, sem controles e fora da acessibilidade', () => {
    mockMatchMedia((query) => query.includes('no-preference'));
    const { container } = renderInHero(FILM);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('loop');
    expect(video).toHaveAttribute('aria-hidden', 'true');
    expect(video).not.toHaveAttribute('controls');
    expect(
      [...(video?.querySelectorAll('source') ?? [])].map((source) => source.getAttribute('type')),
    ).toEqual(['video/webm', 'video/mp4']);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('só aparece quando está tocando: antes disso o pôster continua visível', () => {
    mockMatchMedia((query) => query.includes('no-preference'));
    const { container } = renderInHero(FILM);
    const layer = container.querySelector('video')?.parentElement;
    expect(layer?.className).not.toMatch(/playing/);
    fireEvent.playing(container.querySelector('video') as HTMLVideoElement);
    expect(layer?.className).toMatch(/playing/);
  });

  it('movimento reduzido: nenhum vídeo', () => {
    mockMatchMedia(() => false);
    const { container } = renderInHero(FILM);
    expect(container.querySelector('video')).toBeNull();
  });

  it('economia de dados: nenhum vídeo', () => {
    mockMatchMedia((query) => query.includes('no-preference'));
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
    const { container } = renderInHero(FILM);
    expect(container.querySelector('video')).toBeNull();
  });

  it('desktop: Film Drift até 1,025 e playbackRate em degraus até 1,08 ao sair do Hero', async () => {
    mockMatchMedia((query) => query.includes('no-preference'));
    gsapState.fake = createFakeGsap(DESKTOP_MOTION);
    const { container, unmount } = renderInHero(FILM);
    await flush();
    const video = container.querySelector('video') as HTMLVideoElement;

    const drift = gsapState.fake.gsap.fromTo.mock.calls[0];
    expect(drift?.[0]).toBe(container.querySelector('[data-hero-film]'));
    expect(drift?.[2]).toMatchObject({ scale: 1.025 });

    const vars = gsapState.fake.ScrollTrigger.create.mock.calls[0]?.[0] as FakeTrigger['vars'];
    vars.onUpdate?.({ progress: 0.5 });
    expect(video.playbackRate).toBeCloseTo(1.04);
    vars.onUpdate?.({ progress: 1 });
    expect(video.playbackRate).toBeCloseTo(1.08);

    unmount();
    expect(video.playbackRate).toBe(1);
  });

  it('mobile: sem drift e sem mexer no playbackRate', async () => {
    mockMatchMedia((query) => query.includes('no-preference') || query.includes('max-width'));
    gsapState.fake = createFakeGsap(MOBILE_MOTION);
    renderInHero(FILM);
    await flush();
    expect(gsapState.fake.gsap.fromTo).not.toHaveBeenCalled();
    expect(gsapState.fake.ScrollTrigger.create).not.toHaveBeenCalled();
  });
});

describe('HeroPoster', () => {
  it('pôster decorativo, carregado com prioridade (nunca lazy)', () => {
    const { container } = render(<HeroPoster desktop="/p.webp" />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('com pôster mobile próprio, usa art direction', () => {
    const { container } = render(<HeroPoster desktop="/d.webp" mobile="/m.webp" />);
    const source = container.querySelector('picture source');
    expect(source).toHaveAttribute('media', '(max-width: 767.98px)');
    expect(source?.getAttribute('srcset')).toContain('m.webp');
  });
});
