/**
 * Unit — ValidationService (US-2.3). Cobertura 100% (gate migrado do motor determinístico):
 * cada regra estrutural, cada regra de linguagem, PARQ e cada caminho de agregação.
 */
import { describe, expect, it } from 'vitest';
import type { ProtocolExercise, ProtocolStructure } from '@movivo/shared';

import { ValidationService, type ValidateProtocolInput } from './validation.service';

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

  it('FLAG diagnóstico (não bloqueia)', () => {
    const v = service.validate(
      input({ structure: validStructure({ generalNotes: 'Parece uma tendinite.' }) }),
    );
    expect(v.code).toBe('FLAG');
    expect(v.action).toBe('FLAG_HUMAN_REVIEW');
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

  it('reusa FLAG: diagnóstico não bloqueia', () => {
    const v = service.validateResponse('Isso parece um diagnóstico de algo.');
    expect(v.action).toBe('FLAG_HUMAN_REVIEW');
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
