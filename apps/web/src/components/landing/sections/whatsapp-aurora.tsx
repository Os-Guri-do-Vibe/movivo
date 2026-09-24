'use client';

import { SceneCanvas } from '../scenes/scene-canvas';

import styles from './whatsapp-experience.module.css';

const loadAurora = () => import('../scenes/aurora-scene').then((mod) => mod.createAuroraScene);

/**
 * Fundo Aurora da seção do WhatsApp. Antes do WebGL (e com movimento reduzido ou sem
 * WebGL) fica um brilho estático no mesmo lugar, para a troca não pular.
 */
export function WhatsAppAurora() {
  return (
    <div className={styles.aurora} aria-hidden="true">
      <SceneCanvas load={loadAurora} fallback={<div className={styles.auroraFallback} />} />
    </div>
  );
}
