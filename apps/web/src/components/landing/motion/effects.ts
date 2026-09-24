/**
 * Efeitos por seção (quase todos ligados ao scroll). Cada efeito recebe o GSAP já carregado, a raiz da seção e
 * as condições de mídia; tudo o que cria é revertido pelo `gsap.matchMedia()` do hook.
 *
 * Regras comuns (NADA SE MOVE SEM MOTIVO):
 *  - movimento reduzido → nenhum scrub, nenhum pin: o HTML já está no estado final;
 *  - nada de scroll hijacking: só `scrub` sobre o scroll nativo, sem pin prolongado;
 *  - mobile recebe versões mais curtas e sem sticky longo.
 */
import type { MotionSetup } from './use-gsap';

type EffectApi = Parameters<MotionSetup>[0];
type Effect = (api: EffectApi) => void | (() => void);

/** Ritmo do Why we move (s): toda frase leva o mesmo tempo, curta ou longa. */
const MANIFESTO_RHYTHM = {
  /** Cascata do Fold Text, distribuída pela frase inteira. */
  spread: 0.6,
  /** Dobra de cada caractere. */
  fold: 0.55,
  /** Frase inteira na tela, parada. */
  hold: 2.6,
  exit: 0.45,
  /** Caixa vazia entre uma frase e a próxima. */
  gap: 0.25,
} as const;

/**
 * Why we move: as frases se revezam sozinhas no centro da caixa, em loop e com o mesmo
 * ritmo. Cada uma entra em Fold Text (cada caractere desdobra da dobradiça superior,
 * a sombra da dobra sumindo junto; o sublinhado corre depois), fica parada e sai
 * subindo. O loop só toca com a seção na tela.
 */
function manifesto({ gsap, ScrollTrigger, root, conditions }: EffectApi) {
  if (!conditions.motion) return;
  const items = gsap.utils.toArray<HTMLElement>('[data-manifesto-item]', root);
  if (!items.length) return;

  root.setAttribute('data-motion-live', '');
  gsap.set(items, { autoAlpha: 0 });

  const { spread, fold, hold, exit, gap } = MANIFESTO_RHYTHM;
  const mark = (active: number) =>
    items.forEach((item, index) => {
      if (index === active) item.setAttribute('data-active', '');
      else item.removeAttribute('data-active');
    });
  const timeline = gsap.timeline({ paused: true, repeat: -1 });
  let at = 0;
  items.forEach((item, index) => {
    const pieces = gsap.utils.toArray<HTMLElement>('[data-fold-piece]', item);
    const underline = item.querySelectorAll('[data-fold-underline]');
    timeline
      .call(mark, [index], at)
      .set(item, { autoAlpha: 1, y: 0 }, at)
      .fromTo(
        pieces,
        { opacity: 0, rotateX: -92, '--fold-crease': 0.6 },
        {
          opacity: 1,
          rotateX: 0,
          '--fold-crease': 0,
          duration: fold,
          ease: 'power3.out',
          stagger: { amount: spread },
          force3D: true,
        },
        at,
      );
    if (underline.length) {
      timeline.fromTo(
        underline,
        { scaleX: 0 },
        { scaleX: 1, duration: 0.5, ease: 'power3.inOut' },
        at + spread + 0.2,
      );
    }
    timeline.to(
      item,
      { autoAlpha: 0, y: -24, duration: exit, ease: 'power2.in' },
      at + spread + fold + hold,
    );
    at += spread + fold + hold + exit + gap;
  });
  // Fecha o ciclo com a mesma pausa antes de a primeira frase voltar.
  timeline.set({}, {}, at);

  ScrollTrigger.create({
    trigger: root,
    start: 'top 75%',
    end: 'bottom 25%',
    onToggle: (self) => {
      if (self.isActive) timeline.play();
      else timeline.pause();
    },
  });

  return () => {
    mark(-1);
    root.removeAttribute('data-motion-live');
  };
}

/** Fim de cada volta da conversa do WhatsApp (s). */
const WHATSAPP_LOOP = {
  /** Conversa inteira na tela, parada: dá tempo de ler a última resposta (longa). */
  hold: 5,
  /** As mensagens somem juntas. */
  clear: 0.5,
  /** Chat vazio antes de a primeira mensagem voltar. */
  gap: 0.8,
} as const;

/**
 * Conversa no WhatsApp: toca sozinha, em loop, enquanto o aparelho está na tela — nada
 * depende de rolar. As mensagens chegam como num chat real (colapsadas → empurram as
 * anteriores), com "digitando…" antes de cada resposta da MOVIVO, proporcional ao tamanho
 * da mensagem; no fim, a conversa fica parada para leitura, some e recomeça. No desktop o
 * aparelho ainda flutua de leve com o scroll (±3°).
 */
