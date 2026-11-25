import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import { parseStateView } from '../planning/state-view';
import { observationsOf, profileOf } from './physique-assessment.service';
import {
  physiqueTask,
  physiqueValidators,
  type PhysiqueInput,
  type PhysiqueOutput,
} from './physique-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };
const input: PhysiqueInput = {
  order: [{ angle: 'FRONT' }, { angle: 'LEFT' }, { angle: 'RIGHT' }, { angle: 'BACK' }],
  profile: {
    ageYears: 29,
    biologicalSex: 'FEMALE',
    heightCm: 165,
    weightKg: 62,
    goal: 'BODY_DEFINITION',
    modalities: ['STRENGTH'],
    routine: '4 dias por semana para treinar',
    complaint: null,
  },
};
const reading = (over: Partial<PhysiqueOutput> = {}): PhysiqueOutput => ({
  analyzable: true,
  bodyFatRange: { min: 24, max: 29 },
  confidence: 'LOW',
  physique: {
    muscleGroups: [
      { region: 'SHOULDERS', status: 'STRENGTH', note: 'Ombros bem definidos para o nível.' },
      { region: 'GLUTES', status: 'TO_DEVELOP', note: 'Menos volume que o conjunto.' },
    ],
    posture: [
      {
        region: 'HEAD_NECK',
        finding: 'Cabeça projetada à frente na posição lateral.',
        degree: 'MILD',
        seenIn: ['LEFT', 'RIGHT'],
      },
    ],
    symmetry: 'Ombro direito um pouco mais elevado que o esquerdo.',
    strengths: ['Ombros e braços bem desenvolvidos.'],
    attentionPoints: ['Glúteos com espaço para evoluir.'],
  },
  limitations: ['A luz da foto lateral deixa sombra no quadril.'],
  ...over,
});
const run = async (output: PhysiqueOutput) =>
  (await Promise.all(physiqueValidators.map((v) => v(input, output, ctx)))).flat();

describe('vision.assess_physique', () => {
  it('aceita a leitura completa: músculos, postura, simetria e faixa de gordura', async () => {
    expect(await run(reading())).toEqual([]);
  });

  it('a faixa de gordura tem margem de pelo menos 4 pontos', async () => {
    const found = await run(reading({ bodyFatRange: { min: 25, max: 26 } }));
    expect(found.map((v) => v.path)).toContain('bodyFatRange');
  });

  it('foto sem leitura confiável não traz faixa nem avaliação', async () => {
    expect((await run(reading({ analyzable: false }))).map((v) => v.path)).toContain('analyzable');
    const empty = {
      muscleGroups: [],
      posture: [],
      symmetry: null,
      strengths: [],
      attentionPoints: [],
    };
    expect(await run(reading({ analyzable: false, bodyFatRange: null, physique: empty }))).toEqual(
      [],
    );
  });

  it('nomear condição clínica na postura é recusado: descreve-se o que se vê', async () => {
    const output = reading();
    output.physique.posture = [
      {
        region: 'THORACIC',
        finding: 'Sinais claros de escoliose e hipercifose.',
        degree: 'NOTABLE',
        seenIn: ['BACK'],
      },
    ];
    const found = await run(output);
    expect(found.map((v) => v.message).join(' ')).toContain('não nomeie condição clínica');
  });

  it('grupo muscular e segmento repetidos são recusados', async () => {
    const output = reading();
    output.physique.muscleGroups.push({ region: 'GLUTES', status: 'BALANCED', note: 'Repetido.' });
    output.physique.posture.push({
      region: 'HEAD_NECK',
      finding: 'Cervical um pouco retificada.',
      degree: 'MILD',
      seenIn: ['LEFT'],
    });
    const paths = (await run(output)).map((v) => v.path);
    expect(paths).toContain('physique.muscleGroups');
    expect(paths).toContain('physique.posture');
  });

  it('sem julgamento estético nem diagnóstico no texto', async () => {
    const harsh = reading();
    harsh.physique.attentionPoints = ['A barriga é gorda demais e feia.'];
    expect((await run(harsh)).length).toBeGreaterThan(0);
  });

  it('o prompt cobre os sete segmentos da postura e proíbe nomear condição', () => {
    for (const term of [
      'cabeça e cervical',
      'ombros',
      'torácica',
      'lombar',
      'pelve',
      'joelhos',
      'pés',
    ]) {
      expect(physiqueTask.instructions.toLowerCase()).toContain(term);
    }
    expect(physiqueTask.instructions).toMatch(/NUNCA nomeie doença/);
  });
});

describe('dados que chegam aos agentes e ao profissional', () => {
  it('observações para o profissional trazem postura visível, simetria e grupos a desenvolver', () => {
    const lines = observationsOf(reading());
    expect(lines.join(' ')).toContain('Cabeça e cervical: Cabeça projetada à frente');
    expect(lines.join(' ')).toContain('Ombro direito um pouco mais elevado');
    expect(lines.join(' ')).toContain('Glúteos a desenvolver');
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it('segmento sem alteração visível não vira observação', () => {
    const output = reading();
    output.physique.posture = [
      {
        region: 'KNEES',
        finding: 'Joelhos alinhados nas duas posições.',
        degree: 'NONE_VISIBLE',
        seenIn: ['FRONT'],
      },
    ];
    output.physique.symmetry = null;
    expect(observationsOf(output).join(' ')).not.toContain('Joelhos');
  });

  it('perfil enviado à visão resume idade, medidas, objetivo, rotina e queixa, sem nome', () => {
    const view = parseStateView({
      identity: { ageYears: 29, biologicalSex: 'FEMALE', heightCm: 165 },
      goals: {
        goalId: 'g1',
        declared: { primary: 'BODY_DEFINITION', secondary: [], emphasis: 'AESTHETICS' },
      },
      body: { WEIGHT: { latest: 62, on: '2026-11-01' } },
      training: {
        modalities: [{ modality: 'STRENGTH', level: 'INTERMEDIATE', wantsToStart: false }],
        externalSports: [],
        venues: ['FULL_GYM'],
      },
      availability: [
        {
          kind: 'AVAILABILITY',
          windows: ['MON', 'WED', 'FRI'].map((weekday) => ({
            weekday,
            slot: 'ANY',
            maxMinutes: 60,
          })),
          variesWeekly: false,
          maxSessionsPerWeek: 3,
        },
      ],
      safety: {
        activeSignals: [],
        healthRecords: [{ kind: 'PAIN', summary: 'Dor leve no joelho direito ao agachar' }],
      },
    });
    const profile = profileOf(view);
    expect(profile).toMatchObject({
      ageYears: 29,
      weightKg: 62,
      goal: 'BODY_DEFINITION',
      modalities: ['STRENGTH'],
      routine: '3 dias por semana para treinar',
      complaint: 'Dor leve no joelho direito ao agachar',
    });
    expect(Object.keys(profile)).not.toContain('name');
  });
});
