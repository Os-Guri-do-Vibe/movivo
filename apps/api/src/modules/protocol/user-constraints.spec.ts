import { describe, expect, it } from 'vitest';

import type { ParqAnswer, ParqQuestionId } from '@movivo/shared';
import { PARQ_QUESTION_IDS, PARQ_VERSION, ParqState } from '@movivo/shared';

import { evaluateParq } from '../anamnesis/parq';
import {
  PAIN_VETO_INTENSITY,
  emphasisToMuscleGroups,
  hardInjuryTags,
  importantEventForPrompt,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
  parqToConstraints,
  routineContextForPrompt,
} from './user-constraints';

/** Monta o PAR-Q completo marcando "Sim" só nas perguntas passadas (valor = `detail`). */
function parqWith(yes: Partial<Record<ParqQuestionId, string | true>>): ParqAnswer[] {
  return PARQ_QUESTION_IDS.map((questionId) => ({
    questionId,
    answer: yes[questionId] !== undefined,
    ...(typeof yes[questionId] === 'string' ? { detail: yes[questionId] } : {}),
  }));
}

function mapParq(yes: Partial<Record<ParqQuestionId, string | true>>) {
  const answers = parqWith(yes);
  return parqToConstraints(evaluateParq({ parq: { version: PARQ_VERSION, answers } }), answers);
}

describe('mapInjuriesToTags', () => {
  it('mapeia lesão em texto livre para a tag correta', () => {
    expect(mapInjuriesToTags(['dor no ombro direito'])).toContain('SHOULDER');
    expect(mapInjuriesToTags(['lesão no joelho'])).toContain('KNEE');
    expect(mapInjuriesToTags(['hérnia de disco lombar'])).toContain('LOWER_BACK');
  });

  it('reconhece variações com e sem acento', () => {
    expect(mapInjuriesToTags(['problema no coracao'])).toContain('CARDIAC');
    expect(mapInjuriesToTags(['pressão alta'])).toContain('CARDIAC');
  });

  it('deduplica tags quando várias lesões apontam para a mesma', () => {
    const tags = mapInjuriesToTags(['dor no ombro', 'manguito rotador']);
    expect(tags.filter((t) => t === 'SHOULDER')).toHaveLength(1);
  });

  it('ignora texto sem palavra-chave conhecida (fica visível no texto livre)', () => {
    expect(mapInjuriesToTags(['algo genérico'])).toEqual([]);
  });

  it('retorna vazio para lista vazia', () => {
    expect(mapInjuriesToTags([])).toEqual([]);
  });

  // Achado 2026-10-21: "pe" (pé) casava como substring em "peso", "pessoa", "esperar".
  it('palavra curta exige a palavra inteira: "peso" e "pessoa" não são tornozelo', () => {
    expect(mapInjuriesToTags(['piora quando treino com peso'])).toEqual([]);
    expect(mapInjuriesToTags(['uma pessoa que espera melhorar'])).toEqual([]);
    expect(mapInjuriesToTags(['dor no pé ao correr'])).toContain('ANKLE');
    expect(mapInjuriesToTags(['dor no pe'])).toContain('ANKLE');
  });

  it('palavra longa aceita flexão e acento: joelhos, hérnias, lombares', () => {
    expect(mapInjuriesToTags(['dor nos joelhos'])).toContain('KNEE');
    expect(mapInjuriesToTags(['duas hérnias'])).toContain('LOWER_BACK');
    expect(mapInjuriesToTags(['dores lombares'])).toContain('LOWER_BACK');
  });
});

