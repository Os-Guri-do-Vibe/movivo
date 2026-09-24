/**
 * Efeitos por seção, dirigidos por um GSAP falso: o teste dispara os
 * callbacks que o scroll dispararia e verifica o estado no DOM. Movimento reduzido
 * nunca cria scrub/animação — o HTML já é o estado final.
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_OFF,
  DESKTOP_MOTION,
  MOBILE_MOTION,
  createFakeGsap,
  type FakeTrigger,
} from '../../../../test/landing-fakes';

vi.mock('./use-gsap', () => ({ useGsap: vi.fn() }));

import { Footer } from '../layout/footer';
import { AdaptiveTraining } from '../sections/adaptive-training';
import { DayWithMovivo } from '../sections/day-with-movivo';
import { HowItWorks } from '../sections/how-it-works';
import { IntelligenceHuman } from '../sections/intelligence-human';
import { Manifesto } from '../sections/manifesto';
import { WhatsAppExperience } from '../sections/whatsapp-experience';

import { SECTION_EFFECTS, type SectionEffect } from './effects';
import type { MotionConditions } from './gsap';

function run(effect: SectionEffect, conditions: MotionConditions) {
  const root = document.querySelector<HTMLElement>(`[data-motion="${effect}"]`);
  if (!root) throw new Error(`raiz do efeito ${effect} não encontrada`);
  const fake = createFakeGsap(conditions);
  const cleanup = SECTION_EFFECTS[effect]({ ...fake.api, root, conditions });
  return { ...fake, root, cleanup };
}

function byTrigger(triggers: FakeTrigger[], element: Element, callback: keyof FakeTrigger['vars']) {
  return triggers.find((trigger) => trigger.vars.trigger === element && callback in trigger.vars);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('movimento reduzido', () => {
  it.each([
    ['manifesto', Manifesto],
    ['whatsapp', WhatsAppExperience],
    ['intelligence', IntelligenceHuman],
    ['adaptive', AdaptiveTraining],
    ['day', DayWithMovivo],
    ['footer', Footer],
  ] as const)('%s não cria animação nem gatilho', (effect, Section) => {
    render(<Section />);
    const { gsap, ScrollTrigger } = run(effect, ALL_OFF);
    expect(gsap.fromTo).not.toHaveBeenCalled();
    expect(gsap.timeline).not.toHaveBeenCalled();
    expect(ScrollTrigger.create).not.toHaveBeenCalled();
  });
});

describe('manifesto', () => {
  it('uma frase por vez, em loop, com o mesmo ritmo para todas', () => {
    render(<Manifesto />);
    const { root, gsap, timelines } = run('manifesto', DESKTOP_MOTION);
    const items = [...document.querySelectorAll('[data-manifesto-item]')];
    expect(root).toHaveAttribute('data-motion-live');
    // Todas começam escondidas; a timeline as revela uma a uma.
    expect(gsap.set).toHaveBeenCalledWith(items, { autoAlpha: 0 });

    const loop = timelines[0];
    expect(loop?.vars).toMatchObject({ paused: true, repeat: -1 });
    const starts = loop?.calls.filter(([method]) => method === 'call').map((call) => call[3]);
    expect(starts).toHaveLength(items.length);
    const steps = starts
      ?.slice(1)
      .map((start, index) => Math.round((Number(start) - Number(starts[index])) * 1000));
    expect(new Set(steps).size).toBe(1);

    // Fold Text: cada caractere desdobra da dobradiça superior.
    const fold = loop?.calls.find(([method]) => method === 'fromTo');
    expect(fold?.[2]).toMatchObject({ opacity: 0, rotateX: -92 });
    expect(fold?.[3]).toMatchObject({ opacity: 1, rotateX: 0 });
    // "continuar." ganha o sublinhado depois da dobra.
    const underline = document.querySelector('[data-fold-underline]');
    expect(
      loop?.calls.some(
        ([method, target]) => method === 'fromTo' && (target as NodeList)[0] === underline,
      ),
    ).toBe(true);
  });

  it('marca a frase da vez e só toca com a seção na tela', () => {
    render(<Manifesto />);
    const { timelines, triggers, cleanup, root } = run('manifesto', MOBILE_MOTION);
    const loop = timelines[0];
    const items = [...document.querySelectorAll('[data-manifesto-item]')];

    const [, mark, args] = loop?.calls.find(([method]) => method === 'call') ?? [];
    (mark as (index: number) => void)(...(args as [number]));
    expect(items[0]).toHaveAttribute('data-active');
    (mark as (index: number) => void)(2);
    expect(items[0]).not.toHaveAttribute('data-active');
    expect(items[2]).toHaveAttribute('data-active');

    const visibility = triggers.find((trigger) => trigger.vars.onToggle);
    visibility?.vars.onToggle?.({ isActive: true });
    expect(loop?.play).toHaveBeenCalled();
    visibility?.vars.onToggle?.({ isActive: false });
    expect(loop?.pause).toHaveBeenCalled();

    cleanup?.();
    expect(root).not.toHaveAttribute('data-motion-live');
    expect(document.querySelectorAll('[data-manifesto-item][data-active]')).toHaveLength(0);
  });
});

describe('whatsapp', () => {
  it.each([
    ['desktop', DESKTOP_MOTION],
    ['mobile', MOBILE_MOTION],
  ] as const)('%s: a conversa toca sozinha, em loop, com o aparelho na tela', (_, conditions) => {
    render(<WhatsAppExperience />);
    const { ScrollTrigger, timelines, gsap } = run('whatsapp', conditions);
    const loop = timelines[0];
    // Mensagens começam colapsadas e são reveladas em ordem pela timeline.
    expect(gsap.set).toHaveBeenCalled();
    expect(loop?.vars).toMatchObject({ paused: true, repeat: -1 });
    expect(loop?.calls.filter(([method]) => method === 'to').length).toBeGreaterThan(5);

    // Fim da volta: depois de uma pausa para leitura, todas as mensagens somem juntas.
    const items = [...document.querySelectorAll('[data-message]')];
    const clear = loop?.calls.find(
      ([method, target]) =>
        method === 'to' && Array.isArray(target) && target.length === items.length,
    );
    expect(clear?.[2]).toMatchObject({ opacity: 0 });
    expect(Number(String(clear?.[3]).replace('+=', ''))).toBeGreaterThan(0);

    // Nada ligado ao scroll: o gatilho só dá play/pause conforme o aparelho está na tela.
    const vars = ScrollTrigger.create.mock.calls[0]?.[0] as FakeTrigger['vars'];
    expect(vars.scrub).toBeUndefined();
    expect(vars.animation).toBeUndefined();
    vars.onToggle?.({ isActive: true });
    expect(loop?.play).toHaveBeenCalled();
    vars.onToggle?.({ isActive: false });
    expect(loop?.pause).toHaveBeenCalled();
  });

  it('"digitando" antes de cada resposta da MOVIVO, mais longo para mensagem longa', () => {
    render(<WhatsAppExperience />);
    const { timelines } = run('whatsapp', MOBILE_MOTION);
    const typing = document.querySelector('[data-typing]');
    const holds = timelines[0]?.calls
      .filter(([method, target, , position]) => method === 'to' && target === typing && position)
      .map(([, , , position]) => Number(String(position).replace('+=', '')));
    const replies = document.querySelectorAll('[data-message="in"]');
    expect(holds).toHaveLength(replies.length);
    expect(holds?.[1]).toBeGreaterThan(holds?.[0] ?? Infinity);
  });
});

describe('how it works', () => {
  it('o ato em leitura vira o visual ativo — também com movimento reduzido', () => {
    render(<HowItWorks />);
    const { triggers, cleanup } = run('howItWorks', ALL_OFF);
    const layout = document.querySelector<HTMLElement>('[data-how-layout]');
    const acts = document.querySelectorAll('[data-act]');
    const third = acts[2];
    const trigger = third ? byTrigger(triggers, third, 'onToggle') : undefined;

    trigger?.vars.onToggle?.({ isActive: false });
    expect(layout?.dataset.activeAct).toBe('0');

    trigger?.vars.onToggle?.({ isActive: true });
    expect(layout?.dataset.activeAct).toBe('2');
    expect(third).toHaveAttribute('data-active');
    expect(document.querySelector('[data-visual="2"]')).toHaveAttribute('data-active');
    expect(document.querySelector('[data-visual="0"]')).not.toHaveAttribute('data-active');

    if (typeof cleanup === 'function') cleanup();
    expect(layout?.dataset.activeAct).toBe('0');
    expect(third).not.toHaveAttribute('data-active');
  });
});

describe('intelligence', () => {
  it('desktop converge as metades; mobile só aproxima as letras', () => {
    render(<IntelligenceHuman />);
    expect(run('intelligence', DESKTOP_MOTION).gsap.fromTo).toHaveBeenCalledTimes(4);
    expect(run('intelligence', MOBILE_MOTION).gsap.fromTo).toHaveBeenCalledTimes(2);
  });
});

describe('adaptive', () => {
  it('cada semana acende quando a linha a alcança e o cleanup desfaz', () => {
    render(<AdaptiveTraining />);
    const { timelines, root, cleanup } = run('adaptive', MOBILE_MOTION);
    const trigger = timelines[0]?.scrollTrigger;
    const steps = document.querySelectorAll('[data-step]');
    expect(root).toHaveAttribute('data-motion-live');

    trigger?.vars.onRefresh?.();
    trigger?.vars.onUpdate?.({ progress: 1 });
    expect([...steps].every((step) => step.hasAttribute('data-reached'))).toBe(true);

    if (typeof cleanup === 'function') cleanup();
    expect(root).not.toHaveAttribute('data-motion-live');
    expect([...steps].some((step) => step.hasAttribute('data-reached'))).toBe(false);
  });
});

describe('day e final CTA', () => {
  it('um dia: parallax só no desktop', () => {
    render(<DayWithMovivo />);
    expect(run('day', DESKTOP_MOTION).gsap.fromTo).toHaveBeenCalledTimes(10);
    expect(run('day', MOBILE_MOTION).gsap.fromTo).not.toHaveBeenCalled();
  });

  it('rodapé: a assinatura em vidro entra uma vez, ao chegar na tela', () => {
    render(<Footer />);
    const { triggers, root, cleanup } = run('footer', MOBILE_MOTION);
    const word = document.querySelector('[data-footer-glass]');
    expect(root).toHaveAttribute('data-motion-live');
    expect(word).not.toHaveAttribute('data-in');

    const enter = triggers.find((trigger) => trigger.vars.trigger === word);
    expect(enter?.vars.once).toBe(true);
    enter?.vars.onEnter?.();
    expect(word).toHaveAttribute('data-in');

    cleanup?.();
    expect(root).not.toHaveAttribute('data-motion-live');
    expect(word).not.toHaveAttribute('data-in');
  });
});
