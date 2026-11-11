'use client';

import { cn } from '@/lib/utils';

import styles from './pose-guide.module.css';

export type PoseAngle = 'FRONT' | 'RIGHT' | 'BACK' | 'LEFT';
export type PoseGuideSex = 'male' | 'female';

export const POSE_LABELS: Readonly<Record<PoseAngle, string>> = {
  FRONT: 'Frontal',
  RIGHT: 'Lado direito',
  BACK: 'Costas',
  LEFT: 'Lado esquerdo',
};

/**
 * Manequim 3D renderizado a partir do MakeHuman (CC0), o mesmo modelo nos quatro ângulos e já
 * com a roupa das orientações (bermuda; top e shorts). Na foto do lado direito a pessoa olha
 * para a direita da imagem; na do lado esquerdo, para a esquerda.
 */
export function poseGuideImage(sex: PoseGuideSex, angle: PoseAngle): string {
  return `/assets/pose-guide/${sex}-${angle.toLowerCase()}.webp`;
}

/**
 * Guia da posição da foto. Uma linha de leitura percorre o corpo para mostrar o enquadramento:
 * da cabeça aos pés.
 */
export function PoseGuide({
  angle,
  sex,
  className,
}: {
  angle: PoseAngle;
  sex: PoseGuideSex;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`Posição da foto: ${POSE_LABELS[angle].toLowerCase()}`}
      className={cn(
        'relative h-full w-full overflow-hidden rounded-xl border border-border bg-nevoa',
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-pose={`${sex}-${angle}`}
        className="absolute inset-x-1 inset-y-2 bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${poseGuideImage(sex, angle)})` }}
      />
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-2 h-0.5 rounded-full bg-primary shadow-[0_0_8px_rgba(37,226,126,0.8)]',
          styles.scan,
        )}
      />
    </div>
  );
}
