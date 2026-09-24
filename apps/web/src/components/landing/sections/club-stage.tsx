'use client';

import { useCallback, useRef, type ReactNode } from 'react';

import { useGsap } from '../motion/use-gsap';
import { SceneCanvas } from '../scenes/scene-canvas';
import type { LandingScene } from '../scenes/webgl';

import styles from './movivo-club.module.css';

const loadClubScene = () => import('../scenes/club-scene').then((mod) => mod.createClubScene);

/** Liga a passagem da seção pela tela ao nascimento e agrupamento da constelação. */
export function ClubStage({ fallback }: { fallback: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<LandingScene | null>(null);
  const progressRef = useRef(0);

  const handleScene = useCallback((scene: LandingScene | null) => {
    sceneRef.current = scene;
    scene?.setProgress(progressRef.current);
  }, []);

  useGsap(rootRef, ({ ScrollTrigger, root, conditions }) => {
    if (!conditions.motion) return;
    const section = root.closest('section') ?? root;
    const trigger = ScrollTrigger.create({
      trigger: section,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (self) => {
        progressRef.current = self.progress;
        sceneRef.current?.setProgress(self.progress);
      },
    });
    progressRef.current = trigger.progress;
    sceneRef.current?.setProgress(trigger.progress);
  });

  return (
    <div ref={rootRef} className={styles.stage}>
      <SceneCanvas load={loadClubScene} onScene={handleScene} fallback={fallback} />
    </div>
  );
}
