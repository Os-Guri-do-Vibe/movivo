import { describe, expect, it } from 'vitest';

import type { ParqAnswer, ParqQuestionId } from '@movivo/shared';
import { PARQ_QUESTION_IDS, PARQ_VERSION, ParqState } from '@movivo/shared';

import { evaluateParq } from '../anamnesis/parq';
import {
  demoteLevel,
  emphasisToMuscleGroups,
  importantEventForPrompt,
  levelFromExperience,
  mapInjuriesToTags,
  painToConstraints,
  parqToConstraints,
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
});

describe('anamnese v2 → UserConstraints (US-6.9)', () => {
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

  it('sem dor, nenhuma contraindicação e nenhum texto de saúde é derivado', () => {
    expect(
      painToConstraints({
        hasPain: false,
        points: [],
        hasProfessionalExplanation: false,
        underMedicalFollowUp: false,
        hasAvoidanceRecommendation: false,
      }),
    ).toEqual({ tags: [], raw: [] });
    expect(painToConstraints(null)).toEqual({ tags: [], raw: [] });
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

  it('Q4 (tontura/desmaio) → BALANCE_FALL_RISK e trava a fase em ADAPTACAO', () => {
    const { tags, maxPhase } = mapParq({ Q4: true });
    expect(tags).toEqual(['BALANCE_FALL_RISK']);
    expect(maxPhase).toBe('ADAPTACAO');
  });

  it('Q7 (gravidez/pós-parto) → PREGNANCY, sem teto de fase', () => {
    const { tags, maxPhase } = mapParq({ Q7: true });
    expect(tags).toEqual(['PREGNANCY']);
    expect(maxPhase).toBeUndefined();
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
    const { tags, maxPhase } = mapParq({ Q4: true, Q6: 'dor no ombro' });
    expect(tags).toEqual(expect.arrayContaining(['BALANCE_FALL_RISK', 'SHOULDER']));
    expect(maxPhase).toBe('ADAPTACAO');
  });

  it('evaluateParq concorda: qualquer "Sim" bloqueia', () => {
    const answers = parqWith({ Q7: true });
    const evaluation = evaluateParq({ parq: { version: PARQ_VERSION, answers } });
    expect(evaluation.requiresProfessionalReview).toBe(true);
    expect(evaluation.parqState).toBe(ParqState.BLOQUEADO_AGUARDANDO_CLEARANCE);
    expect(evaluation.triggeredQuestions).toEqual(['Q7']);
  });
});

describe('demoteLevel (PAR-Q bloqueado rebaixa um degrau)', () => {
  it('desce um nível, com piso em INICIANTE', () => {
    expect(demoteLevel('AVANCADO')).toBe('INTERMEDIARIO');
    expect(demoteLevel('INTERMEDIARIO')).toBe('INICIANTE');
    expect(demoteLevel('INICIANTE')).toBe('INICIANTE');
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
});
