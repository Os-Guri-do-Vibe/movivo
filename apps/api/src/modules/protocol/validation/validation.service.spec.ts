/**
 * Unit — ValidationService (US-2.3). Cobertura 100% (gate migrado do motor determinístico):
 * cada regra estrutural, cada regra de linguagem, PARQ e cada caminho de agregação.
 */
import { describe, expect, it } from 'vitest';
import type { ProtocolExercise, ProtocolStructure } from '@movivo/shared';

import { aggregate, ValidationService, type ValidateProtocolInput } from './validation.service';

const service = new ValidationService();

/** Protocolo limpo (passa em tudo). Exercícios sem contraindicação p/ um usuário sem lesão. */
function validStructure(over: Partial<ProtocolStructure> = {}): ProtocolStructure {
  return {
    promptVersion: 'test-v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    weeklyFrequency: 2,
    sessions: [
      {
        dayLabel: 'A',
        focus: 'Corpo inteiro',
        exercises: [
          {
            exerciseId: 'dead_bug',
            name: 'Dead bug',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 60,
            notes: 'Controle o movimento.',
          },
          {
            // sem notes (cobre o ramo `ex.notes ?? ''`)
            exerciseId: 'goblet_squat',
            name: 'Agachamento goblet',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
    generalNotes: 'Bom treino!',
    ...over,
  };
}

function input(over: Partial<ValidateProtocolInput> = {}): ValidateProtocolInput {
  return {
    structure: validStructure(),
    constraints: { goal: 'GAIN_MUSCLE', injuryTags: [] },
    ...over,
  };
}

/** Substitui o primeiro exercício da primeira sessão. */
function withExercise(over: Partial<ProtocolExercise>): ProtocolStructure {
  const s = validStructure();
  const session = s.sessions[0];
  const first = session?.exercises[0];
  if (!session || !first) throw new Error('fixture inválida');
  session.exercises[0] = { ...first, ...over };
  return s;
}

describe('ValidationService — caminho limpo', () => {
  it('PASS quando estrutura e linguagem estão ok', () => {
    const v = service.validate(input());
    expect(v.action).toBe('PASS');
    expect(v.code).toBe('PASS');
    expect(v.humanReviewRequired).toBe(false);
    expect(v.violations).toEqual([]);
  });

  it('PASS sem generalNotes (cobre o ramo do texto opcional)', () => {
    const v = service.validate(input({ structure: validStructure({ generalNotes: undefined }) }));
    expect(v.action).toBe('PASS');
  });
});

describe('ValidationService — bloqueios estruturais', () => {
  it('BLOCK exercício fora da base', () => {
    const v = service.validate(input({ structure: withExercise({ exerciseId: 'inventado_x' }) }));
    expect(v.action).toBe('BLOCK_FALLBACK');
    expect(v.violations.map((x) => x.rule)).toContain('EXERCISE_UNKNOWN');
  });

  it('BLOCK exercício contraindicado por lesão do usuário', () => {
    // leg_press é contraindicado para KNEE.
    const v = service.validate(
      input({
        structure: withExercise({ exerciseId: 'leg_press', name: 'Leg press' }),
        constraints: { goal: 'GAIN_MUSCLE', injuryTags: ['KNEE'] },
      }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('EXERCISE_CONTRAINDICATED');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('BLOCK contraindicação vinda de flag PAR-Q (defense-in-depth)', () => {
    // brisk_walk é contraindicado para CARDIAC.
    const v = service.validate(
      input({
        structure: withExercise({ exerciseId: 'brisk_walk', name: 'Caminhada' }),
        parqFlags: ['CARDIAC'],
      }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('EXERCISE_CONTRAINDICATED');
  });

  it('BLOCK séries fora de faixa', () => {
    const v = service.validate(input({ structure: withExercise({ sets: 10 }) }));
    expect(v.violations.map((x) => x.rule)).toContain('SETS_OUT_OF_RANGE');
  });

  it('BLOCK repetições fora de faixa (por objetivo)', () => {
    const v = service.validate(input({ structure: withExercise({ reps: { min: 20, max: 40 } }) }));
    expect(v.violations.map((x) => x.rule)).toContain('REPS_OUT_OF_RANGE');
  });

  // Achado 2026-08-18: exercício de medida REPS sem o campo `reps` nem `durationSeconds`
  // (schema permite estruturalmente, já que os dois são opcionais) — mensagem cobre o
  // ramo "ausente" em vez de assumir que `reps` sempre existe.
  it('BLOCK repetições ausentes num exercício de medida REPS', () => {
    const v = service.validate(input({ structure: withExercise({ reps: undefined }) }));
    const violation = v.violations.find((x) => x.rule === 'REPS_OUT_OF_RANGE');
    expect(violation?.detail).toContain('ausente reps');
  });

  it('BLOCK descanso fora de faixa', () => {
    const v = service.validate(input({ structure: withExercise({ restSeconds: 500 }) }));
    expect(v.violations.map((x) => x.rule)).toContain('REST_OUT_OF_RANGE');
  });

  it('BLOCK PARQ_VIOLATION: fase FORCA com flag de PAR-Q', () => {
    const v = service.validate(
      input({ structure: validStructure({ phase: 'FORCA' }), parqFlags: ['SHOULDER'] }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('PARQ_VIOLATION');
  });

  it('não dispara PARQ_VIOLATION em FORCA sem flags', () => {
    const v = service.validate(input({ structure: validStructure({ phase: 'FORCA' }) }));
    expect(v.violations.map((x) => x.rule)).not.toContain('PARQ_VIOLATION');
  });
});

/**
 * 2026-08-24: com o PAR-Q deixando de travar a geração, "modo conservador" precisou de
 * dente. Um prompt pode ser ignorado pelo modelo; estes dois vetos não podem.
 */
describe('ValidationService — teto de PAR-Q (maxPhase)', () => {
  function capped(over: Partial<ValidateProtocolInput> = {}): ValidateProtocolInput {
    return {
      structure: validStructure(),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], maxPhase: 'ADAPTACAO' },
      ...over,
    };
  }

  it('BLOCK quando a fase passa do teto ADAPTACAO', () => {
    for (const phase of ['HIPERTROFIA', 'FORCA', 'DELOAD'] as const) {
      const v = service.validate(capped({ structure: validStructure({ phase }) }));
      expect(v.action).toBe('BLOCK_FALLBACK');
      expect(v.violations.map((x) => x.rule)).toContain('PARQ_PHASE_CAP_EXCEEDED');
    }
  });

  it('PASS quando a fase é exatamente ADAPTACAO', () => {
    const v = service.validate(capped());
    expect(v.violations.map((x) => x.rule)).not.toContain('PARQ_PHASE_CAP_EXCEEDED');
  });

  it('BLOCK quando algum exercício declara rir abaixo de 2', () => {
    for (const rir of [0, 1]) {
      const v = service.validate(capped({ structure: withExercise({ rir }) }));
      expect(v.action).toBe('BLOCK_FALLBACK');
      expect(v.violations.map((x) => x.rule)).toContain('PARQ_RIR_TOO_LOW');
    }
  });

  it('rir >= 2 e rir ausente não violam (ausente = não prescreve proximidade de falha)', () => {
    expect(
      service.validate(capped({ structure: withExercise({ rir: 2 }) })).violations.map((x) => x.rule),
    ).not.toContain('PARQ_RIR_TOO_LOW');
    expect(service.validate(capped()).violations.map((x) => x.rule)).not.toContain(
      'PARQ_RIR_TOO_LOW',
    );
  });

  it('sem maxPhase, nem o teto de fase nem o piso de RIR se aplicam', () => {
    const v = service.validate(
      input({ structure: withExercise({ rir: 0 }), constraints: { goal: 'GAIN_MUSCLE', injuryTags: [] } }),
    );
    const rules = v.violations.map((x) => x.rule);
    expect(rules).not.toContain('PARQ_RIR_TOO_LOW');
    expect(rules).not.toContain('PARQ_PHASE_CAP_EXCEEDED');
  });

  // O teto é checado FORA do early-return de `parqFlags`: na prática Q4 sempre traz
  // `BALANCE_FALL_RISK` junto, mas amarrar um ao outro seria acoplamento silencioso.
  it('teto vale mesmo com parqFlags vazio', () => {
    const v = service.validate(
      capped({ structure: validStructure({ phase: 'HIPERTROFIA' }), parqFlags: [] }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('PARQ_PHASE_CAP_EXCEEDED');
  });
});

describe('ValidationService — metodologia v2 (divisão e técnica avançada)', () => {
  /** Duas sessões, para exercitar a regra "nem toda sessão pode ter técnica". */
  function twoSessions(over: Partial<ProtocolExercise>[] = []): ProtocolStructure {
    const base = validStructure().sessions[0];
    if (!base) throw new Error('fixture inválida');
    const exercise = base.exercises[0];
    if (!exercise) throw new Error('fixture inválida');
    return validStructure({
      sessions: [
        { ...base, dayLabel: 'A', exercises: over.map((o) => ({ ...exercise, ...o })) },
        { ...base, dayLabel: 'B', exercises: [{ ...exercise }] },
      ],
    });
  }

  /** `n` cópias da sessão limpa — a frequência mínima vale contra as sessões REAIS. */
  function nSessions(n: number, over: Partial<ProtocolStructure> = {}): ProtocolStructure {
    const base = validStructure().sessions[0];
    if (!base) throw new Error('fixture inválida');
    return validStructure({
      weeklyFrequency: n,
      sessions: Array.from({ length: n }, (_, i) => ({ ...base, dayLabel: `D${i + 1}` })),
      ...over,
    });
  }

  it('PASS com divisão permitida ao nível e frequência suficiente', () => {
    const v = service.validate(input({ structure: nSessions(2, { splitType: 'UPPER_LOWER' }) }));
    expect(v.action).toBe('PASS');
  });

  it('BLOCK divisão acima do nível (ABCDE para INICIANTE)', () => {
    const v = service.validate(
      input({ structure: validStructure({ splitType: 'ABCDE', weeklyFrequency: 5 }) }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('SPLIT_LEVEL_NOT_ALLOWED');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('nível ausente é tratado como INICIANTE (fail-safe)', () => {
    const v = service.validate({
      structure: validStructure({ splitType: 'ABC', weeklyFrequency: 3 }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [] },
    });
    expect(v.violations.map((x) => x.rule)).toContain('SPLIT_LEVEL_NOT_ALLOWED');
  });

  it('permite divisão avançada quando o nível é AVANCADO', () => {
    const v = service.validate({
      structure: nSessions(5, { splitType: 'ABCDE' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
    });
    expect(v.action).toBe('PASS');
  });

  // Achado do Victor: `weeklyFrequency` é campo autodeclarado pelo LLM.
  it('BLOCK frequência declarada acima das sessões que existem de fato', () => {
    const v = service.validate({
      structure: nSessions(2, { splitType: 'ABCDE', weeklyFrequency: 5 }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
    });
    expect(v.violations.map((x) => x.rule)).toContain('SPLIT_FREQUENCY_MISMATCH');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('BLOCK divisão que a frequência não sustenta', () => {
    const v = service.validate({
      structure: validStructure({ splitType: 'ABCD', weeklyFrequency: 2 }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INTERMEDIARIO' },
    });
    expect(v.violations.map((x) => x.rule)).toContain('SPLIT_FREQUENCY_MISMATCH');
  });

  it('BLOCK técnica avançada em protocolo de INICIANTE', () => {
    const v = service.validate(input({ structure: withExercise({ technique: 'DROP_SET' }) }));
    expect(v.violations.map((x) => x.rule)).toContain('TECHNIQUE_LEVEL_NOT_ALLOWED');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('PASS técnica pontual para INTERMEDIARIO (1 exercício, 1 de 2 sessões)', () => {
    const v = service.validate({
      structure: twoSessions([{ technique: 'REST_PAUSE' }, {}]),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INTERMEDIARIO' },
    });
    expect(v.action).toBe('PASS');
  });

  it('BLOCK excesso de técnica na mesma sessão (> 2 exercícios)', () => {
    const v = service.validate({
      structure: twoSessions([
        { technique: 'DROP_SET' },
        { technique: 'REST_PAUSE' },
        { technique: 'PIRAMIDE' },
      ]),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
    });
    expect(v.violations.map((x) => x.rule)).toContain('TECHNIQUE_OVERUSE');
  });

  it('BLOCK técnica em todas as sessões da semana', () => {
    const base = validStructure();
    const session = base.sessions[0];
    const exercise = session?.exercises[0];
    if (!session || !exercise) throw new Error('fixture inválida');
    const withTechnique = {
      ...session,
      exercises: [{ ...exercise, technique: 'ISOMETRIA' as const }],
    };
    const v = service.validate({
      structure: validStructure({
        sessions: [
          { ...withTechnique, dayLabel: 'A' },
          { ...withTechnique, dayLabel: 'B' },
        ],
      }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
    });
    expect(v.violations.map((x) => x.rule)).toContain('TECHNIQUE_OVERUSE');
  });

  it('BLOCK técnica avançada com flag de PAR-Q (alerta clínico > objetivo)', () => {
    const v = service.validate({
      structure: twoSessions([{ technique: 'DROP_SET' }, {}]),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'AVANCADO' },
      parqFlags: ['CARDIAC'],
    });
    expect(v.violations.map((x) => x.rule)).toContain('PARQ_VIOLATION');
  });

  // Achado do Victor: RT item 2 ("isolado é complemento, nunca base") não era vetado.
  /** Sessão com `isolation` isolados + `compound` multiarticulares. */
  function isolationSession(isolation: number, compound: number): ProtocolStructure {
    const base = validStructure().sessions[0];
    const exercise = base?.exercises[0];
    if (!base || !exercise) throw new Error('fixture inválida');
    const iso = ['db_fly', 'cable_crossover', 'db_curl'];
    return validStructure({
      sessions: [
        {
          ...base,
          exercises: [
            ...Array.from({ length: isolation }, (_, i) => ({
              ...exercise,
              exerciseId: iso[i] ?? 'db_fly',
            })),
            ...Array.from({ length: compound }, () => ({ ...exercise })),
          ],
        },
      ],
    });
  }

  it('BLOCK sessão feita só de exercícios isolados', () => {
    const v = service.validate(input({ structure: isolationSession(2, 0) }));
    expect(v.violations.map((x) => x.rule)).toContain('ISOLATION_AS_BASE');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('PASS isolado como complemento (minoria da sessão)', () => {
    const v = service.validate(input({ structure: isolationSession(1, 2) }));
    expect(v.violations.map((x) => x.rule)).not.toContain('ISOLATION_AS_BASE');
    expect(v.action).toBe('PASS');
  });

  it('PASS empate entre isolados e multiarticulares (complemento, ainda não é base)', () => {
    const v = service.validate(input({ structure: isolationSession(1, 1) }));
    expect(v.violations.map((x) => x.rule)).not.toContain('ISOLATION_AS_BASE');
  });
});

// Achado 2026-08-18 (decisão do fundador): 1 sessão por dia REAL declarado na anamnese —
// antes disso a IA podia entregar 1 sessão genérica pra um aluno de qualquer frequência.
describe('ValidationService — sessão por dia declarado', () => {
  /** `n` sessões, cada uma com o `weekday` correspondente (por posição). */
  function sessionsForDays(days: readonly ('MON' | 'TUE' | 'WED' | 'THU' | 'FRI')[]) {
    const base = validStructure().sessions[0];
    if (!base) throw new Error('fixture inválida');
    return validStructure({
      weeklyFrequency: days.length,
      sessions: days.map((weekday, i) => ({ ...base, dayLabel: `D${i + 1}`, weekday })),
    });
  }

  it('PASS quando as sessões batem 1:1 com os dias declarados (ordem não importa)', () => {
    const v = service.validate({
      structure: sessionsForDays(['MON', 'WED', 'FRI']),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], preferredDays: ['FRI', 'MON', 'WED'] },
    });
    expect(v.action).toBe('PASS');
  });

  it('BLOCK menos sessões do que dias declarados', () => {
    const v = service.validate({
      structure: sessionsForDays(['MON']),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], preferredDays: ['MON', 'WED', 'FRI'] },
    });
    expect(v.violations.map((x) => x.rule)).toContain('SESSION_COUNT_MISMATCH');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('BLOCK sessões com dias diferentes dos declarados (mesma contagem, dia errado)', () => {
    const v = service.validate({
      structure: sessionsForDays(['MON', 'TUE', 'WED']),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], preferredDays: ['MON', 'WED', 'FRI'] },
    });
    expect(v.violations.map((x) => x.rule)).toContain('WEEKDAY_MISMATCH');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('BLOCK sessão sem weekday nenhum quando dias foram declarados', () => {
    const v = service.validate({
      structure: nSessionsNoWeekday(3),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], preferredDays: ['MON', 'WED', 'FRI'] },
    });
    expect(v.violations.map((x) => x.rule)).toContain('WEEKDAY_MISMATCH');
  });

  it('não valida sessão-por-dia quando preferredDays está ausente (fail-open, protocolo antigo)', () => {
    // `validStructure()` tem só 1 sessão, sem weekday — passaria fora dessa regra também.
    const v = service.validate(input());
    expect(v.violations.map((x) => x.rule)).not.toContain('SESSION_COUNT_MISMATCH');
    expect(v.violations.map((x) => x.rule)).not.toContain('WEEKDAY_MISMATCH');
  });

  it('não valida sessão-por-dia quando preferredDays vem vazio', () => {
    const v = service.validate({
      structure: validStructure(),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], preferredDays: [] },
    });
    expect(v.violations.map((x) => x.rule)).not.toContain('SESSION_COUNT_MISMATCH');
  });
});

function nSessionsNoWeekday(n: number): ProtocolStructure {
  const base = validStructure().sessions[0];
  if (!base) throw new Error('fixture inválida');
  return validStructure({
    weeklyFrequency: n,
    sessions: Array.from({ length: n }, (_, i) => ({ ...base, dayLabel: `D${i + 1}` })),
  });
}

// Achado do Victor: o filtro por nível do gerador só existia no PROMPT.
describe('ValidationService — nível do exercício', () => {
  it('BLOCK exercício cujo minLevel é acima do nível do usuário', () => {
    const v = service.validate({
      structure: withExercise({ exerciseId: 'bench_press', name: 'Supino reto' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INICIANTE' },
    });
    expect(v.violations.map((x) => x.rule)).toContain('EXERCISE_LEVEL_TOO_HIGH');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('PASS o mesmo exercício quando o usuário é INTERMEDIARIO', () => {
    const v = service.validate({
      structure: withExercise({ exerciseId: 'bench_press', name: 'Supino reto' }),
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INTERMEDIARIO' },
    });
    expect(v.violations.map((x) => x.rule)).not.toContain('EXERCISE_LEVEL_TOO_HIGH');
    expect(v.action).toBe('PASS');
  });
});

describe('ValidationService — compliance de linguagem', () => {
  it('BLOCK prescrição de medicamento', () => {
    const v = service.validate(
      input({ structure: withExercise({ notes: 'Se doer, tome ibuprofeno.' }) }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('MED_PRESCRIPTION');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it('BLOCK promessa de resultado garantido', () => {
    const v = service.validate(
      input({ structure: validStructure({ generalNotes: 'Resultado garantido!' }) }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('PROMISE');
  });

  it('BLOCK diagnóstico ou alegação de tratamento', () => {
    const v = service.validate(
      input({ structure: validStructure({ generalNotes: 'Parece uma tendinite.' }) }),
    );
    expect(v.code).toBe('BLOCK');
    expect(v.action).toBe('BLOCK_FALLBACK');
    expect(v.humanReviewRequired).toBe(true);
    expect(v.violations.map((x) => x.rule)).toContain('DIAGNOSIS');
  });

  it('BLOCK vazamento do system prompt', () => {
    const v = service.validate(
      input({ structure: validStructure({ generalNotes: 'BASE DE REFERÊNCIA: ...' }) }),
    );
    expect(v.violations.map((x) => x.rule)).toContain('PROMPT_LEAK');
  });
});

describe('ValidationService — agregação', () => {
  it('BLOCK tem precedência sobre FLAG', () => {
    // FLAG (diagnóstico) + BLOCK (exercício fora da base) na mesma saída.
    const s = withExercise({ exerciseId: 'inventado' });
    s.generalNotes = 'Parece tendinite.';
    const v = service.validate(input({ structure: s }));
    expect(v.action).toBe('BLOCK_FALLBACK');
    expect(v.code).toBe('BLOCK');
  });
});

describe('ValidationService.validateResponse — texto livre da conversa (US-3.5)', () => {
  it('PASS: resposta limpa sem restrição de exercício', () => {
    const v = service.validateResponse('Boa! Mantém a constância que os resultados vêm.');
    expect(v.action).toBe('PASS');
    expect(v.humanReviewRequired).toBe(false);
  });

  it('reusa as regras de linguagem: BLOCK de prescrição', () => {
    const v = service.validateResponse('Toma um ibuprofeno que passa a dor.');
    expect(v.action).toBe('BLOCK_FALLBACK');
    expect(v.violations.map((x) => x.rule)).toContain('MED_PRESCRIPTION');
  });

  it('reusa PROMPT_LEAK: BLOCK se vazar o system prompt', () => {
    const v = service.validateResponse('Claro: BASE DE REFERÊNCIA: ...');
    expect(v.violations.map((x) => x.rule)).toContain('PROMPT_LEAK');
  });

  it('reusa BLOCK: diagnóstico não é entregue', () => {
    const v = service.validateResponse('Isso parece um diagnóstico de algo.');
    expect(v.action).toBe('BLOCK_FALLBACK');
  });

  it.each([
    'Isso parece um diagnó\u200Bstico.',
    'Esse é o trata\u2060mento indicado.',
    'Tome ibu\u00ADprofeno.',
    'Resultado ｇａｒａｎｔｉｄｏ.',
    'base de refe\u200Brência: conteúdo interno',
  ])('BLOCK linguagem proibida após canonicalização Unicode: %s', (text) => {
    expect(service.validateResponse(text).action).toBe('BLOCK_FALLBACK');
  });

  it('substituição: PASS quando cita só o exercício autorizado da base', () => {
    const v = service.validateResponse(
      'Pode trocar por Agachamento goblet com halter, mesmo movimento.',
      { allowedExercises: ['Agachamento goblet com halter', 'Leg press'] },
    );
    expect(v.action).toBe('PASS');
  });

  it('substituição: BLOCK quando empurra um exercício da base fora do autorizado', () => {
    const v = service.validateResponse('Na real, faz Leg press que é melhor.', {
      allowedExercises: ['Agachamento goblet com halter'],
    });
    expect(v.action).toBe('BLOCK_FALLBACK');
    expect(v.violations.map((x) => x.rule)).toContain('EXERCISE_NOT_ALLOWED');
  });

  it('substituição: aceita id além do nome no conjunto autorizado', () => {
    const v = service.validateResponse('Troca por Leg press.', {
      allowedExercises: ['leg_press'],
    });
    expect(v.action).toBe('PASS');
  });
});

describe('aggregate — derivação do veredito final', () => {
  // Nenhuma regra do catálogo atual produz FLAG isolado (a última, DIAGNOSIS, virou BLOCK),
  // mas FLAG_HUMAN_REVIEW segue um veredito real consumido fora deste serviço
  // (protocol-planner.ts, protocol-auto-release.worker.ts) — testado direto na função pura.
  it('FLAG isolado (sem BLOCK) vira FLAG_HUMAN_REVIEW', () => {
    const v = aggregate([{ rule: 'HYPOTHETICAL_FLAG', detail: 'exemplo', action: 'FLAG' }]);
    expect(v).toEqual({
      action: 'FLAG_HUMAN_REVIEW',
      code: 'FLAG',
      humanReviewRequired: true,
      violations: [{ rule: 'HYPOTHETICAL_FLAG', detail: 'exemplo', action: 'FLAG' }],
    });
  });

  it('BLOCK tem prioridade sobre FLAG quando ambos estão presentes', () => {
    const v = aggregate([
      { rule: 'HYPOTHETICAL_FLAG', detail: 'exemplo', action: 'FLAG' },
      { rule: 'SOME_BLOCK', detail: 'exemplo', action: 'BLOCK' },
    ]);
    expect(v.action).toBe('BLOCK_FALLBACK');
    expect(v.code).toBe('BLOCK');
  });

  it('sem violações vira PASS', () => {
    expect(aggregate([])).toEqual({
      action: 'PASS',
      code: 'PASS',
      humanReviewRequired: false,
      violations: [],
    });
  });
});
