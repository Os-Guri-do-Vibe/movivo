import { describe, expect, it } from 'vitest';
import type { ExceptionListItem } from '@movivo/shared';

import {
  groupQueueByStudent,
  humanizeReason,
  initialsOf,
  releaseSentence,
  splitFailure,
  splitQueue,
  splitRationale,
  timeLeft,
  toQueueLine,
} from './professional-queue';

const NOW = new Date('2026-11-05T15:00:00.000Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

const ANA = '22222222-2222-4222-8222-222222222222';
const BRUNO = '33333333-3333-4333-8333-333333333333';

let seq = 0;
const item = (over: Partial<ExceptionListItem> = {}): ExceptionListItem => {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    kind: 'PROTOCOL_REVIEW',
    priority: 'NORMAL',
    status: 'OPEN',
    domain: 'TRAINING',
    summary: 'Protocolo gerado pela IA aguardando revisão.',
    createdAt: minutes(-30),
    assignedStaffId: null,
    studentId: ANA,
    studentName: 'Ana Souza',
    canResolve: true,
    reviewUrgency: 'OPTIONAL',
    autoReleaseAt: minutes(90),
    actionType: 'PUBLISH_TRAINING_PLAN',
    source: null,
    ...over,
  };
};

describe('linha da fila', () => {
  it('diz em poucas palavras o que está pendente', () => {
    expect(toQueueLine(item()).title).toBe('Protocolo de treino');
    expect(
      toQueueLine(item({ domain: 'NUTRITION', actionType: 'PUBLISH_NUTRITION_PLAN' })).title,
    ).toBe('Protocolo alimentar');
    expect(toQueueLine(item({ actionType: 'SUBSTITUTE_EXERCISE' })).title).toBe(
      'Troca de exercício',
    );
    expect(toQueueLine(item({ actionType: 'ADJUST_WEEKLY_VOLUME' })).title).toBe(
      'Ajuste de volume semanal',
    );
    expect(
      toQueueLine(item({ actionType: null, source: 'SWAP_GAP', reviewUrgency: 'MANDATORY' })).title,
    ).toBe('Troca sem equivalente no catálogo');
    expect(
      toQueueLine(item({ kind: 'DECISION_FAILURE', actionType: null, domain: 'NUTRITION' })).title,
    ).toBe('Falha ao gerar o protocolo alimentar');
    expect(
      toQueueLine(
        item({
          kind: 'DECISION_FAILURE',
          actionType: null,
          domain: 'GENERAL',
          source: 'CYCLE_REASSESSMENT',
        }),
      ).title,
    ).toBe('Falha ao gerar o novo ciclo');
    // Resposta antiga, sem o tipo da ação: cai no domínio.
    expect(toQueueLine(item({ actionType: undefined, domain: 'NUTRITION' })).title).toBe(
      'Revisão do protocolo alimentar',
    );
  });

  it('🔄 regera o protocolo inteiro (publicação de treino/alimentar e falha); nunca troca nem ajuste; papel sem permissão não age', () => {
    expect(toQueueLine(item())).toMatchObject({
      canRegenerate: true,
      editLabel: 'Revisar e editar o protocolo',
    });
    expect(toQueueLine(item({ domain: 'NUTRITION' }))).toMatchObject({ canRegenerate: true });
    expect(toQueueLine(item({ actionType: 'SUBSTITUTE_EXERCISE' }))).toMatchObject({
      canRegenerate: false,
      editLabel: 'Revisar a troca',
    });
    expect(toQueueLine(item({ actionType: 'ADJUST_WEEKLY_VOLUME' }))).toMatchObject({
      canRegenerate: false,
    });
    expect(
      toQueueLine(item({ kind: 'DECISION_FAILURE', actionType: null, reviewUrgency: 'MANDATORY' })),
    ).toMatchObject({
      canRegenerate: true,
      editLabel: null,
      mandatory: true,
    });
    expect(toQueueLine(item({ canResolve: false }))).toMatchObject({ canRegenerate: false });
  });

  it('sem urgência definida conta como obrigatória (nada sai sem um profissional)', () => {
    expect(toQueueLine(item({ reviewUrgency: null, autoReleaseAt: null })).mandatory).toBe(true);
  });
});

