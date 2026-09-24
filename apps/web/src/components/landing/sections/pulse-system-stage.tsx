'use client';

import { useCallback, useRef, type ReactNode } from 'react';

import { useGsap } from '../motion/use-gsap';
import { SceneCanvas } from '../scenes/scene-canvas';
import type { LandingScene } from '../scenes/webgl';

import styles from './pulse-system.module.css';

const loadPulseScene = () => import('../scenes/pulse-scene').then((mod) => mod.createPulseScene);

type PulseSystemStageProps = {
  copy: ReactNode;
  contexts: ReactNode;
  fallback: ReactNode;
};

/**
 * Liga o scroll à esfera: no desktop a seção é alta e o palco fica `sticky` (scroll
 * nativo, sem pin/hijack); no mobile o progresso acompanha o palco atravessando a tela.
 * O mesmo progresso acende a lista de conceitos (HTML real, fora do canvas).
 */
export function PulseSystemStage({ copy, contexts, fallback }: PulseSystemStageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<LandingScene | null>(null);
  const progressRef = useRef(0);

  const handleScene = useCallback((scene: LandingScene | null) => {
    sceneRef.current = scene;
    scene?.setProgress(progressRef.current);
  }, []);

  useGsap(rootRef, ({ ScrollTrigger, root, conditions }) => {
    const concepts = Array.from(root.querySelectorAll<HTMLElement>('[data-concept]'));

    function apply(progress: number) {
      progressRef.current = progress;
      sceneRef.current?.setProgress(progress);
      root.style.setProperty('--pulse-progress', progress.toFixed(3));
      const active = Math.min(concepts.length - 1, Math.floor(progress * concepts.length * 1.02));
      concepts.forEach((concept, index) => {
        concept.dataset.state = index < active ? 'past' : index === active ? 'active' : 'future';
      });
    }

    if (!conditions.motion) {
      apply(1);
      return;
    }

    const stage = stageRef.current;
    const range = conditions.desktop
      ? { trigger: root, start: 'top top', end: 'bottom bottom' }
      : { trigger: stage ?? root, start: 'top 85%', end: 'bottom 25%' };
    // O sistema completo (quatro núcleos) chega antes do fim do trecho e fica em tela.
    const hold = conditions.desktop ? 0.85 : 0.9;
    const trigger = ScrollTrigger.create({
      ...range,
      onUpdate: (self) => apply(Math.min(1, self.progress / hold)),
    });
    apply(Math.min(1, trigger.progress / hold));

    return () => {
      root.style.removeProperty('--pulse-progress');
      concepts.forEach((concept) => delete concept.dataset.state);
    };
  });

  return (
    <div ref={rootRef} className={styles.scroller}>
      <div className={styles.pin}>
        <div className={styles.layout}>
          <div className={styles.copy}>{copy}</div>
          <div ref={stageRef} className={styles.stage}>
            <SceneCanvas
              load={loadPulseScene}
              onScene={handleScene}
              fallback={fallback}
              className={styles.canvas}
            />
            {contexts}
          </div>
        </div>
      </div>
    </div>
  );
}
