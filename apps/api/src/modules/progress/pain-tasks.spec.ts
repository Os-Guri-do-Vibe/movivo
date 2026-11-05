import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  painAssessmentValidators,
  painGuidanceValidators,
  regionOf,
  type PainAssessment,
  type PainAssessmentInput,
  type PainGuidance,
  type PainGuidanceInput,
} from './pain-tasks';

const ctx: ValidationContext = { state: {}, methodology: {} };

const input = (over: Partial<PainAssessmentInput> = {}): PainAssessmentInput => ({
  reports: [{ region: 'joelho', intensity: 4, during: 'DURING', character: 'JOINT' }],
  session: { modality: 'STRENGTH', title: 'Pernas', rpe: 8, status: 'COMPLETED' },
  history: [],
  activeSignals: [],
  upcoming: [],
  checkIn: null,
  ...over,
});

const assessment = (over: Partial<PainAssessment> = {}): PainAssessment => ({
  level: 'ADAPT',
  hypotheses: ['Pode ser sobrecarga na região do joelho.'],
  redFlags: [],
  avoidRegions: ['KNEE'],
  volumeReductionPercent: 10,
  referral: null,
  guidance: ['Poupe o joelho nos próximos treinos.'],
  ...over,
});

const run = async <I, O>(
  validators: Array<(i: I, o: O, c: ValidationContext) => unknown[] | Promise<unknown[]>>,
  i: I,
  o: O,
) => (await Promise.all(validators.map((v) => v(i, o, ctx)))).flat() as Array<{ message: string }>;

describe('recovery.assess_pain: regras determinísticas sobre a leitura', () => {
  it('aceita uma leitura coerente', async () => {
    expect(await run(painAssessmentValidators, input(), assessment())).toEqual([]);
  });

  it('dor de 8/10 ou mais precisa encaminhar a um profissional', async () => {
    const severe = input({ reports: [{ region: 'ombro', intensity: 9, during: 'DURING' }] });
    const found = await run(painAssessmentValidators, severe, assessment({ level: 'ADAPT' }));
    expect(found.map((v) => v.message).join(' | ')).toContain('encaminhar a um profissional');
  });

  it('encaminhar exige especialidade, e urgência exige o sinal de alerta que a justifica', async () => {
    const noReferral = await run(painAssessmentValidators, input(), assessment({ level: 'REFER' }));
    expect(noReferral.map((v) => v.message).join(' | ')).toContain('especialidade');

    const urgent = await run(
      painAssessmentValidators,
      input(),
      assessment({
        level: 'REFER',
        referral: { specialty: 'DOCTOR', urgency: 'URGENT', reason: 'Dormência no braço.' },
        redFlags: [],
      }),
    );
    expect(urgent.map((v) => v.message).join(' | ')).toContain('sinal de alerta');
  });

  it('dor em pontada que limita o movimento, forte, não fica só em monitorar', async () => {
    const sharp = input({
      reports: [
        {
          region: 'lombar',
          intensity: 6,
          during: 'DURING',
          character: 'SHARP',
          limitsMovement: true,
        },
      ],
    });
    const found = await run(
      painAssessmentValidators,
      sharp,
      assessment({ level: 'MONITOR', avoidRegions: [], volumeReductionPercent: 0 }),
    );
    expect(found.map((v) => v.message).join(' | ')).toContain('adaptar ou poupar');
  });

  it('adaptar exige dizer qual região poupar; hipótese não pode soar como certeza', async () => {
    const noRegion = await run(painAssessmentValidators, input(), assessment({ avoidRegions: [] }));
    expect(noRegion.map((v) => v.message).join(' | ')).toContain('região');

    const certain = await run(
      painAssessmentValidators,
      input(),
      assessment({ hypotheses: ['Com certeza é uma tendinite.'] }),
    );
    expect(certain.length).toBeGreaterThan(0);
  });
});

describe('communication.pain_guidance', () => {
  const guidanceInput = (over: Partial<PainGuidanceInput> = {}): PainGuidanceInput => ({
    firstName: 'Bruno',
    assessment: assessment(),
    reports: [{ region: 'joelho', intensity: 4, during: 'DURING' }],
    adaptations: [
      { sessionTitle: 'Pernas', date: '2026-11-05', from: 'Agachamento', to: 'Leg press' },
    ],
    volumeReductionApplied: 10,
    ...over,
  });
  const text = (...messages: string[]): PainGuidance => ({ messages });

  it('aceita a conversa que acolhe, orienta e conta o que mudou', async () => {
    expect(
      await run(
        painGuidanceValidators,
        guidanceInput(),
        text(
          'Bruno, obrigado por contar da dor no joelho. Troquei o agachamento pelo leg press no treino de quinta.',
        ),
      ),
    ).toEqual([]);
  });

  it('recusa diagnóstico, remédio e garantia', async () => {
    for (const bad of [
      'Isso é uma lesão confirmada no joelho, troquei o exercício.',
      'Tome um anti-inflamatório e troque o exercício.',
      'Garanto que passa, troquei o exercício.',
    ]) {
      const found = await run(painGuidanceValidators, guidanceInput(), text(bad));
      expect(found.length, bad).toBeGreaterThan(0);
    }
  });

  it('com encaminhamento, diz qual profissional; com urgência, manda buscar atendimento', async () => {
    const referral = guidanceInput({
      adaptations: [],
      assessment: assessment({
        level: 'REFER',
        referral: { specialty: 'ORTHOPEDIST', urgency: 'URGENT', reason: 'Dor forte após queda.' },
        redFlags: ['dor forte após trauma'],
      }),
    });
    const vague = await run(
      painGuidanceValidators,
      referral,
      text('Descanse hoje e me conta como fica.'),
    );
    expect(vague.map((v) => v.message).join(' | ')).toContain('profissional');

    const ok = await run(
      painGuidanceValidators,
      referral,
      text('Procure um ortopedista e busque atendimento agora; se piorar, SAMU 192.'),
    );
    expect(ok).toEqual([]);
  });

  it('o treino foi adaptado: a conversa precisa contar o que mudou', async () => {
    const found = await run(
      painGuidanceValidators,
      guidanceInput(),
      text('Obrigado por contar, descanse hoje.'),
    );
    expect(found.map((v) => v.message).join(' | ')).toContain('o que mudou');
  });
});

describe('região do relato', () => {
  it.each([
    ['ombro', 'SHOULDER'],
    ['Joelho direito', 'KNEE'],
    ['lombar', 'LOWER_BACK'],
    ['tornozelo', 'ANKLE'],
    ['pescoço', 'NECK'],
  ] as const)('"%s" → %s', (text, expected) => {
    expect(regionOf(text)).toBe(expected);
  });

  it('região desconhecida não vira tag', () => {
    expect(regionOf('outra')).toBeNull();
  });
});