describe('um item por aluno', () => {
  it('junta treino e alimentar do mesmo aluno, treino primeiro, com o prazo mais próximo no cabeçalho', () => {
    const nutrition = item({
      domain: 'NUTRITION',
      actionType: 'PUBLISH_NUTRITION_PLAN',
      autoReleaseAt: minutes(40),
      createdAt: minutes(-80),
    });
    const training = item({ autoReleaseAt: minutes(100), createdAt: minutes(-20) });
    const [group, ...rest] = groupQueueByStudent([nutrition, training]);

    expect(rest).toHaveLength(0);
    expect(group?.lines.map((line) => line.title)).toEqual([
      'Protocolo de treino',
      'Protocolo alimentar',
    ]);
    expect(group?.nextReleaseAt).toBe(minutes(40));
    expect(group?.oldestAt).toBe(minutes(-80));
    expect(group?.mandatory).toBe(false);
    expect(group?.anamnesisCaseId).toBe(training.id);
  });

  it('uma linha obrigatória leva o aluno para a revisão obrigatória, e o prazo segue o da opcional', () => {
    const groups = groupQueueByStudent([
      item({
        kind: 'DECISION_FAILURE',
        actionType: null,
        reviewUrgency: 'MANDATORY',
        autoReleaseAt: null,
      }),
      item({
        domain: 'NUTRITION',
        actionType: 'PUBLISH_NUTRITION_PLAN',
        autoReleaseAt: minutes(15),
      }),
      item({ studentId: BRUNO, studentName: 'Bruno Lima', autoReleaseAt: minutes(5) }),
    ]);
    const { mandatory, optional } = splitQueue(groups);

    expect(mandatory.map((g) => g.studentName)).toEqual(['Ana Souza']);
    expect(mandatory[0]?.nextReleaseAt).toBe(minutes(15));
    expect(optional.map((g) => g.studentName)).toEqual(['Bruno Lima']);
  });

  it('a opcional ordena pelo prazo mais próximo; a obrigatória pelo caso mais antigo', () => {
    const groups = groupQueueByStudent([
      item({ autoReleaseAt: minutes(100) }),
      item({ studentId: BRUNO, studentName: 'Bruno Lima', autoReleaseAt: minutes(10) }),
      item({
        studentId: 'c',
        studentName: 'Carla',
        reviewUrgency: 'MANDATORY',
        autoReleaseAt: null,
        createdAt: minutes(-10),
      }),
      item({
        studentId: 'd',
        studentName: 'Davi',
        reviewUrgency: 'MANDATORY',
        autoReleaseAt: null,
        createdAt: minutes(-300),
      }),
    ]);
    const { mandatory, optional } = splitQueue(groups);
    expect(optional.map((g) => g.studentName)).toEqual(['Bruno Lima', 'Ana Souza']);
    expect(mandatory.map((g) => g.studentName)).toEqual(['Davi', 'Carla']);
  });

  it('marca somente leitura só quando nenhuma linha é do domínio do profissional', () => {
    expect(groupQueueByStudent([item({ canResolve: false })])[0]?.readOnly).toBe(true);
    expect(
      groupQueueByStudent([item({ canResolve: false }), item({ domain: 'NUTRITION' })])[0]
        ?.readOnly,
    ).toBe(false);
  });
});

describe('textos curtos', () => {
  it('prazo em linguagem humana', () => {
    expect(timeLeft(minutes(102), NOW)).toBe('1 h 42 min');
    expect(timeLeft(minutes(8), NOW)).toBe('8 min');
    expect(timeLeft(minutes(120), NOW)).toBe('2 h');
    expect(timeLeft(minutes(-1), NOW)).toBeNull();
    expect(releaseSentence(minutes(102), NOW)).toMatch(
      /^Liberação automática em 1 h 42 min \(às 13:42\) se ninguém agir antes · revisão opcional$/,
    );
    expect(releaseSentence(minutes(-1), NOW)).toMatch(/^Prazo encerrado/);
  });

  it('iniciais do avatar', () => {
    expect(initialsOf('Ana Souza')).toBe('AS');
    expect(initialsOf('  bruno  de lima ')).toBe('BL');
    expect(initialsOf('Carla')).toBe('C');
    expect(initialsOf('')).toBe('?');
  });
});

describe('detalhes e auditoria', () => {
  it('traduz a política de autonomia e guarda o código à parte', () => {
    expect(humanizeReason('política de autonomia v1: PUBLISH_TRAINING_PLAN = AUTO')).toEqual({
      text: 'Política de autonomia (versão 1): publicar o protocolo de treino é automático.',
      code: 'PUBLISH_TRAINING_PLAN = AUTO',
    });
    expect(
      humanizeReason(
        'sem política de autonomia publicada: ADJUST_WEEKLY_VOLUME = ASK (padrão conservador)',
      ),
    ).toEqual({
      text: 'Sem política publicada: ajustar o volume semanal segue o padrão conservador (pede revisão).',
      code: 'ADJUST_WEEKLY_VOLUME = ASK',
    });
    expect(
      humanizeReason(
        'mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela',
      ),
    ).toEqual({
      text: 'Mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela',
    });
  });

  it('separa a justificativa em seções: plano, coordenador e avaliação postural região a região', () => {
    const sections = splitRationale([
      'Proponho A na terça, B na quinta e C no sábado, com corridas leves na quarta e na sexta.',
      'A validação depende da carga recente e da recuperação.',
      'Avaliação postural por foto (leitura da IA, para auditoria): Cabeça e cervical: leve anteriorização; Ombros: simétricos; Pés: arco preservado.',
      'Coordenador: Antes da validação, confirmar carga recente.',
    ]);
    expect(sections.rationale).toEqual([
      'Proponho A na terça, B na quinta e C no sábado, com corridas leves na quarta e na sexta.',
      'A validação depende da carga recente e da recuperação.',
    ]);
    expect(sections.coordinator).toEqual(['Antes da validação, confirmar carga recente.']);
    expect(sections.posture).toEqual([
      { label: 'Cabeça e cervical', text: 'leve anteriorização' },
      { label: 'Ombros', text: 'simétricos' },
      { label: 'Pés', text: 'arco preservado' },
    ]);
  });

  it('a falha de geração vira frase principal e um problema por linha', () => {
    expect(
      splitFailure(
        'Não foi possível gerar o plano automaticamente: o agente training-plan não produziu uma saída válida: sessions.0: vazio; volume: acima do limite',
      ),
    ).toEqual({
      headline:
        'Não foi possível gerar o plano automaticamente: o agente training-plan não produziu uma saída válida.',
      problems: ['sessions.0: vazio', 'volume: acima do limite'],
    });
    expect(splitFailure('A reavaliação do ciclo não virou protocolo novo: sem check-in')).toEqual({
      headline: 'A reavaliação do ciclo não virou protocolo novo: sem check-in',
      problems: [],
    });
  });
});
