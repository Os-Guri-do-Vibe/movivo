'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  hasHeroVideo,
  heroVideoSources,
  type HeroMediaAssets,
  type VideoSource,
} from '@/lib/landing/assets';

import { MOTION_QUERIES } from '../motion/gsap';
import { useGsap } from '../motion/use-gsap';

import styles from './hero-media.module.css';

const MOBILE_QUERY = '(max-width: 767.98px)';

/** Hero Film Drift: escala máxima ao sair do Hero (quase imperceptível). */
const DRIFT_SCALE = 1.025;
/** Aceleração máxima do filme ao sair do Hero (desktop). Em degraus, nunca contínua. */
const MAX_PLAYBACK_RATE = 1.08;
const PLAYBACK_STEP = 0.02;

type NetworkInformation = { saveData?: boolean; effectiveType?: string };

/** Economia de dados ou rede muito lenta: o pôster basta — o filme é decorativo. */
function prefersLightMedia(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(
    connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType ?? ''),
  );
}

/**
 * Camada de filme do Hero. O pôster (quadro 0) é renderizado no servidor por baixo
 * desta camada; o vídeo só é montado depois da hidratação e só aparece quando está de
 * fato tocando — antes disso, se o autoplay falhar ou sem fonte compatível, o pôster
 * continua sendo a imagem do Hero.
 *
 *  - `muted` + `playsInline` + `loop`, sem controles, fora da árvore de acessibilidade;
 *  - movimento reduzido ou economia de dados → nenhum vídeo (fica o pôster);
 *  - fora da viewport o filme pausa;
 *  - desktop com movimento: Hero Film Drift (1 → 1,025) e playbackRate de 1 → 1,08 em
 *    degraus enquanto o usuário sai do Hero. Nunca scrub de `currentTime`.
 */
export function HeroMedia({ assets }: { assets: HeroMediaAssets }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sources, setSources] = useState<VideoSource[] | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!hasHeroVideo(assets)) return;
    if (!window.matchMedia(MOTION_QUERIES.motion).matches || prefersLightMedia()) return;
    setSources(heroVideoSources(assets, window.matchMedia(MOBILE_QUERY).matches));
  }, [assets]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sources) return;
    // Garante a propriedade (não só o atributo): condição do autoplay no Safari iOS.
    video.muted = true;
    const play = () => void video.play().catch(() => undefined);
    if (typeof IntersectionObserver !== 'function') {
      play();
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) play();
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [sources]);

  useGsap(layerRef, ({ gsap, ScrollTrigger, root, conditions }) => {
    if (!conditions.motion || !conditions.desktop) return;
    const section = root.closest('section') ?? root;
    const film = root.closest<HTMLElement>('[data-hero-film]') ?? root;
    const range = { trigger: section, start: 'top top', end: 'bottom top' };

    gsap.fromTo(
      film,
      { scale: 1 },
      { scale: DRIFT_SCALE, ease: 'none', scrollTrigger: { ...range, scrub: 0.6 } },
    );

    let rate = 1;
    // Guarda o elemento que recebeu a velocidade: no unmount o ref já foi desanexado.
    let tuned: HTMLVideoElement | null = null;
    ScrollTrigger.create({
      ...range,
      onUpdate: (self) => {
        const next =
          Math.round((1 + (MAX_PLAYBACK_RATE - 1) * self.progress) / PLAYBACK_STEP) * PLAYBACK_STEP;
        if (Math.abs(next - rate) < 0.001) return;
        rate = next;
        tuned = videoRef.current;
        if (tuned) tuned.playbackRate = rate;
      },
    });

    return () => {
      if (tuned) tuned.playbackRate = 1;
    };
  });

  return (
    <div ref={layerRef} className={cn(styles.layer, playing && styles.playing)}>
      {sources ? (
        <video
          ref={videoRef}
          className={styles.video}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
        >
          {sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} />
          ))}
        </video>
      ) : null}
    </div>
  );
}