describe('anamnese v2 → UserConstraints (US-6.9)', () => {
  it('preserva rotina, barreiras e outro esporte para criação e avaliação contextual', () => {
    const text = routineContextForPrompt(
      {
        pastActivities: ['WALK_RUN'],
        consistencyBarriers: ['LACK_OF_TIME', 'TIREDNESS'],
        preferredPeriod: 'EVENING',
        practicesOtherSport: true,
        otherSportDaysPerWeek: 3,
      },
      { otherSportName: 'Esporte sintético', consistencyBarrierOther: 'Turnos alternados' },
    );
    expect(text).toContain('LACK_OF_TIME, TIREDNESS');
    expect(text).toContain('Esporte sintético, 3 dia(s)/semana');
    expect(text).toContain('Turnos alternados');
    expect(text).toContain('EVENING');
  });

  it('não inventa atividade, frequência ou dificuldade ausente', () => {
    const text = routineContextForPrompt({
      pastActivities: [],
      consistencyBarriers: [],
      preferredPeriod: 'VARIES',
      practicesOtherSport: false,
    });
    expect(text).toContain('não informadas');
    expect(text).toContain('Não declarou prática de outro esporte');
    const missing = routineContextForPrompt(
      {
        pastActivities: [],
        consistencyBarriers: [],
        preferredPeriod: 'VARIES',
        practicesOtherSport: true,
      },
      { primaryGoalOther: 'Meta sintética', pastActivityOther: 'Atividade sintética' },
    );
    expect(missing).toContain('modalidade não informada');
    expect(missing).toContain('frequência não informada');
    expect(missing).toContain('Meta sintética');
    expect(missing).toContain('Atividade sintética');
  });

  it('experiência declarada vira nível real — fim do default INICIANTE', () => {
    expect(levelFromExperience('BEGINNER')).toBe('INICIANTE');
    expect(levelFromExperience('INTERMEDIATE')).toBe('INTERMEDIARIO');
    expect(levelFromExperience('ADVANCED')).toBe('AVANCADO');
  });

  it('ênfase vira grupo muscular do catálogo; "corpo todo" não prioriza nada', () => {
    expect(emphasisToMuscleGroups(['BACK', 'GLUTES'])).toEqual(['costas', 'glúteo']);
    expect(emphasisToMuscleGroups(['BICEPS'])).toEqual(['bíceps', 'tríceps']);
    expect(emphasisToMuscleGroups(['TRICEPS'])).toEqual(['tríceps']);
    expect(emphasisToMuscleGroups(['FULL_BODY'])).toEqual([]);
    expect(emphasisToMuscleGroups([])).toEqual([]);
  });

  it('dor da seção 4 vira contraindicação estruturada, sem passar por heurística de texto', () => {
    const { tags, raw } = painToConstraints({
      hasPain: true,
      trend: 'WORSENING',
      points: [
        { region: 'KNEE', intensity: 8 },
        { region: 'UPPER_BACK', intensity: 3 },
      ],
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    });
    expect(tags).toContain('KNEE');
    // A região torácica cai na mesma tag de coluna — o catálogo não separa as duas.
    expect(tags).toContain('LOWER_BACK');
    expect(raw.join(' ')).toContain('intensidade 8/10');
  });

  it('"outra região" e a recomendação profissional passam pela heurística de texto', () => {
    const { tags } = painToConstraints({
      hasPain: true,
      trend: 'STABLE',
      points: [{ region: 'OTHER', intensity: 5, regionOther: 'dor no ombro ao levantar' }],
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: true,
      avoidanceRecommendation: 'evitar carga na coluna',
    });
    expect(tags).toContain('SHOULDER');
    expect(tags).toContain('LOWER_BACK');
  });

  it('"outra região" sem detalhe cai no rótulo genérico; gatilho da dor entra no raw', () => {
    const { raw } = painToConstraints({
      hasPain: true,
      trigger: 'ficar muito tempo sentado',
      points: [{ region: 'OTHER', intensity: 4 }],
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    });
    expect(raw.join(' ')).toContain('Dor em outra região');
    expect(raw.join(' ')).toContain('O que provoca: ficar muito tempo sentado');
  });

  it('sem dor, nenhuma contraindicação e nenhum texto de saúde é derivado', () => {
    expect(
      painToConstraints({
        hasPain: false,
        points: [],
        hasProfessionalExplanation: false,
        underMedicalFollowUp: false,
        hasAvoidanceRecommendation: false,
      }),
    ).toEqual({ tags: [], cautionTags: [], raw: [] });
    expect(painToConstraints(null)).toEqual({ tags: [], cautionTags: [], raw: [] });
  });
});

/**
 * 2026-08-24: o PAR-Q deixou de ser TRAVA de geração, então cada "Sim" precisou virar
 * restrição concreta — senão "gerar com cuidado" seria só uma etiqueta sem efeito.
 * Os IDs foram conferidos contra `PARQ_QUESTION_TEXT`, não contra a ordem da lista.
 */
