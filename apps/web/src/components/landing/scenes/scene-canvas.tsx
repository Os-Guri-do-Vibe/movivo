'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { MOTION_QUERIES } from '../motion/gsap';

import styles from './scene-canvas.module.css';
import { isWebGLAvailable, scenePixelRatio, type LandingScene, type SceneFactory } from './webgl';

const MOBILE_QUERY = MOTION_QUERIES.mobile;

type SceneCanvasProps = {
  /** Import dinâmico do módulo da cena — o Three.js só baixa quando a seção se aproxima. */
  load: () => Promise<SceneFactory>;
  /** Composição estática (SVG/CSS): primeira pintura, sem WebGL e movimento reduzido. */
  fallback: ReactNode;
  /** Recebe a cena pronta (ou `null` ao descartar) para ligar o progresso do scroll. */
  onScene?: (scene: LandingScene | null) => void;
  className?: string;
  label?: string;
};

/**
 * Ciclo de vida de uma cena WebGL da landing:
 *  - só monta perto da viewport, e nunca com `prefers-reduced-motion` (fica o fallback);
 *  - render loop pausado fora da viewport;
 *  - no mobile, o contexto WebGL é descartado quando a seção fica longe — nunca há dois
 *    canvases pesados vivos ao mesmo tempo no celular;
 *  - perda de contexto ou erro de shader → volta ao fallback, sem quebrar a página.
 */
export function SceneCanvas({ load, fallback, onScene, className, label }: SceneCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef(load);
  const onSceneRef = useRef(onScene);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadRef.current = load;
    onSceneRef.current = onScene;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver !== 'function') return;
    if (!window.matchMedia(MOTION_QUERIES.motion).matches || !isWebGLAvailable()) return;

    const mobile = window.matchMedia(MOBILE_QUERY).matches;
    const finePointer = window.matchMedia(MOTION_QUERIES.finePointer).matches;
    let scene: LandingScene | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let creating = false;
    let visible = false;
    let disposed = false;

    function teardown() {
      scene?.dispose();
      scene = null;
      canvas?.remove();
      canvas = null;
      onSceneRef.current?.(null);
      setReady(false);
    }

    async function create() {
      if (scene || creating || disposed || !host) return;
      creating = true;
      try {
        const factory = await loadRef.current();
        if (disposed || !host) return;
        canvas = document.createElement('canvas');
        canvas.className = styles.canvas ?? '';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.addEventListener('webglcontextlost', (event) => {
          event.preventDefault();
          teardown();
        });
        host.appendChild(canvas);
        const rect = host.getBoundingClientRect();
        scene = factory(canvas, {
          mobile,
          width: rect.width,
          height: rect.height,
          pixelRatio: scenePixelRatio(mobile),
        });
        scene.setActive(visible);
        onSceneRef.current?.(scene);
        setReady(true);
      } catch {
        teardown();
      } finally {
        creating = false;
      }
    }

    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void create();
        else if (mobile) teardown();
      },
      { rootMargin: mobile ? '100% 0px' : '120% 0px' },
    );
    const inView = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      scene?.setActive(visible);
    });
    const resize =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(([entry]) => {
            if (!entry || !scene) return;
            scene.resize(
              entry.contentRect.width,
              entry.contentRect.height,
              scenePixelRatio(mobile),
            );
          })
        : null;

    function onPointer(event: PointerEvent) {
      if (!scene || !host) return;
      const rect = host.getBoundingClientRect();
      scene.setPointer(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
    }

    near.observe(host);
    inView.observe(host);
    resize?.observe(host);
    if (finePointer) window.addEventListener('pointermove', onPointer, { passive: true });

    return () => {
      disposed = true;
      near.disconnect();
      inView.disconnect();
      resize?.disconnect();
      window.removeEventListener('pointermove', onPointer);
      teardown();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={cn(styles.host, ready && styles.ready, className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-scene-state={ready ? 'webgl' : 'fallback'}
    >
      <div className={styles.fallback}>{fallback}</div>
    </div>
  );
}
