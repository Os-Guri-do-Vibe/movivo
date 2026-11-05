import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PoseGuide, poseGuideImage } from './pose-guide';

describe('PoseGuide', () => {
  it('mostra o manequim do sexo e do ângulo da foto', () => {
    const { container, rerender } = render(<PoseGuide angle="RIGHT" sex="male" />);
    expect(screen.getByRole('img', { name: 'Posição da foto: lado direito' })).toBeInTheDocument();
    expect(container.querySelector('[data-pose="male-RIGHT"]')).toHaveStyle({
      backgroundImage: 'url(/assets/pose-guide/male-right.webp)',
    });

    rerender(<PoseGuide angle="LEFT" sex="female" />);
    expect(screen.getByRole('img', { name: 'Posição da foto: lado esquerdo' })).toBeInTheDocument();
    expect(container.querySelector('[data-pose="female-LEFT"]')).toHaveStyle({
      backgroundImage: 'url(/assets/pose-guide/female-left.webp)',
    });
  });

  it('cada sexo tem uma imagem por ângulo publicada em public/', () => {
    const angles = ['FRONT', 'RIGHT', 'BACK', 'LEFT'] as const;
    for (const sex of ['male', 'female'] as const) {
      for (const angle of angles) {
        expect(existsSync(join(process.cwd(), 'public', poseGuideImage(sex, angle)))).toBe(true);
      }
    }
  });
});
