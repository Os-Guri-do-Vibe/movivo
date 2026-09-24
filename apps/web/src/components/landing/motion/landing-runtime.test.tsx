/**
 * Runtime da landing e pontes de motion: primeiro toque, `section_view_*` uma vez por
 * seção, e o progresso do scroll chegando à esfera/constelação e à lista de conceitos.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as GsapModule from './gsap';

import type * as AnalyticsModule from '@/lib/landing/analytics';

import {
  ALL_OFF,
  DESKTOP_MOTION,
  FakeIntersectionObserver,
  createFakeGsap,
  mockMatchMedia,
  type FakeTrigger,
} from '../../../../test/landing-fakes';

type FakeGsap = ReturnType<typeof createFakeGsap>;

const { track, captureFirstTouch, gsapState } = vi.hoisted(() => ({
  track: vi.fn(),
  captureFirstTouch: vi.fn(),
  gsapState: {
    fake: null as null | FakeGsap,
  },
}));

vi.mock('@/lib/first-touch', () => ({ captureFirstTouch }));
vi.mock('@/lib/landing/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof AnalyticsModule>()),
  trackLandingEvent: track,
}));
vi.mock('./gsap', async (importOriginal) => ({
  ...(await importOriginal<typeof GsapModule>()),
  loadGsap: () => Promise.resolve(gsapState.fake?.api),
}));

import { ClubStage } from '../sections/club-stage';
import { PulseSystem } from '../sections/pulse-system';

import { LandingRuntime } from './landing-runtime';

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  track.mockClear();
  captureFirstTouch.mockClear();
  FakeIntersectionObserver.reset();
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LandingRuntime', () => {
  it('captura o primeiro toque e registra cada seção vista uma única vez', async () => {
    gsapState.fake = createFakeGsap(DESKTOP_MOTION);
    render(
      <div data-landing-root="">
        <section data-section-view="pricing" />
        <section data-section-view="nao-rastreada" />
        <LandingRuntime />
      </div>,
    );
    await flush();
    expect(captureFirstTouch).toHaveBeenCalled();

    const observer = FakeIntersectionObserver.instances[0];
    const [pricing, unknown] = document.querySelectorAll('[data-section-view]');
    act(() => {
      if (pricing) observer?.trigger(pricing, true);
      if (pricing) observer?.trigger(pricing, true);
      if (unknown) observer?.trigger(unknown, true);
    });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('section_view_pricing');
    // Reveals: o lote de ScrollTrigger é registrado para os blocos da página.
    expect(gsapState.fake.ScrollTrigger.batch).toHaveBeenCalled();
  });

  it('com movimento reduzido, nenhum reveal é preparado', async () => {
    gsapState.fake = createFakeGsap(ALL_OFF);
    render(
      <div data-landing-root="">
        <p data-reveal="">texto</p>
        <LandingRuntime />
      </div>,
    );
    await flush();
    expect(gsapState.fake.gsap.set).not.toHaveBeenCalled();
    expect(gsapState.fake.ScrollTrigger.batch).not.toHaveBeenCalled();
  });
});

describe('palco da esfera Pulse', () => {
  it('movimento reduzido: sistema completo, último conceito ativo', async () => {
    gsapState.fake = createFakeGsap(ALL_OFF);
    const { container } = render(<PulseSystem />);
    await flush();
    const concepts = container.querySelectorAll<HTMLElement>('[data-concept]');
    expect(concepts[concepts.length - 1]?.dataset.state).toBe('active');
    expect(concepts[0]?.dataset.state).toBe('past');
  });

  it('o scroll acende os conceitos em sequência e alimenta os núcleos', async () => {
    gsapState.fake = createFakeGsap(DESKTOP_MOTION);
    const { container } = render(<PulseSystem />);
    await flush();
    const vars = gsapState.fake.ScrollTrigger.create.mock.calls[0]?.[0] as FakeTrigger['vars'];
    act(() => vars.onUpdate?.({ progress: 0 }));
    const concepts = container.querySelectorAll<HTMLElement>('[data-concept]');
    expect(concepts[0]?.dataset.state).toBe('active');
    expect(concepts[1]?.dataset.state).toBe('future');

    act(() => vars.onUpdate?.({ progress: 0.5 }));
    expect(concepts[0]?.dataset.state).toBe('past');
    const stage = container.querySelector<HTMLElement>('[class*="scroller"]');
    expect(Number(stage?.style.getPropertyValue('--pulse-progress'))).toBeGreaterThan(0.5);
  });
});

describe('palco do Club', () => {
  it('liga a passagem da seção pela tela ao progresso da constelação', async () => {
    gsapState.fake = createFakeGsap(DESKTOP_MOTION);
    mockMatchMedia(() => false);
    render(
      <section>
        <ClubStage fallback={<span>constelação</span>} />
      </section>,
    );
    await flush();
    const vars = gsapState.fake.ScrollTrigger.create.mock.calls[0]?.[0] as FakeTrigger['vars'];
    expect(vars.start).toBe('top bottom');
    expect(() => vars.onUpdate?.({ progress: 0.4 })).not.toThrow();
  });
});
