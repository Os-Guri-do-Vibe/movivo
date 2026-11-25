import { describe, expect, it } from 'vitest';

import { specialistAnswerTasks } from '../conversation/tasks';
import { physiqueNotesOf } from './plan-generation.service';
import { parseStateView } from './state-view';
import { languageViolations } from './tasks/common';
import { strategyTask } from './tasks/strategy';

const viewWith = (bodyComposition: unknown) => parseStateView({ bodyComposition });

describe('avaliação física por foto no estado do aluno', () => {
  const slice = {
    assessedOn: '2026-11-05',
    bodyFatRangePercent: { min: 24, max: 29 },
    confidence: 'LOW',
    observations: [],
    muscleGroups: [
      { region: 'GLUTES', status: 'TO_DEVELOP', note: 'Menos volume que o conjunto.' },
      { region: 'SHOULDERS', status: 'STRENGTH', note: 'Ombros bem definidos.' },
    ],
    posture: [
      { region: 'HEAD_NECK', finding: 'Cabeça projetada à frente.', degree: 'MILD' },
      { region: 'PELVIS', finding: 'Pelve inclinada para a frente.', degree: 'NOTABLE' },
    ],
    symmetry: 'Ombro direito mais elevado.',
    strengths: ['Ombros e braços bem desenvolvidos.'],
    attentionPoints: ['Glúteos com espaço para evoluir.'],
  };

  it('grupos, postura, simetria e destaques chegam à visão dos agentes', () => {
    const view = viewWith(slice);
    expect(view.bodyComposition?.muscleGroups.map((g) => g.region)).toEqual([
      'GLUTES',
      'SHOULDERS',
    ]);
    expect(view.bodyComposition?.posture).toHaveLength(2);
    expect(view.bodyComposition?.symmetry).toBe('Ombro direito mais elevado.');
    expect(view.bodyComposition?.strengths).toEqual(['Ombros e braços bem desenvolvidos.']);
  });

  it('avaliação antiga, sem a parte completa, continua válida', () => {
    const view = viewWith({
      assessedOn: '2026-08-01',
      bodyFatRangePercent: { min: 20, max: 25 },
      confidence: 'LOW',
      observations: ['Mais definição nos ombros.'],
    });
    expect(view.bodyComposition).toMatchObject({ muscleGroups: [], posture: [], symmetry: null });
    expect(physiqueNotesOf(view)).toEqual([]);
  });

  it('o profissional que audita recebe a postura e a simetria como leitura da IA', () => {
    const [note] = physiqueNotesOf(viewWith(slice));
    expect(note).toContain('leitura da IA, para auditoria');
    expect(note).not.toContain('presencialmente');
    expect(note).toContain('Cabeça e cervical: Cabeça projetada à frente.');
    expect(note).toContain('Pelve: Pelve inclinada para a frente.');
    expect(note).toContain('Simetria: Ombro direito mais elevado.');
  });

  it('sem avaliação por foto não há nota', () => {
    expect(physiqueNotesOf(parseStateView({}))).toEqual([]);
  });
});

describe('percepção postural dita ao aluno', () => {
  const sentence =
    'Notamos nas fotos que seu ombro esquerdo parece mais alto que o direito, o que pode indicar um desvio postural; recomendamos uma avaliação profissional para entender melhor o seu caso.';

  it('o modelo de frase passa nos guardrails de linguagem', () => {
    expect(languageViolations(sentence, 'studentMessage')).toEqual([]);
  });

  it('a estratégia e a conversa orientam a dizer a percepção e buscar avaliação profissional', () => {
    expect(strategyTask.instructions).toMatch(/degree NOTABLE/);
    expect(strategyTask.instructions).toMatch(/recomendamos uma avaliação profissional/);
    expect(specialistAnswerTasks.NUTRITION.instructions).toMatch(
      /procure uma avaliação profissional/,
    );
  });
});
