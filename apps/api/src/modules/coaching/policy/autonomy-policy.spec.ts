import { describe, expect, it } from 'vitest';

import type { CoachingAction } from '@movivo/shared';

import {
  type AutonomyPolicy,
  autonomyPolicyFrom,
  evaluateAction,
  type PolicyContext,
} from './autonomy-policy';

const calm: PolicyContext = { activeSignals: [], uncertainty: 'LOW', reviewRequested: false };

const policy: AutonomyPolicy = {
  version: 4,
  documentId: '00000000-0000-4000-8000-000000000004',
  byAction: {
    RESCHEDULE_WEEK: { level: 'AUTO_WITH_LIMITS', limit: 1 },
    SUBSTITUTE_EXERCISE: { level: 'AUTO', limit: 0 },
    SHORTEN_SESSION: { level: 'AUTO_WITH_LIMITS', limit: 40 },
    ADJUST_WEEKLY_VOLUME: { level: 'AUTO_WITH_LIMITS', limit: 15 },
    ADJUST_ENERGY_TARGET: { level: 'AUTO_WITH_LIMITS', limit: 200 },
    PUBLISH_TRAINING_PLAN: { level: 'AUTO', limit: 0 },
    DEFINE_STRATEGY: { level: 'ASK', limit: 0 },
    PUBLISH_NUTRITION_PLAN: { level: 'ESCALATE', limit: 0 },
    SEND_MESSAGE: { level: 'AUTO', limit: 0 },
  },
  highUncertainty: 'ASK',
  onLimitExceeded: 'ESCALATE',
};

const substitute = (
  reason: 'PREFERENCE' | 'DISCOMFORT',
  scope: 'NEXT_SESSION' | 'PLAN' = 'NEXT_SESSION',
): CoachingAction => ({
  type: 'SUBSTITUTE_EXERCISE',
  planSessionKey: 'STR_A',
  fromExerciseId: 'agachamento_livre',
  toExerciseId: 'leg_press_45',
  reason,
  scope,
});
const volume = (percentChange: number): CoachingAction => ({
  type: 'ADJUST_WEEKLY_VOLUME',
  modality: 'RUNNING',
  percentChange,
  weeks: 1,
});
const reschedule = (dropped: string[]): CoachingAction => ({
  type: 'RESCHEDULE_WEEK',
  weekStart: '2026-11-02',
  assignments: [],
  dropped,
});
const safetyMessage: CoachingAction = {
  type: 'SEND_MESSAGE',
  purpose: 'SAFETY',
  text: 'Procure atendimento agora.',
};

