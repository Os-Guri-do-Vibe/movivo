import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./useWorkoutShareCard', () => ({ useWorkoutShareCard: vi.fn() }));
import { WorkoutShareCardPanel } from './WorkoutShareCardPanel';
import { useWorkoutShareCard } from './useWorkoutShareCard';
import { workoutShareCardMock } from './workout-share-card.mocks';

const baseCard = {
  cardRef: { current: null },
  imageUrl: undefined as string | undefined,
  generationError: '',
  message: '',
  loading: false,
  acting: false,
  act: vi.fn(),
  retry: vi.fn(),
};

beforeEach(() => {
  vi.mocked(useWorkoutShareCard).mockReset();
  baseCard.act = vi.fn();
  baseCard.retry = vi.fn();
});

describe('WorkoutShareCardPanel', () => {
  it('mostra estado de carregamento enquanto a imagem não existe', () => {
    vi.mocked(useWorkoutShareCard).mockReturnValue({ ...baseCard, loading: true });
    render(<WorkoutShareCardPanel data={workoutShareCardMock} />);
    expect(screen.getByText('Preparando sua imagem…')).toBeVisible();
  });

  it('mostra erro com ação de tentar novamente', async () => {
    const user = userEvent.setup();
    vi.mocked(useWorkoutShareCard).mockReturnValue({
      ...baseCard,
      generationError: 'Seu treino está salvo. Não foi possível gerar o card.',
    });
    render(<WorkoutShareCardPanel data={workoutShareCardMock} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível gerar o card.');
    await user.click(screen.getByRole('button', { name: 'Gerar novamente' }));
    expect(baseCard.retry).toHaveBeenCalledOnce();
  });

  it('exibe a prévia e habilita as ações quando a imagem está pronta', async () => {
    const user = userEvent.setup();
    vi.mocked(useWorkoutShareCard).mockReturnValue({
      ...baseCard,
      imageUrl: 'blob:card',
      message: 'Download iniciado.',
    });
    render(<WorkoutShareCardPanel data={workoutShareCardMock} />);
    const shareButton = screen.getByRole('button', { name: 'Compartilhar imagem' });
    expect(shareButton).toBeEnabled();
    await user.click(shareButton);
    expect(baseCard.act).toHaveBeenCalledWith('share');
    expect(screen.getByRole('status')).toHaveTextContent('Download iniciado.');
  });

  it('desabilita as ações sem imagem pronta ou durante uma ação em andamento', () => {
    vi.mocked(useWorkoutShareCard).mockReturnValue({
      ...baseCard,
      imageUrl: 'blob:card',
      acting: true,
    });
    render(<WorkoutShareCardPanel data={workoutShareCardMock} />);
    expect(screen.getByRole('button', { name: 'Compartilhar imagem' })).toBeDisabled();
  });
});