describe('parqToConstraints (PAR-Q → contraindicações)', () => {
  it('Q1/Q2/Q3/Q5 (coração, dor no peito, medicação) → CARDIAC', () => {
    for (const id of ['Q1', 'Q2', 'Q3', 'Q5'] as const) {
      expect(mapParq({ [id]: true }).tags).toEqual(['CARDIAC']);
    }
  });

  it('Q1+Q2+Q5 juntas não duplicam a mesma tag', () => {
    expect(mapParq({ Q1: true, Q2: true, Q5: true }).tags).toEqual(['CARDIAC']);
  });

  it('Q4 gera BALANCE_FALL_RISK sem determinar fase', () => {
    const { tags } = mapParq({ Q4: true });
    expect(tags).toEqual(['BALANCE_FALL_RISK']);
    expect(mapParq({ Q4: true })).not.toHaveProperty('maxPhase');
  });

  it('Q7 (gravidez/pós-parto) → PREGNANCY, sem teto de fase', () => {
    const { tags } = mapParq({ Q7: true });
    expect(tags).toEqual(['PREGNANCY']);
    expect(mapParq({ Q7: true })).not.toHaveProperty('maxPhase');
  });

  // Q6/Q8/Q9 não têm tag fixa de propósito: "problema em articulação" sem dizer QUAL
  // não identifica região nenhuma, e inventar uma seria pior que deixar o texto ao RT.
  it('Q6/Q8/Q9 não têm tag fixa — só o detail vira tag, pela heurística de texto', () => {
    expect(mapParq({ Q6: true }).tags).toEqual([]);
    expect(mapParq({ Q6: 'hérnia de disco na lombar' }).tags).toEqual(['LOWER_BACK']);
    expect(mapParq({ Q8: 'cirurgia no joelho' }).tags).toEqual(['KNEE']);
    expect(mapParq({ Q9: 'labirintite' }).tags).toEqual(['BALANCE_FALL_RISK']);
  });

  it('detail sem palavra-chave conhecida não inventa tag (fica visível ao RT)', () => {
    expect(mapParq({ Q9: 'orientação do meu médico' }).tags).toEqual([]);
  });

  it('PAR-Q todo "Não" → nenhuma tag, nenhum teto', () => {
    const result = mapParq({});
    expect(result).toEqual({ tags: [] });
  });

  it('combina tag fixa e tag derivada de texto na mesma avaliação', () => {
    const { tags } = mapParq({ Q4: true, Q6: 'dor no ombro' });
    expect(tags).toEqual(expect.arrayContaining(['BALANCE_FALL_RISK', 'SHOULDER']));
    expect(mapParq({ Q4: true, Q6: 'dor no ombro' })).not.toHaveProperty('maxPhase');
  });

  it('evaluateParq concorda: qualquer "Sim" bloqueia', () => {
    const answers = parqWith({ Q7: true });
    const evaluation = evaluateParq({ parq: { version: PARQ_VERSION, answers } });
    expect(evaluation.requiresProfessionalReview).toBe(true);
    expect(evaluation.parqState).toBe(ParqState.BLOQUEADO_AGUARDANDO_CLEARANCE);
    expect(evaluation.triggeredQuestions).toEqual(['Q7']);
  });
});

/**
 * Achado 2026-09-02 (correção do fundador): o evento-alvo da anamnese é contexto de
 * OTIMIZAÇÃO pro prompt (fase/ênfase/progressão dentro do prazo real), nunca fonte de
 * `total_weeks`/`end_date` — isso é `phaseDurationWeeks`, decidido só pela faixa de
 * evidência da fase (`protocol-timeline.ts`).
 */