describe('motor de políticas de autonomia', () => {
  it.each<[string, CoachingAction, PolicyContext, string]>([
    ['nível AUTO executa', substitute('PREFERENCE'), calm, 'EXECUTE'],
    [
      'nível ASK pergunta',
      { type: 'DEFINE_STRATEGY', goalId: '11111111-1111-4111-8111-111111111111' },
      calm,
      'ASK',
    ],
    [
      'nível ESCALATE encaminha',
      { type: 'PUBLISH_NUTRITION_PLAN', planId: '11111111-1111-4111-8111-111111111111' },
      calm,
      'ESCALATE',
    ],
    ['dentro do limite executa', volume(-10), calm, 'EXECUTE'],
    ['fora do limite segue onLimitExceeded', volume(25), calm, 'ESCALATE'],
    [
      'reorganização dentro do limite de sessões deixadas de fora',
      reschedule(['RUN_EASY']),
      calm,
      'EXECUTE',
    ],
    ['reorganização acima do limite', reschedule(['RUN_EASY', 'STR_B']), calm, 'ESCALATE'],
    [
      'incerteza alta rebaixa execução',
      substitute('PREFERENCE'),
      { ...calm, uncertainty: 'HIGH' },
      'ASK',
    ],
    ['troca por desconforto também é autônoma', substitute('DISCOMFORT'), calm, 'EXECUTE'],
    [
      'sinal de treino ativo suspende ações de treino',
      substitute('PREFERENCE'),
      {
        ...calm,
        activeSignals: [{ kind: 'RECENT_SURGERY', severity: 'URGENT', scope: 'TRAINING' }],
      },
      'ESCALATE',
    ],
    [
      'dor e lesão não suspendem: a IA ajusta com cautela e o profissional é alertado',
      substitute('PREFERENCE'),
      {
        ...calm,
        activeSignals: [
          { kind: 'SEVERE_PAIN', severity: 'URGENT', scope: 'TRAINING' },
          { kind: 'NEW_INJURY', severity: 'URGENT', scope: 'TRAINING' },
        ],
      },
      'EXECUTE',
    ],
    [
      'sinal de nutrição não suspende treino',
      substitute('PREFERENCE'),
      {
        ...calm,
        activeSignals: [{ kind: 'RAPID_WEIGHT_CHANGE', severity: 'ATTENTION', scope: 'NUTRITION' }],
      },
      'EXECUTE',
    ],
    [
      'emergência bloqueia tudo',
      substitute('PREFERENCE'),
      { ...calm, activeSignals: [{ kind: 'CHEST_PAIN', severity: 'EMERGENCY', scope: 'ALL' }] },
      'BLOCK',
    ],
    [
      'emergência ainda deixa sair a mensagem de segurança',
      safetyMessage,
      { ...calm, activeSignals: [{ kind: 'CHEST_PAIN', severity: 'EMERGENCY', scope: 'ALL' }] },
      'EXECUTE',
    ],
    [
      'pedido de revisão humana segura mudança de plano',
      volume(-5),
      { ...calm, reviewRequested: true },
      'ESCALATE',
    ],
    [
      'pedido de revisão humana não segura mensagem',
      safetyMessage,
      { ...calm, reviewRequested: true },
      'EXECUTE',
    ],
  ])('%s', (_name, action, context, expected) => {
    const result = evaluateAction(action, context, policy);
    expect(result.verdict).toBe(expected);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('encurtar sessão sem duração prevista conhecida passa do limite', () => {
    const action: CoachingAction = {
      type: 'SHORTEN_SESSION',
      scheduledSessionId: '11111111-1111-4111-8111-111111111111',
      targetMinutes: 30,
    };
    expect(evaluateAction(action, calm, policy).verdict).toBe('ESCALATE');
    expect(evaluateAction(action, { ...calm, sessionPlannedMinutes: 45 }, policy).verdict).toBe(
      'EXECUTE',
    );
    expect(evaluateAction(action, { ...calm, sessionPlannedMinutes: 90 }, policy).verdict).toBe(
      'ESCALATE',
    );
  });

  it('sem política publicada é conservador: plano encaminha, estado e mensagem executam', () => {
    expect(evaluateAction(volume(-5), calm, null).verdict).toBe('ESCALATE');
    expect(evaluateAction(reschedule([]), calm, null).verdict).toBe('ESCALATE');
    expect(evaluateAction(safetyMessage, calm, null).verdict).toBe('EXECUTE');
    expect(evaluateAction(volume(-5), calm, null).reasons[0]).toContain('padrão conservador');
  });

  it('incerteza alta sem política publicada pergunta ao aluno', () => {
    const verdict = evaluateAction(safetyMessage, { ...calm, uncertainty: 'HIGH' }, null);
    expect(verdict.verdict).toBe('ASK');
  });

  it('o veredito registra a versão da política aplicada', () => {
    expect(evaluateAction(volume(-5), calm, policy).policyVersion).toBe(4);
    expect(evaluateAction(volume(-5), calm, null).policyVersion).toBeNull();
  });

  it('ajuste de energia dentro e fora do limite em kcal', () => {
    const energy = (deltaKcal: number): CoachingAction => ({
      type: 'ADJUST_ENERGY_TARGET',
      deltaKcal,
    });
    expect(evaluateAction(energy(-150), calm, policy).verdict).toBe('EXECUTE');
    expect(evaluateAction(energy(250), calm, policy).verdict).toBe('ESCALATE');
  });

  it('ação com limite que não é numérico (mensagem) não é barrada por limite', () => {
    const limited: AutonomyPolicy = {
      ...policy,
      byAction: { ...policy.byAction, SEND_MESSAGE: { level: 'AUTO_WITH_LIMITS', limit: 1 } },
    };
    expect(evaluateAction(safetyMessage, calm, limited).verdict).toBe('EXECUTE');
  });
});

describe('autonomyPolicyFrom', () => {
  it('converte os parâmetros publicados e guarda o documento de origem', () => {
    const parsed = autonomyPolicyFrom(7, 'doc-1', {
      actions: {
        byAction: { SEND_MESSAGE: { level: 'AUTO', limit: 0 } },
        highUncertainty: 'ESCALATE',
        onLimitExceeded: 'ASK',
      },
    });
    expect(parsed).toMatchObject({
      version: 7,
      documentId: 'doc-1',
      highUncertainty: 'ESCALATE',
      onLimitExceeded: 'ASK',
    });
  });

  it('sem parâmetros usa os padrões conservadores: perguntar na incerteza, escalar no limite', () => {
    expect(autonomyPolicyFrom(1, 'doc-2', {})).toMatchObject({
      byAction: {},
      highUncertainty: 'ASK',
      onLimitExceeded: 'ESCALATE',
    });
  });
});

describe('protocolo na fila do profissional', () => {
  const planId = '11111111-1111-4111-8111-111111111111';
  const training: CoachingAction = { type: 'PUBLISH_TRAINING_PLAN', planId };
  const nutrition: CoachingAction = { type: 'PUBLISH_NUTRITION_PLAN', planId };
  const parq = { kind: 'PARQ_POSITIVE', severity: 'URGENT', scope: 'ALL' } as const;

  it('nenhum nível publicado libera o protocolo direto: vai para a revisão opcional', () => {
    // O padrão do sistema ainda traz `AUTO`; a fila é regra do produto, não parâmetro.
    expect(evaluateAction(training, calm, policy).verdict).toBe('ASK');
    expect(
      evaluateAction(nutrition, calm, {
        ...policy,
        byAction: { PUBLISH_NUTRITION_PLAN: { level: 'AUTO', limit: 0 } },
      }).verdict,
    ).toBe('ASK');
  });

  it('PAR-Q de risco torna a revisão obrigatória, mesmo sem sinal ativo (depois de resolvido)', () => {
    const verdict = evaluateAction(training, { ...calm, requiresProfessionalReview: true }, policy);
    expect(verdict.verdict).toBe('ESCALATE');
    expect(verdict.reasons.join(' ')).toContain('revisão obrigatória');
  });

  it('com o sinal do PAR-Q ativo o protocolo também é obrigatório', () => {
    const context = { ...calm, activeSignals: [parq], requiresProfessionalReview: true };
    expect(evaluateAction(training, context, policy).verdict).toBe('ESCALATE');
    expect(evaluateAction(nutrition, context, policy).verdict).toBe('ESCALATE');
  });

  it('a estratégia (base interna do plano) não é segurada pelo PAR-Q', () => {
    const strategy: CoachingAction = { type: 'DEFINE_STRATEGY', goalId: planId };
    const context = { ...calm, activeSignals: [parq], requiresProfessionalReview: true };
    expect(evaluateAction(strategy, context, { ...policy, byAction: {} }).verdict).not.toBe(
      'BLOCK',
    );
    const withAuto: AutonomyPolicy = {
      ...policy,
      byAction: { DEFINE_STRATEGY: { level: 'AUTO', limit: 0 } },
    };
    expect(evaluateAction(strategy, context, withAuto).verdict).toBe('EXECUTE');
  });

  it('a emergência continua bloqueando a estratégia e o protocolo', () => {
    const emergency = {
      ...calm,
      activeSignals: [{ kind: 'CHEST_PAIN', severity: 'EMERGENCY', scope: 'ALL' } as const],
    };
    expect(evaluateAction(training, emergency, policy).verdict).toBe('BLOCK');
    expect(
      evaluateAction({ type: 'DEFINE_STRATEGY', goalId: planId }, emergency, policy).verdict,
    ).toBe('BLOCK');
  });

  it('incerteza alta não vira revisão obrigatória, só fica registrada', () => {
    const verdict = evaluateAction(
      training,
      { ...calm, uncertainty: 'HIGH' },
      {
        ...policy,
        highUncertainty: 'ESCALATE',
      },
    );
    expect(verdict.verdict).toBe('ASK');
    expect(verdict.reasons.join(' ')).toContain('incerteza alta');
  });

  it('pedido de revisão do aluno e sinal ativo não travam o protocolo: têm caso próprio em Alertas', () => {
    expect(evaluateAction(training, { ...calm, reviewRequested: true }, policy).verdict).toBe(
      'ASK',
    );
    const surgery = {
      ...calm,
      activeSignals: [{ kind: 'RECENT_SURGERY', severity: 'URGENT', scope: 'ALL' } as const],
    };
    expect(evaluateAction(training, surgery, policy).verdict).toBe('ASK');
    const autoNutrition = {
      ...policy,
      byAction: { PUBLISH_NUTRITION_PLAN: { level: 'AUTO', limit: 0 } },
    } satisfies AutonomyPolicy;
    expect(evaluateAction(nutrition, surgery, autoNutrition).verdict).toBe('ASK');
  });
});

describe('troca de exercício no protocolo', () => {
  it('só a próxima sessão é aplicada na hora; no protocolo passa pela fila opcional', () => {
    expect(evaluateAction(substitute('PREFERENCE'), calm, policy).verdict).toBe('EXECUTE');
    const plan = evaluateAction(substitute('PREFERENCE', 'PLAN'), calm, policy);
    expect(plan.verdict).toBe('ASK');
    expect(plan.reasons.join(' ')).toContain('fila do profissional');
  });

  it('desconforto no protocolo também é autônomo (fila opcional), sem escalonar', () => {
    expect(evaluateAction(substitute('DISCOMFORT', 'PLAN'), calm, policy).verdict).toBe('ASK');
  });

  it('aluno com PAR-Q de risco: a troca no protocolo só sai com a liberação humana', () => {
    expect(
      evaluateAction(
        substitute('PREFERENCE', 'PLAN'),
        { ...calm, requiresProfessionalReview: true },
        policy,
      ).verdict,
    ).toBe('ESCALATE');
  });

  it('dor e pedido de revisão não seguram a troca no protocolo', () => {
    const context = {
      ...calm,
      reviewRequested: true,
      activeSignals: [{ kind: 'SEVERE_PAIN', severity: 'URGENT', scope: 'TRAINING' } as const],
    };
    expect(evaluateAction(substitute('DISCOMFORT', 'PLAN'), context, policy).verdict).toBe('ASK');
  });

  it('a emergência bloqueia a troca no protocolo', () => {
    const emergency = {
      ...calm,
      activeSignals: [{ kind: 'CHEST_PAIN', severity: 'EMERGENCY', scope: 'ALL' } as const],
    };
    expect(evaluateAction(substitute('PREFERENCE', 'PLAN'), emergency, policy).verdict).toBe(
      'BLOCK',
    );
  });
});
