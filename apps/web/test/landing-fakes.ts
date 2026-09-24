/**
 * Dublês para testar o motion da landing no jsdom.
 *
 * O jsdom não tem layout nem scroll real, então o GSAP/ScrollTrigger verdadeiros não
 * produzem nada observável aqui. O GSAP falso registra cada tween/ScrollTrigger criado
 * e expõe os `vars` — o teste dispara `onEnter`/`onUpdate`/`onToggle` como o scroll
 * dispararia e verifica o efeito no DOM (atributos, estados, chamadas).
 */
import { vi } from 'vitest';

import type { GsapApi, MotionConditions } from '@/components/landing/motion/gsap';

export type FakeTrigger = {
  vars: Record<string, unknown> & {
    onEnter?: () => void;
    onLeaveBack?: () => void;
    onUpdate?: (self: { progress: number }) => void;
    onToggle?: (self: { isActive: boolean }) => void;
    onRefresh?: () => void;
  };
  progress: number;
};

export type FakeTimeline = {
  vars: Record<string, unknown> | undefined;
  calls: unknown[][];
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  scrollTrigger?: FakeTrigger;
  to: (...args: unknown[]) => FakeTimeline;
  fromTo: (...args: unknown[]) => FakeTimeline;
  set: (...args: unknown[]) => FakeTimeline;
  call: (...args: unknown[]) => FakeTimeline;
  timeScale: (value: number) => FakeTimeline;
};

export const ALL_OFF: MotionConditions = {
  motion: false,
  reduced: true,
  desktop: false,
  mobile: true,
  finePointer: false,
};

export const DESKTOP_MOTION: MotionConditions = {
  motion: true,
  reduced: false,
  desktop: true,
  mobile: false,
  finePointer: true,
};

export const MOBILE_MOTION: MotionConditions = {
  motion: true,
  reduced: false,
  desktop: false,
  mobile: true,
  finePointer: false,
};

export function createFakeGsap(conditions: MotionConditions = DESKTOP_MOTION) {
  const triggers: FakeTrigger[] = [];
  const timelines: FakeTimeline[] = [];
  const reverts: (() => void)[] = [];

  function createTrigger(vars: FakeTrigger['vars']): FakeTrigger {
    const trigger: FakeTrigger = { vars, progress: 0 };
    triggers.push(trigger);
    return trigger;
  }

  function withTrigger(vars: unknown) {
    const scrollTrigger = (vars as { scrollTrigger?: FakeTrigger['vars'] } | undefined)
      ?.scrollTrigger;
    if (scrollTrigger) createTrigger(scrollTrigger);
  }

  function timeline(vars?: Record<string, unknown>): FakeTimeline {
    const tl: FakeTimeline = {
      vars,
      calls: [],
      play: vi.fn(),
      pause: vi.fn(),
      to: (...args) => {
        tl.calls.push(['to', ...args]);
        return tl;
      },
      fromTo: (...args) => {
        tl.calls.push(['fromTo', ...args]);
        return tl;
      },
      set: (...args) => {
        tl.calls.push(['set', ...args]);
        return tl;
      },
      call: (...args) => {
        tl.calls.push(['call', ...args]);
        return tl;
      },
      timeScale: () => tl,
    };
    const scrollTrigger = vars?.scrollTrigger as FakeTrigger['vars'] | undefined;
    if (scrollTrigger) tl.scrollTrigger = createTrigger(scrollTrigger);
    timelines.push(tl);
    return tl;
  }

  const gsap = {
    set: vi.fn(),
    to: vi.fn((_target: unknown, vars: unknown) => withTrigger(vars)),
    fromTo: vi.fn((_target: unknown, _from: unknown, vars: unknown) => withTrigger(vars)),
    timeline: vi.fn(timeline),
    registerPlugin: vi.fn(),
    defaults: vi.fn(),
    utils: {
      toArray: <T extends Element>(selector: string, scope?: Element) =>
        Array.from((scope ?? document).querySelectorAll<T & Element>(selector)) as T[],
    },
    matchMedia: () => ({
      add: (
        _queries: unknown,
        setup: (context: { conditions: MotionConditions }) => void | (() => void),
      ) => {
        const cleanup = setup({ conditions });
        if (typeof cleanup === 'function') reverts.push(cleanup);
      },
      revert: () => reverts.splice(0).forEach((revert) => revert()),
    }),
  };

  const ScrollTrigger = {
    create: vi.fn((vars: FakeTrigger['vars']) => createTrigger(vars)),
    batch: vi.fn(),
    refresh: vi.fn(),
  };

  const api = { gsap, ScrollTrigger } as unknown as GsapApi;
  return { api, gsap, ScrollTrigger, triggers, timelines };
}

/** IntersectionObserver controlável: o teste decide quando um alvo "entra" na tela. */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(target: Element, isIntersecting: boolean) {
    this.callback(
      [{ target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  static reset() {
    FakeIntersectionObserver.instances = [];
  }
}

/** `matchMedia` que responde por substring da consulta (ex.: `'no-preference'`). */
export function mockMatchMedia(matches: (query: string) => boolean) {
  return vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: matches(query),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}
