'use client';

import type { WorkoutShareCardData } from '@movivo/shared';
import { Copy, Download, ImageDown, Share2 } from 'lucide-react';
import Image from 'next/image';

import { WorkoutShareCard } from './WorkoutShareCard';
import { useWorkoutShareCard } from './useWorkoutShareCard';
import styles from './workout-share-card.module.css';

export function WorkoutShareCardPanel({ data }: { data: WorkoutShareCardData }) {
  const card = useWorkoutShareCard(data);
  const buttons = [
    { action: 'share', label: 'Compartilhar imagem', icon: Share2 },
    { action: 'download', label: 'Baixar imagem', icon: Download },
    { action: 'copy', label: 'Copiar imagem', icon: Copy },
    { action: 'save', label: 'Salvar na galeria', icon: ImageDown },
  ] as const;
  return (
    <div className="mt-7 border-t border-border pt-6" aria-label="Card do treino">
      <h3 className="text-h3 font-bold">Sua conquista merece um Story</h3>
      <p className="mt-2 mb-5 text-label text-muted-foreground">
        Compartilhe seu movimento com a MOVIVO.
      </p>
      <div className={styles.renderSurface} aria-hidden="true" inert>
        <WorkoutShareCard data={data} cardRef={card.cardRef} />
      </div>
      {card.loading ? (
        <p role="status" className="py-8 text-muted-foreground">
          Preparando sua imagem…
        </p>
      ) : null}
      {card.generationError ? (
        <div role="alert">
          <p>{card.generationError}</p>
          <button
            type="button"
            onClick={card.retry}
            className="my-4 min-h-12 rounded-xl border border-border px-5 font-bold"
          >
            Gerar novamente
          </button>
        </div>
      ) : null}
      {card.imageUrl ? (
        <Image
          src={card.imageUrl}
          alt={`Card do treino: ${data.workout.trainedMuscles.join(', ')}.`}
          width={1080}
          height={1920}
          unoptimized
          className={styles.preview}
        />
      ) : null}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {buttons.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            type="button"
            disabled={!card.imageUrl || card.acting}
            onClick={() => void card.act(action)}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${action === 'share' ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-foreground'}`}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <p role="status" className="mt-3 text-label text-muted-foreground">
        {card.message}
      </p>
      <p className="mt-3 text-label text-muted-foreground">
        No celular, escolha Instagram ou “Salvar imagem” no menu, quando disponível. Você também
        pode baixar e abrir o PNG na galeria para adicionar ao Story.
      </p>
    </div>
  );
}
