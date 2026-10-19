import { describe, expect, it } from 'vitest';

import { protocolStructureSchema } from '../schemas/protocol.schema';
import { friendlyIssueMessages } from './friendly-issues';

function validProtocol() {
  const exercise = {
    exerciseId: 'supino',
    name: 'Supino reto',
    sets: 3,
    reps: { min: 8, max: 12 },
    loadStrategy: 'DOUBLE_PROGRESSION',
    restSeconds: 60,
  };
  const session = {
    dayLabel: 'Segunda',
    weekday: 'MON',
    focus: 'Peito',
    exercises: [exercise],
  };
  return {
    exercise,
    session,
    promptVersion: 'v1',
    goal: 'CONDITIONING',
    phase: 'ADAPTACAO',
    weeklyFrequency: 2,
    phaseDurationWeeks: 4,
    sessions: [session],
  };
}

function messagesFor(mutate: (protocol: ReturnType<typeof validProtocol>) => void): string[] {
  const protocol = validProtocol();
  mutate(protocol);
  const parsed = protocolStructureSchema.safeParse(protocol);
  if (parsed.success) throw new Error('o protocolo deveria ser inválido');
  return friendlyIssueMessages(parsed.error.issues, protocol);
}

describe('friendlyIssueMessages', () => {
  it('séries zeradas apontam treino, exercício e campo em PT-BR', () => {
    const messages = messagesFor((p) => {
      p.exercise.sets = 0;
    });
    expect(messages).toEqual([
      'Treino "Segunda" › Exercício "Supino reto" › Séries: o valor mínimo é 1.',
    ]);
  });

  it('campo numérico vazio (NaN) pede um número válido', () => {
    const messages = messagesFor((p) => {
      p.exercise.reps = { min: Number.NaN, max: 12 };
    });
    expect(messages).toEqual([
      'Treino "Segunda" › Exercício "Supino reto" › Repetições mínimas: informe um número válido.',
    ]);
  });

  it('mínimo de repetições maior que o máximo usa a mensagem do schema', () => {
    const messages = messagesFor((p) => {
      p.exercise.reps = { min: 15, max: 10 };
    });
    expect(messages).toEqual([
      'Treino "Segunda" › Exercício "Supino reto" › Repetições: O mínimo de repetições não pode ser maior que o máximo.',
    ]);
  });

  it('campos de topo e listas vazias ganham frases próprias', () => {
    const messages = messagesFor((p) => {
      p.weeklyFrequency = 0;
      p.sessions = [];
    });
    expect(messages).toContain('Frequência semanal: o valor mínimo é 1 treino(s) por semana.');
    expect(messages).toContain('Treinos: adicione pelo menos 1 treino.');
  });

  it('nome em branco pede para preencher, sem texto técnico em inglês', () => {
    const messages = messagesFor((p) => {
      p.session.focus = '';
    });
    expect(messages).toEqual(['Treino "Segunda" › Foco do treino: preencha este campo.']);
    for (const message of messages) expect(message).not.toMatch(/too small|expected|invalid/i);
  });

  it('aceita o corpo embrulhado em { content } e deduplica', () => {
    const protocol = validProtocol();
    protocol.exercise.sets = 0;
    const parsed = protocolStructureSchema.safeParse(protocol);
    if (parsed.success) throw new Error('inválido esperado');
    const issues = parsed.error.issues.map((issue) => ({
      ...issue,
      path: ['content', ...issue.path],
    }));
    const messages = friendlyIssueMessages([...issues, ...issues], { content: protocol });
    expect(messages).toEqual([
      'Treino "Segunda" › Exercício "Supino reto" › Séries: o valor mínimo é 1.',
    ]);
  });
});