function whatsapp({ gsap, ScrollTrigger, root, conditions }: EffectApi) {
  if (!conditions.motion) return;
  const phone = root.querySelector<HTMLElement>('[data-phone]');
  const typing = root.querySelector<HTMLElement>('[data-typing]');
  const items = gsap.utils.toArray<HTMLElement>('[data-message]', root);
  if (!phone || !typing || !items.length) return;

  gsap.set(items, { height: 0, marginTop: 0, opacity: 0, y: 12, scale: 0.96, overflow: 'hidden' });
  const timeline = gsap.timeline({ paused: true, repeat: -1, defaults: { ease: 'power2.out' } });
  for (const item of items) {
    const kind = item.dataset.message;
    if (kind === 'in') {
      // Mensagem longa, digitação mais longa (entre 0,6s e 1,8s).
      const typed = Math.min(1.8, 0.5 + (item.textContent?.length ?? 0) / 300);
      timeline
        .to(typing, { height: 30, marginTop: 8, opacity: 1, duration: 0.3 })
        .to(typing, { height: 0, marginTop: 0, opacity: 0, duration: 0.2 }, `+=${typed}`);
    } else {
      // Pausa de quem lê e responde.
      timeline.to({}, { duration: 1.1 });
    }
    timeline.to(item, {
      height: 'auto',
      marginTop: 8,
      opacity: 1,
      y: 0,
      scale: 1,
      duration: 0.45,
    });
  }
  // Fecha a volta: o repeat devolve cada mensagem ao estado colapsado do início.
  const { hold, clear, gap } = WHATSAPP_LOOP;
  timeline
    .to(items, { opacity: 0, duration: clear, ease: 'power1.in' }, `+=${hold}`)
    .to({}, { duration: gap });

  ScrollTrigger.create({
    trigger: phone,
    start: 'top 75%',
    end: 'bottom 25%',
    onToggle: (self) => {
      if (self.isActive) timeline.play();
      else timeline.pause();
    },
  });

  if (conditions.desktop) {
    gsap.fromTo(
      phone,
      { rotateY: -3, rotateX: 2, y: 28 },
      {
        rotateY: 3,
        rotateX: -1.5,
        y: -28,
        ease: 'none',
        scrollTrigger: { trigger: root, start: 'top bottom', end: 'bottom top', scrub: true },
      },
    );
  }
}

/**
 * How it works: o ato em leitura define o visual ativo. Roda também com movimento
 * reduzido (é estado, não animação — a troca vira instantânea pelo CSS).
 */
function howItWorks({ ScrollTrigger, root, conditions }: EffectApi) {
  const layout = root.querySelector<HTMLElement>('[data-how-layout]');
  const acts = Array.from(root.querySelectorAll<HTMLElement>('[data-act]'));
  const visuals = Array.from(root.querySelectorAll<HTMLElement>('[data-visual]'));
  if (!layout || !acts.length) return;
  const toggle = (elements: HTMLElement[], active: number) =>
    elements.forEach((element, index) => {
      if (index === active) element.setAttribute('data-active', '');
      else element.removeAttribute('data-active');
    });

  acts.forEach((act, index) => {
    ScrollTrigger.create({
      trigger: act,
      start: conditions.desktop ? 'top 55%' : 'top 75%',
      end: conditions.desktop ? 'bottom 55%' : 'bottom 25%',
      onToggle: (self) => {
        if (!self.isActive) return;
        layout.dataset.activeAct = String(index);
        toggle(acts, index);
        toggle(visuals, index);
      },
    });
  });

  return () => {
    layout.dataset.activeAct = '0';
    toggle(acts, -1);
    toggle(visuals, -1);
  };
}

/**
 * IA + humano: as duas metades convergem para a costura central, o Pulse desce pela
 * costura e as letras de "Better together." se aproximam — o movimento é a mensagem.
 */
function intelligence({ gsap, root, conditions }: EffectApi) {
  if (!conditions.motion) return;
  const [sideA, sideB] = ['[data-side="a"] > *', '[data-side="b"] > *'].map((selector) =>
    root.querySelector(selector),
  );
  if (conditions.desktop && sideA && sideB) {
    const converge = { trigger: root, start: 'top 85%', end: 'top 25%', scrub: 0.8 };
    gsap.fromTo(sideA, { x: -48 }, { x: 0, ease: 'none', scrollTrigger: converge });
    gsap.fromTo(sideB, { x: 48 }, { x: 0, ease: 'none', scrollTrigger: converge });
  }

  const seam = root.querySelector('[data-seam]');
  const together = root.querySelector('[data-together]');
  if (seam && together) {
    const band = { trigger: together, start: 'top 95%', end: 'top 45%', scrub: 0.6 };
    gsap.fromTo(seam, { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: band });
    gsap.fromTo(
      together,
      { letterSpacing: '0.12em', opacity: 0.2 },
      { letterSpacing: '-0.02em', opacity: 1, ease: 'none', scrollTrigger: band },
    );
  }
}

