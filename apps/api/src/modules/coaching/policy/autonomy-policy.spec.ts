import { describe, expect, it } from 'vitest';

import type { CoachingAction } from '@movivo/shared';

import { type AutonomyPolicy, evaluateAction, type PolicyContext } from './autonomy-policy';

const calm: PolicyContext = { activeSignals: [], uncertainty: 'LOW', reviewRequested: false };

const policy: AutonomyPolicy = {
  version: 4,
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

const substitute = (reason: 'PREFERENCE' | 'DISCOMFORT'): CoachingAction => ({
  type: 'SUBSTITUTE_EXERCISE',
  planSessionKey: 'STR_A',
  fromExerciseId: 'agachamento_livre',
  toExerciseId: 'leg_press_45',
  reason,
  scope: 'PLAN',
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
    ['desconforto nunca é troca automática', substitute('DISCOMFORT'), calm, 'ESCALATE'],
    [
      'sinal de treino ativo suspende ações de treino',
      substitute('PREFERENCE'),
      {
        ...calm,
        activeSignals: [{ kind: 'PERSISTENT_PAIN', severity: 'ATTENTION', scope: 'TRAINING' }],
      },
      'ESCALATE',
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

  it('o veredito registra a versão da política aplicada', () => {
    expect(evaluateAction(volume(-5), calm, policy).policyVersion).toBe(4);
    expect(evaluateAction(volume(-5), calm, null).policyVersion).toBeNull();
  });
});