describe('importantEventForPrompt', () => {
  const from = new Date('2026-09-02T12:00:00.000Z');

  it('sem hasImportantEvent → undefined', () => {
    expect(
      importantEventForPrompt({ hasImportantEvent: false }, 'chegar a 70kg', from),
    ).toBeUndefined();
  });

  it('hasImportantEvent sem data → undefined (schema já obriga os dois juntos, mas defensivo)', () => {
    expect(importantEventForPrompt({ hasImportantEvent: true }, undefined, from)).toBeUndefined();
  });

  it('data já passada → undefined (nada a otimizar pra um prazo que não existe mais)', () => {
    expect(
      importantEventForPrompt(
        { hasImportantEvent: true, importantEventDate: '2026-01-01' },
        undefined,
        from,
      ),
    ).toBeUndefined();
  });

  it('data hoje (sem sobra de tempo) → undefined', () => {
    expect(
      importantEventForPrompt(
        { hasImportantEvent: true, importantEventDate: '2026-09-02' },
        undefined,
        from,
      ),
    ).toBeUndefined();
  });

  it('data futura → date + daysUntil arredondado pra cima, sem description quando ausente', () => {
    const result = importantEventForPrompt(
      { hasImportantEvent: true, importantEventDate: '2026-12-25' },
      undefined,
      from,
    );
    expect(result).toEqual({ date: '2026-12-25', daysUntil: 114 });
  });

  it('inclui description (texto livre do usuário) quando presente', () => {
    const result = importantEventForPrompt(
      { hasImportantEvent: true, importantEventDate: '2026-12-25' },
      'quero emagrecer e chegar a 70kg pro Natal',
      from,
    );
    expect(result).toEqual({
      date: '2026-12-25',
      daysUntil: 114,
      description: 'quero emagrecer e chegar a 70kg pro Natal',
    });
  });

  describe('dor sem veto vira cautela (política de 2026-10-21)', () => {
    const base = {
      hasPain: true,
      trend: 'STABLE' as const,
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    };

    it('dor moderada, estável, sem orientação de evitar: tag continua em `tags`, mas é cautela', () => {
      const r = painToConstraints({ ...base, points: [{ region: 'SHOULDER', intensity: 4 }] });
      expect(r.tags).toEqual(['SHOULDER']);
      expect(r.cautionTags).toEqual(['SHOULDER']);
    });

    it(`dor a partir de ${PAIN_VETO_INTENSITY}/10 é veto`, () => {
      const r = painToConstraints({
        ...base,
        points: [
          { region: 'KNEE', intensity: PAIN_VETO_INTENSITY },
          { region: 'ELBOW', intensity: PAIN_VETO_INTENSITY - 1 },
        ],
      });
      expect(r.tags).toEqual(expect.arrayContaining(['KNEE', 'ELBOW']));
      expect(r.cautionTags).toEqual(['ELBOW']);
    });

    it.each([
      ['tendência de piora', { trend: 'WORSENING' as const }],
      ['acompanhamento médico ativo', { underMedicalFollowUp: true }],
      [
        'orientação profissional de evitar',
        { hasAvoidanceRecommendation: true, avoidanceRecommendation: 'evitar impacto' },
      ],
    ])('%s torna toda dor da seção veto', (_label, extra) => {
      const r = painToConstraints({
        ...base,
        ...extra,
        points: [{ region: 'LOWER_BACK', intensity: 2 }],
      });
      expect(r.tags).toEqual(['LOWER_BACK']);
      expect(r.cautionTags).toEqual([]);
    });

    it('o texto de "evitar" é veto; o de "o que provoca" só vira cautela', () => {
      const r = painToConstraints({
        ...base,
        points: [{ region: 'KNEE', intensity: 2 }],
        trigger: 'piora ao subir escada e levantar o ombro',
        hasAvoidanceRecommendation: false,
      });
      expect(r.tags).toEqual(expect.arrayContaining(['KNEE', 'SHOULDER']));
      expect(r.cautionTags).toEqual(expect.arrayContaining(['KNEE', 'SHOULDER']));
      const avoid = painToConstraints({
        ...base,
        points: [{ region: 'KNEE', intensity: 2 }],
        hasAvoidanceRecommendation: true,
        avoidanceRecommendation: 'evitar carga no ombro',
      });
      expect(avoid.cautionTags).toEqual([]);
    });

    it('tag clínica (cardíaca, queda, gestação) nunca vira cautela, mesmo vindo de texto de dor', () => {
      const r = painToConstraints({
        ...base,
        points: [{ region: 'OTHER', intensity: 3, regionOther: 'dor no peito e pressão alta' }],
      });
      expect(r.tags).toContain('CARDIAC');
      expect(r.cautionTags).not.toContain('CARDIAC');
    });

    it('`hardInjuryTags` tira as de cautela; sem `cautionTags`, tudo veta', () => {
      expect(
        hardInjuryTags({ injuryTags: ['KNEE', 'SHOULDER'], cautionTags: ['SHOULDER'] }),
      ).toEqual(['KNEE']);
      expect(hardInjuryTags({ injuryTags: ['KNEE', 'SHOULDER'] })).toEqual(['KNEE', 'SHOULDER']);
    });
  });
});
