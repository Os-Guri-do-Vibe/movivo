'use client';

import { ChevronLeft, ChevronRight, Copy, Download, ImageDown, Share2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

import { SHARE_CARD_LAYOUT_LABELS, type ShareCardLayout } from '@movivo/shared';

import type { ShareCardOptions } from '@/lib/training-api';

import { StudentAlert } from '../student-nav';
import { useTrainingApi } from '../training-api-context';
import styles from './share-card.module.css';

type CardAction = 'share' | 'download' | 'copy' | 'save';

const ACTIONS: ReadonlyArray<{ action: CardAction; label: string; icon: typeof Share2 }> = [
  { action: 'share', label: 'Compartilhar imagem', icon: Share2 },
  { action: 'download', label: 'Baixar imagem', icon: Download },
  { action: 'copy', label: 'Copiar imagem', icon: Copy },
  { action: 'save', label: 'Salvar na galeria', icon: ImageDown },
];

type Loaded = { blob: Blob; url: string };

/** Distância mínima do deslize (px) para trocar de modelo no celular. */
const SWIPE = 40;

/**
 * Cartão do treino para o Story, em carrossel (como no Strava): as setas ‹ › trocam o modelo, que
 * começa no clássico e segue com os da modalidade. Todo PNG sai com fundo transparente, para colar
 * sobre a foto. A imagem é desenhada no servidor; aqui só chegam os bytes.
 */
export function ShareCardPanel({ executionId }: { executionId: string }) {
  const api = useTrainingApi();
  const [options, setOptions] = useState<ShareCardOptions | null>(null);
  const [index, setIndex] = useState(0);
  const [images, setImages] = useState<Partial<Record<ShareCardLayout, Loaded>>>({});
  const [failed, setFailed] = useState<Partial<Record<ShareCardLayout, boolean>>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [acting, setActing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reload, setReload] = useState(0);
  const actionLock = useRef(false);
  const requested = useRef(new Set<ShareCardLayout>());
  const urls = useRef<string[]>([]);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    setOptions(null);
    setError('');
    api
      .getShareCard(executionId)
      .then((loaded) => {
        if (!active) return;
        setOptions(loaded);
        setIndex(0);
      })
      .catch(() => active && setError('Seu treino está salvo. Não foi possível montar o cartão.'));
    return () => {
      active = false;
    };
  }, [api, executionId, attempt]);

  // Libera as imagens ao sair da tela.
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const layouts = useMemo(() => options?.layouts ?? [], [options]);
  const layout = layouts[index];

  // Carrega o modelo da vez e já adianta os vizinhos, para a seta trocar sem espera.
  useEffect(() => {
    if (!options || layouts.length === 0) return;
    const wanted = [index, index + 1, index - 1]
      .map((i) => layouts[(i + layouts.length) % layouts.length])
      .filter((item): item is ShareCardLayout => item !== undefined);
    for (const item of wanted) {
      if (requested.current.has(item)) continue;
      requested.current.add(item);
      api
        .getShareCardImage(executionId, item)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          setImages((current) => ({ ...current, [item]: { blob, url } }));
        })
        .catch(() => {
          requested.current.delete(item);
          setFailed((current) => ({ ...current, [item]: true }));
        });
    }
  }, [api, executionId, options, layouts, index, reload]);

  function go(step: number) {
    if (layouts.length === 0) return;
    setMessage('');
    setIndex((current) => (current + step + layouts.length) % layouts.length);
  }

  function retry() {
    if (!options) {
      setAttempt((value) => value + 1);
      return;
    }
    if (layout) {
      requested.current.delete(layout);
      setFailed((current) => ({ ...current, [layout]: false }));
    }
    setReload((value) => value + 1);
  }

  const image = layout ? images[layout] : undefined;
  const imageError = layout ? failed[layout] : false;

  async function act(action: CardAction) {
    if (!image || !layout || actionLock.current) return;
    actionLock.current = true;
    setActing(true);
    setMessage('');
    const file = new File([image.blob], `movivo-treino-${layout.toLowerCase()}.png`, {
      type: 'image/png',
    });
    const download = () => {
      const link = document.createElement('a');
      link.href = image.url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };
    try {
      // PNG pronto ANTES do toque: o Safari exige ativação recente para compartilhar e copiar.
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
    } catch (caught) {
      // Cancelar o menu do sistema é uma escolha: nunca dispara um download inesperado.
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        download();
        setMessage('Este navegador não permitiu a ação. O download da imagem foi iniciado.');
      }
    } finally {
      actionLock.current = false;
      setActing(false);
    }
  }

  const name = layout ? SHARE_CARD_LAYOUT_LABELS[layout] : '';
  // Setas fora da imagem, dos dois lados: a prévia nunca fica coberta.
  const arrow =
    'grid size-10 shrink-0 place-items-center rounded-full border border-verde-pulso bg-card text-petroleo shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-verde-pulso disabled:opacity-40';
  return (
    <section
      aria-label="Cartão do treino"
      aria-roledescription="carrossel"
      className="mt-7 border-t border-border pt-6 text-left"
    >
      <h3 className="text-h3 font-bold text-foreground">Sua conquista merece um Story</h3>
      <p className="mt-2 mb-5 text-label text-muted-foreground">
        Compartilhe seu movimento com a MOVIVO. Use as setas para escolher o modelo.
      </p>

      {error ? (
        <div className="flex flex-col gap-3">
          <StudentAlert>{error}</StudentAlert>
          <button
            type="button"
            onClick={retry}
            className="min-h-12 rounded-xl border border-verde-pulso bg-card px-4 font-bold text-petroleo"
          >
            Gerar novamente
          </button>
        </div>
      ) : null}

      {options && layout ? (
        <>
          <div
            className="mx-auto flex w-full max-w-[360px] items-center justify-center gap-2"
            onTouchStart={(event) => {
              touchX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const start = touchX.current;
              const end = event.changedTouches[0]?.clientX;
              touchX.current = null;
              if (start === null || end === undefined || Math.abs(end - start) < SWIPE) return;
              go(end < start ? 1 : -1);
            }}
          >
            {layouts.length > 1 ? (
              <button
                type="button"
                aria-label="Modelo anterior"
                onClick={() => go(-1)}
                className={arrow}
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            ) : null}
            <div
              role="group"
              aria-roledescription="slide"
              aria-label={`${name}, ${index + 1} de ${layouts.length}`}
              className={`${styles.preview} grid aspect-[9/16] min-w-0 max-w-[260px] flex-1 place-items-center overflow-hidden`}
            >
              {image ? (
                <Image
                  src={image.url}
                  alt={`Cartão do treino, modelo ${name}, com fundo transparente.`}
                  width={1080}
                  height={1920}
                  unoptimized
                  className="h-full w-full object-contain"
                />
              ) : imageError ? (
                <div role="alert" className="flex flex-col items-center gap-3 px-6 text-center">
                  <p className="text-label text-white/85">
                    Seu treino está salvo. Não foi possível carregar esta imagem.
                  </p>
                  <button
                    type="button"
                    onClick={retry}
                    className="min-h-11 rounded-xl bg-white px-4 text-label font-bold text-petroleo"
                  >
                    Gerar novamente
                  </button>
                </div>
              ) : (
                <p role="status" className="px-4 text-center text-label text-white/80">
                  Preparando sua imagem…
                </p>
              )}
            </div>
            {layouts.length > 1 ? (
              <button
                type="button"
                aria-label="Próximo modelo"
                onClick={() => go(1)}
                className={arrow}
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-col items-center gap-2">
            <p aria-live="polite" className="text-label font-bold text-foreground">
              {name}{' '}
              <span className="font-normal text-muted-foreground">
                · {index + 1} de {layouts.length}
              </span>
            </p>
            {layouts.length > 1 ? (
              <div className="flex gap-1.5">
                {layouts.map((item, at) => (
                  <button
                    key={item}
                    type="button"
                    aria-label={`Modelo ${SHARE_CARD_LAYOUT_LABELS[item]}`}
                    aria-current={at === index ? 'true' : undefined}
                    onClick={() => setIndex(at)}
                    className="grid size-6 place-items-center"
                  >
                    <span
                      aria-hidden="true"
                      className={`block rounded-full transition-all ${at === index ? 'h-2 w-5 bg-petroleo' : 'size-2 bg-muted-foreground/40'}`}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : !error ? (
        <p role="status" className="py-8 text-center text-muted-foreground">
          Preparando sua imagem…
        </p>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ACTIONS.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            type="button"
            disabled={!image || acting}
            onClick={() => void act(action)}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${action === 'share' ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-foreground'}`}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p role="status" className="mt-3 text-label text-muted-foreground">
        {message}
      </p>
      <p className="mt-3 text-label text-muted-foreground">
        A imagem sai com fundo transparente: no Story, coloque por cima da sua foto. No celular,
        escolha Instagram ou “Salvar imagem” no menu, quando disponível.
      </p>
    </section>
  );
}
