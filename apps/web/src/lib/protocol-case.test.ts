import { describe, expect, it } from 'vitest';

import {
  caseSections,
  decisionLine,
  protocolKindOf,
  reviewStatus,
  sentences,
} from './protocol-case';

const NOW = new Date('2026-11-05T12:00:00.000Z');

describe('situação do caso em linguagem humana', () => {
  it('opcional com prazo: libera automaticamente em quanto tempo', () => {
    const status = reviewStatus(
      {
        status: 'OPEN',
        reviewUrgency: 'OPTIONAL',
        autoReleaseAt: '2026-11-05T13:42:00.000Z',
        resolution: null,
      },
      NOW,
    );
    expect(status.headline).toBe('Revisão opcional · libera automaticamente em 1 h 42 min');
    expect(status.tone).toBe('neutral');
    expect(status.detail).toMatch(/com esta tela aberta, o envio espera você/i);
  });

  it('obrigatória (ou sem urgência, caso antigo) nunca libera sozinha', () => {
    for (const reviewUrgency of ['MANDATORY', null] as const) {
      const status = reviewStatus(
        { status: 'OPEN', reviewUrgency, autoReleaseAt: null, resolution: null },
        NOW,
      );
      expect(status.headline).toBe('Revisão obrigatória · sem envio automático');
      expect(status.tone).toBe('attention');
    }
  });

  it('encerrado', () => {
    expect(
      reviewStatus(
        { status: 'RESOLVED', reviewUrgency: 'OPTIONAL', autoReleaseAt: null, resolution: {} },
        NOW,
      ).headline,
    ).toBe('Caso encerrado');
  });
});

describe('texto da IA em seções', () => {
  const sections = caseSections({
    proposal: {
      id: '33333333-3333-4333-8333-333333333333',
      actionType: 'PUBLISH_TRAINING_PLAN',
      action: { type: 'PUBLISH_TRAINING_PLAN', planId: 'x' },
      rationale: [
        'Proponho A na terça, B na quinta e C no sábado.',
        'Avaliação postural por foto (leitura da IA, para auditoria): Cabeça e cervical: Cabeça discretamente à frente; Ombros: simétricos; Pés: arco preservado.',
        'Coordenador: Antes da validação, confirmar carga recente. A leitura da IA tem baixa confiança.',
      ],
      evidence: [],
      assumptions: ['O aluno treina em academia completa.'],
      uncertainty: 'MEDIUM',
      expectedOutcome: 'Adesão acima de 80%.',
      status: 'PENDING',
    },
    decision: {
      id: '44444444-4444-4444-8444-444444444444',
      verdict: 'ASK',
      reasons: [
        'política de autonomia v1: PUBLISH_TRAINING_PLAN = AUTO',
        'mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela',
      ],
      decidedBy: 'POLICY_ENGINE',
    },
  });

  it('justificativa, parecer em tópicos e postura região a região', () => {
    expect(sections.rationale).toEqual(['Proponho A na terça, B na quinta e C no sábado.']);
    expect(sections.coordinator).toEqual([
      'Antes da validação, confirmar carga recente.',
      'A leitura da IA tem baixa confiança.',
    ]);
    expect(sections.posture.map((p) => p.label)).toEqual(['Cabeça e cervical', 'Ombros', 'Pés']);
    expect(sections.assumptions).toEqual(['O aluno treina em academia completa.']);
  });

  it('motivos traduzidos; o código técnico fica à parte', () => {
    expect(sections.reasons[0]).toEqual({
      text: 'Política de autonomia (versão 1): publicar o protocolo de treino é automático.',
      code: 'PUBLISH_TRAINING_PLAN = AUTO',
    });
    expect(sections.reasons[1]?.text).toMatch(/^Mudança no protocolo/);
    expect(sections.reasons[1]?.code).toBeUndefined();
  });

  it('separa frases sem quebrar abreviações em minúscula', () => {
    expect(sentences('Confirmar a carga. Ver o hipotireoidismo, ex. dose atual.')).toEqual([
      'Confirmar a carga.',
      'Ver o hipotireoidismo, ex. dose atual.',
    ]);
  });
});

describe('tipo do caso e trilha', () => {
  it('reconhece publicação de treino e alimentar', () => {
    const proposal = (type: string) =>
      ({ proposal: { action: { type } } }) as unknown as Parameters<typeof protocolKindOf>[0];
    expect(protocolKindOf(proposal('PUBLISH_TRAINING_PLAN'))).toBe('TRAINING');
    expect(protocolKindOf(proposal('PUBLISH_NUTRITION_PLAN'))).toBe('NUTRITION');
    expect(protocolKindOf(proposal('SUBSTITUTE_EXERCISE'))).toBeNull();
    expect(protocolKindOf({ proposal: null })).toBeNull();
  });

  it('linha da trilha sem enum', () => {
    expect(
      decisionLine({ action: 'PUBLISH_NUTRITION_PLAN', verdict: 'EXECUTE', decidedBy: 'STAFF' }),
    ).toEqual({ action: 'Publicar o protocolo alimentar', outcome: 'executada pelo profissional' });
    expect(
      decisionLine({ action: 'ADJUST_ENERGY_TARGET', verdict: 'ASK', decidedBy: 'POLICY_ENGINE' }),
    ).toEqual({
      action: 'Ajustar a meta de energia',
      outcome: 'enviada à Fila para revisão pelas políticas',
    });
    expect(decisionLine({ action: 'NOVA_ACAO', verdict: null, decidedBy: null })).toEqual({
      action: 'Nova acao',
      outcome: 'sem decisão',
    });
  });
});
