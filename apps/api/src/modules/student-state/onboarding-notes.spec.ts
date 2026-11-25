import { describe, expect, it } from 'vitest';

import { tokensOf } from '../planning/calc/menu';
import { healthNotes, repairedNotes } from './onboarding-projection';

const answers = (over: {
  motivation?: string;
  trainingPreferences?: string;
  dislikedExercises?: string;
  supplementOther?: string;
  likedFoods?: string;
  dislikedFoods?: string;
}) =>
  ({
    goals: { motivation: over.motivation },
    preferences: {
      trainingPreferences: over.trainingPreferences,
      dislikedExercises: over.dislikedExercises,
    },
    nutrition: {
      supplementOther: over.supplementOther,
      likedFoods: over.likedFoods,
      dislikedFoods: over.dislikedFoods,
    },
  }) as never;

/** Como a projeção gravava antes: tudo junto, cortado em 500 caracteres. */
const legacyNote = (notes: string[]) => notes.join(' | ').slice(0, 500);

describe('notas de texto livre da anamnese', () => {
  const long = (label: string) => `${label} `.repeat(40).trim().slice(0, 290);
  const full = answers({
    motivation: long('quero ter mais disposição'),
    trainingPreferences: long('prefiro treinar cedo'),
    dislikedExercises: 'burpee',
    likedFoods: 'frango, arroz e banana',
    dislikedFoods: 'Não gosto de mamão',
  });

  it('cada assunto vira a sua própria nota, inteira', () => {
    const notes = healthNotes(full);
    expect(notes.map((note) => note.slice(0, note.indexOf(':')))).toEqual([
      'Motivação',
      'Preferências de treino',
      'Prefere evitar',
      'Alimentos que gosta',
      'Alimentos que evita',
    ]);
    expect(notes.at(-1)).toBe('Alimentos que evita: Não gosto de mamão');
    expect(notes.every((note) => note.length <= 500)).toBe(true);
  });

  it('respostas longas nos outros campos não apagam mais o que o aluno evita', () => {
    const notes = healthNotes(full);
    // O formato antigo cortava em 500 e a aversão, que vinha por último, sumia.
    expect(legacyNote(notes)).not.toMatch(/Alimentos que evita/);
    const evita = notes.find((note) => note.startsWith('Alimentos que evita:'));
    expect(tokensOf(/alimentos que evita:\s*([^|]+)/i.exec(evita ?? '')?.[1])).toEqual(['mamao']);
  });

  it('campo vazio não vira nota', () => {
    expect(healthNotes(answers({ dislikedFoods: '   ' }))).toEqual([]);
    expect(healthNotes(answers({ likedFoods: 'ovos' }))).toEqual(['Alimentos que gosta: ovos']);
  });
});

describe('conserto das notas já gravadas', () => {
  const fromAnswers = [
    `Motivação: ${'a'.repeat(280)}`,
    `Preferências de treino: ${'b'.repeat(280)}`,
    'Alimentos que evita: mamão',
  ];

  it('nota antiga cortada é trocada pelas notas completas', () => {
    const existing = [legacyNote(fromAnswers)];
    expect(existing[0]).not.toMatch(/mamão/);
    expect(repairedNotes(existing, fromAnswers)).toEqual(fromAnswers);
  });

  it('quem já está certo não é tocado', () => {
    expect(repairedNotes(fromAnswers, fromAnswers)).toBeNull();
    expect(repairedNotes([], [])).toBeNull();
  });

  it('assunto que só existe na nota antiga é mantido', () => {
    const existing = ['Outro suplemento: creatina | Alimentos que evita: ma'];
    expect(repairedNotes(existing, ['Alimentos que evita: mamão'])).toEqual([
      'Alimentos que evita: mamão',
      'Outro suplemento: creatina',
    ]);
  });
});
