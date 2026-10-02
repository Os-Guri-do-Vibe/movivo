'use client';

import type { WorkoutShareCardData } from '@movivo/shared';
import { useEffect, useRef, useState } from 'react';

import { fetchWorkoutShareCard, shareCardVersion } from './fetchWorkoutShareCard';

type CardAction = 'download' | 'copy' | 'share' | 'save';

export function useWorkoutShareCard(sessionId: string, data: WorkoutShareCardData) {
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [generationError, setGenerationError] = useState('');
  const [message, setMessage] = useState('');
  const [acting, setActing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const actionLock = useRef(false);

  const version = shareCardVersion(data);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setImage(null);
    setGenerationError('');
    setMessage('');
    void fetchWorkoutShareCard(sessionId, controller.signal, version)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setGenerationError('Seu treino está salvo. Não foi possível carregar o card.');
        }
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
    // `version` muda só se o conteúdo do card mudar; nova identidade do objeto não rebaixa.
  }, [sessionId, version, attempt]);

  async function act(action: CardAction) {
    if (!image || actionLock.current) return;
    actionLock.current = true;
    setActing(true);
    setMessage('');
    const file = new File(
      [image.blob],
      `movivo-treino-${data.workout.completedAt.slice(0, 10)}.png`,
      {
        type: 'image/png',
      },
    );
    const download = () => {
      const link = document.createElement('a');
      link.href = image.url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };
    try {
      // PNG pronto ANTES do toque: Safari exige ativação transitória para share/clipboard.
      if (
        action === 'copy' &&
        typeof ClipboardItem !== 'undefined' &&
        navigator.clipboard?.write &&
        (!ClipboardItem.supports || ClipboardItem.supports('image/png'))
      ) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
        setMessage('Imagem copiada.');
      } else if (
        (action === 'share' || action === 'save') &&
        navigator.share &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({ files: [file] });
        setMessage('Imagem entregue ao menu de compartilhamento.');
      } else {
        download();
        setMessage(
          action === 'download'
            ? 'Download iniciado.'
            : 'Imagem baixada. Abra o arquivo para salvar na galeria ou adicionar ao Story.',
        );
      }
    } catch (error) {
      // Cancelar o menu nativo é uma escolha: nunca dispara download inesperado.
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        download();
        setMessage('Este navegador não permitiu a ação. O download da imagem foi iniciado.');
      }
    } finally {
      actionLock.current = false;
      setActing(false);
    }
  }

  return {
    imageUrl: image?.url,
    generationError,
    message,
    loading: !image && !generationError,
    acting,
    act,
    retry: () => setAttempt((value) => value + 1),
  };
}