/**
 * Timeline adaptativa: a linha Pulse avança com o scroll (horizontal no desktop,
 * vertical no mobile) e cada semana acende quando a linha a alcança. Sem pin.
 */
function adaptive({ gsap, root, conditions }: EffectApi) {
  if (!conditions.motion) return;
  const track = root.querySelector<HTMLElement>('[data-track-fill]')?.parentElement;
  const fill = root.querySelector('[data-track-fill]');
  const head = root.querySelector('[data-track-head]');
  const steps = gsap.utils.toArray<HTMLElement>('[data-step]', root);
  if (!track || !fill || !head || !steps.length) return;

  const horizontal = conditions.desktop;
  let thresholds: number[] = [];
  const measure = () => {
    const box = track.getBoundingClientRect();
    thresholds = steps.map((step) => {
      const node = step.firstElementChild?.getBoundingClientRect() ?? step.getBoundingClientRect();
      const offset = horizontal ? node.left - box.left : node.top - box.top;
      return Math.max(0, offset / Math.max(1, horizontal ? box.width : box.height));
    });
  };
  const update = (progress: number) =>
    steps.forEach((step, index) => {
      if (progress >= (thresholds[index] ?? 1) - 0.005) step.setAttribute('data-reached', '');
      else step.removeAttribute('data-reached');
    });

  root.setAttribute('data-motion-live', '');
  const timeline = gsap.timeline({
    scrollTrigger: {
      trigger: root,
      start: horizontal ? 'top 72%' : 'top 70%',
      end: horizontal ? 'bottom 40%' : 'bottom 55%',
      scrub: 0.6,
      onRefresh: measure,
      onUpdate: (self) => update(self.progress),
    },
  });
  timeline
    .fromTo(fill, horizontal ? { scaleX: 0 } : { scaleY: 0 }, {
      ...(horizontal ? { scaleX: 1 } : { scaleY: 1 }),
      ease: 'none',
    })
    .fromTo(
      head,
      horizontal ? { left: '0%' } : { top: '0%' },
      { ...(horizontal ? { left: '100%' } : { top: '100%' }), ease: 'none' },
      0,
    );
  measure();
  update(timeline.scrollTrigger?.progress ?? 0);

  return () => {
    root.removeAttribute('data-motion-live');
    steps.forEach((step) => step.removeAttribute('data-reached'));
  };
}

/**
 * Um dia com a MOVIVO: a hora avança levemente na direção da leitura enquanto o
 * momento atravessa a tela — o dia passando. Só desktop; no mobile, sequência simples.
 */
function day({ gsap, root, conditions }: EffectApi) {
  if (!conditions.motion || !conditions.desktop) return;
  for (const moment of gsap.utils.toArray<HTMLElement>('[data-moment]', root)) {
    const time = moment.querySelector('[data-time]');
    const media = moment.querySelector('[data-media]');
    const range = { trigger: moment, start: 'top bottom', end: 'bottom top', scrub: 0.8 };
    if (time) gsap.fromTo(time, { x: -36 }, { x: 36, ease: 'none', scrollTrigger: range });
    if (media) gsap.fromTo(media, { y: 40 }, { y: -40, ease: 'none', scrollTrigger: range });
  }
}

/**
 * Rodapé: a assinatura "movivo" em vidro surge quando entra na tela. A transição
 * (opacidade + escala) é do CSS, na curva orgânica; o efeito só marca o momento.
 */
function footer({ ScrollTrigger, root, conditions }: EffectApi) {
  if (!conditions.motion) return;
  const word = root.querySelector<HTMLElement>('[data-footer-glass]');
  if (!word) return;

  root.setAttribute('data-motion-live', '');
  ScrollTrigger.create({
    trigger: word,
    start: 'top 95%',
    once: true,
    onEnter: () => word.setAttribute('data-in', ''),
  });

  return () => {
    root.removeAttribute('data-motion-live');
    word.removeAttribute('data-in');
  };
}

export const SECTION_EFFECTS = {
  manifesto,
  whatsapp,
  howItWorks,
  intelligence,
  adaptive,
  day,
  footer,
} satisfies Record<string, Effect>;

export type SectionEffect = keyof typeof SECTION_EFFECTS;
