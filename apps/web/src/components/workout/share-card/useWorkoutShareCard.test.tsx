import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./generateWorkoutShareCard', () => ({ generateWorkoutShareCard: vi.fn() }));
import { generateWorkoutShareCard } from './generateWorkoutShareCard';
import { useWorkoutShareCard } from './useWorkoutShareCard';
import { workoutShareCardMock } from './workout-share-card.mocks';

function Harness() {
  const card = useWorkoutShareCard(workoutShareCardMock);
  return (
    <>
      <div ref={card.cardRef} />
      <p>{card.generationError || card.message}</p>
      {(['download', 'copy', 'share', 'save'] as const).map((action) => (
        <button
          key={action}
          disabled={!card.imageUrl || card.acting}
          onClick={() => void card.act(action)}
        >
          {action}
        </button>
      ))}
      <button onClick={card.retry}>retry</button>
    </>
  );
}

const blob = new Blob(['png'], { type: 'image/png' });
let download: ReturnType<typeof vi.spyOn>;
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => {
  user = userEvent.setup();
  vi.mocked(generateWorkoutShareCard).mockReset().mockResolvedValue(blob);
  vi.stubGlobal('ClipboardItem', undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:card');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useWorkoutShareCard', () => {
  it('gera automaticamente, baixa e libera a URL ao desmontar', async () => {
    const view = render(<Harness />);
    await waitFor(() => expect(screen.getByText('download')).toBeEnabled());
    await user.click(screen.getByText('download'));
    expect(generateWorkoutShareCard).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:card');
  });
  it('envia arquivo PNG ao menu nativo já preparado no momento do toque', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('share')).toBeEnabled());
    await user.click(screen.getByText('share'));
    const file = share.mock.calls[0]?.[0]?.files[0] as File;
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('movivo-treino-2026-09-17.png');
    expect(download).not.toHaveBeenCalled();
    await user.click(screen.getByText('save'));
    expect(share).toHaveBeenCalledTimes(2);
  });
  it('copia PNG e usa download se a permissão de clipboard for negada', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'ClipboardItem',
      class {
        static supports() {
          return true;
        }
      },
    );
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('copy')).toBeEnabled());
    await user.click(screen.getByText('copy'));
    expect(write).toHaveBeenCalledOnce();
    expect(await screen.findByText('Imagem copiada.')).toBeVisible();
    write.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await user.click(screen.getByText('copy'));
    expect(download).toHaveBeenCalledOnce();
  });
  it('aplica fallback para share, galeria e clipboard indisponíveis', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('share')).toBeEnabled());
    for (const action of ['copy', 'share', 'save']) await user.click(screen.getByText(action));
    expect(download).toHaveBeenCalledTimes(3);
  });
  it('cancelamento nativo não dispara download', async () => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
    });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('share')).toBeEnabled());
    await user.click(screen.getByText('share'));
    expect(download).not.toHaveBeenCalled();
  });
  it('recupera falha de geração sem reenviar a conclusão do treino', async () => {
    vi.mocked(generateWorkoutShareCard).mockRejectedValueOnce(new Error('asset failed'));
    render(<Harness />);
    expect(await screen.findByText(/Seu treino está salvo/)).toBeVisible();
    await user.click(screen.getByText('retry'));
    await waitFor(() => expect(screen.getByText('download')).toBeEnabled());
    expect(generateWorkoutShareCard).toHaveBeenCalledTimes(2);
  });
  it('descarta exportação que termine depois da desmontagem', async () => {
    let resolve: (blob: Blob) => void = () => {};
    vi.mocked(generateWorkoutShareCard).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(<Harness />);
    view.unmount();
    await act(async () => resolve(blob));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
