import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkoutShareCard } from './WorkoutShareCard';
import { fullBodyShareCardMock, workoutShareCardMock } from './workout-share-card.mocks';

describe('WorkoutShareCard', () => {
  it('expõe o card como imagem acessível com músculos e duração no rótulo', () => {
    render(<WorkoutShareCard data={workoutShareCardMock} />);
    const card = screen.getByRole('img', {
      name: /Treino concluído\. Peito, Tríceps, Ombros\. Tempo de Treino: 1h 30min\./,
    });
    expect(card).toBeVisible();
  });

  it('não desenha o cabelo feminino para o modelo masculino', () => {
    render(<WorkoutShareCard data={workoutShareCardMock} />);
    expect(document.querySelector('[data-female-hair]')).not.toBeInTheDocument();
  });

  it('desenha o cabelo feminino em frente e costas para o modelo feminino', () => {
    render(<WorkoutShareCard data={fullBodyShareCardMock} />);
    expect(document.querySelector('[data-female-hair="front"]')).toBeInTheDocument();
    expect(document.querySelector('[data-female-hair="back"]')).toBeInTheDocument();
  });

  it('encaminha a ref do cartão para o elemento raiz', () => {
    let node: HTMLDivElement | null = null;
    render(
      <WorkoutShareCard
        data={workoutShareCardMock}
        cardRef={(element) => {
          node = element;
        }}
      />,
    );
    expect(node).toHaveAttribute('data-workout-share-card');
  });
});
