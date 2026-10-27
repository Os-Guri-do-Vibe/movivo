/**
 * Motor de políticas de autonomia — decide o que acontece com UMA proposta de agente.
 *
 * Função pura e determinística: mesma proposta + mesmo contexto + mesma versão da política ⇒
 * mesmo veredito. A segurança não depende de o modelo "ter cuidado": é esta função que bloqueia,
 * pergunta ou encaminha. Ordem de avaliação (a primeira regra que se aplica decide):
 *   1. sinal de EMERGÊNCIA ativo → BLOQUEAR tudo, exceto a mensagem de segurança;
 *   2. sinal ativo no escopo da ação → ENCAMINHAR;
 *   3. aluno pediu revisão humana (LGPD art. 20) → ENCAMINHAR mudanças no plano;
 *   4. troca de exercício por desconforto → ENCAMINHAR (desconforto não é preferência);
 *   5. nível configurado da ação (sem política publicada: conservador);
 *   6. limite numérico da ação (AUTO_WITH_LIMITS);
 *   7. incerteza alta do agente rebaixa a execução automática.
 */
import {
  ACTION_DOMAIN,
  type AutonomyLevel,
  type CoachingAction,
  type CoachingDomain,
  type DecisionVerdict,
  type SafetyScope,
  type SafetySeverity,
  type Uncertainty,
} from '@movivo/shared';

export interface AutonomyPolicy {
  version: number;
  byAction: Partial<Record<CoachingAction['type'], { level: AutonomyLevel; limit: number }>>;
  highUncertainty: 'ASK' | 'ESCALATE';
  onLimitExceeded: 'ASK' | 'ESCALATE';
}

export interface PolicyContext {
  activeSignals: readonly { kind: string; severity: SafetySeverity; scope: SafetyScope }[];
  uncertainty: Uncertainty;
  /** O aluno pediu revisão humana e o caso ainda está aberto. */
  reviewRequested: boolean;
  /** Duração prevista da sessão que a proposta quer encurtar. */
  sessionPlannedMinutes?: number;
}

export interface PolicyVerdict {
  verdict: DecisionVerdict;
  reasons: string[];
  policyVersion: number | null;
}

/** Domínios cujas ações cada escopo de sinal suspende. */
const SUSPENDED_BY_SCOPE: Readonly<Record<SafetyScope, readonly CoachingDomain[]>> = {
  TRAINING: ['TRAINING', 'GOALS'],
  NUTRITION: ['NUTRITION', 'GOALS'],
  ALL: ['TRAINING', 'NUTRITION', 'GOALS', 'SCHEDULE'],
};

/** Sem política publicada, só o que não muda o plano do aluno é automático. */
const CONSERVATIVE_LEVEL: Readonly<Record<CoachingDomain, AutonomyLevel>> = {
  TRAINING: 'ESCALATE',
  NUTRITION: 'ESCALATE',
  GOALS: 'ESCALATE',
  SCHEDULE: 'ESCALATE',
  STATE: 'AUTO',
  COMMUNICATION: 'AUTO',
};

const PLAN_CHANGING: readonly CoachingDomain[] = ['TRAINING', 'NUTRITION', 'GOALS', 'SCHEDULE'];

/** Verifica o limite numérico de uma ação em `AUTO_WITH_LIMITS`. `null` = ação sem limite. */
function withinLimit(
  action: CoachingAction,
  limit: number,
  context: PolicyContext,
): { ok: boolean; detail: string } | null {
  switch (action.type) {
    case 'RESCHEDULE_WEEK':
      return {
        ok: action.dropped.length <= limit,
        detail: `${action.dropped.length} sessão(ões) fora da semana (limite ${limit})`,
      };
    case 'SHORTEN_SESSION': {
      if (!context.sessionPlannedMinutes) {
        return { ok: false, detail: 'duração prevista da sessão desconhecida' };
      }
      const reduction = Math.round(
        (1 - action.targetMinutes / context.sessionPlannedMinutes) * 100,
      );
      return { ok: reduction <= limit, detail: `redução de ${reduction}% (limite ${limit}%)` };
    }
    case 'ADJUST_WEEKLY_VOLUME':
      return {
        ok: Math.abs(action.percentChange) <= limit,
        detail: `variação de ${action.percentChange}% (limite ${limit}%)`,
      };
    case 'ADJUST_ENERGY_TARGET':
      return {
        ok: Math.abs(action.deltaKcal) <= limit,
        detail: `ajuste de ${action.deltaKcal} kcal/dia (limite ${limit})`,
      };
    default:
      return null;
  }
}

function fromLevel(level: AutonomyLevel): DecisionVerdict {
  if (level === 'ASK') return 'ASK';
  if (level === 'ESCALATE') return 'ESCALATE';
  return 'EXECUTE';
}

export function evaluateAction(
  action: CoachingAction,
  context: PolicyContext,
  policy: AutonomyPolicy | null,
): PolicyVerdict {
  const domain = ACTION_DOMAIN[action.type];
  const policyVersion = policy?.version ?? null;
  const verdict = (value: DecisionVerdict, ...reasons: string[]): PolicyVerdict => ({
    verdict: value,
    reasons,
    policyVersion,
  });

  const isSafetyMessage = action.type === 'SEND_MESSAGE' && action.purpose === 'SAFETY';
  const emergency = context.activeSignals.find((s) => s.severity === 'EMERGENCY');
  if (emergency && !isSafetyMessage) {
    return verdict(
      'BLOCK',
      `sinal de emergência ativo (${emergency.kind}): só a orientação de segurança sai`,
    );
  }

  const suspending = context.activeSignals.find((s) =>
    SUSPENDED_BY_SCOPE[s.scope].includes(domain),
  );
  if (suspending) {
    return verdict(
      'ESCALATE',
      `sinal de segurança ativo (${suspending.kind}) suspende ações automáticas de ${domain}`,
    );
  }

  if (context.reviewRequested && PLAN_CHANGING.includes(domain)) {
    return verdict('ESCALATE', 'o aluno pediu revisão humana: mudanças no plano aguardam a equipe');
  }

  if (action.type === 'SUBSTITUTE_EXERCISE' && action.reason === 'DISCOMFORT') {
    return verdict('ESCALATE', 'troca por desconforto: pode ser dor, não preferência');
  }

  const configured = policy?.byAction[action.type];
  const level: AutonomyLevel = configured?.level ?? CONSERVATIVE_LEVEL[domain];
  const reasons: string[] = [
    policy
      ? `política de autonomia v${policy.version}: ${action.type} = ${level}`
      : `sem política de autonomia publicada: ${action.type} = ${level} (padrão conservador)`,
  ];
  let result = fromLevel(level);

  if (level === 'AUTO_WITH_LIMITS' && configured) {
    const check = withinLimit(action, configured.limit, context);
    if (check) {
      reasons.push(check.detail);
      if (!check.ok) result = policy?.onLimitExceeded ?? 'ESCALATE';
    }
  }

  if (result === 'EXECUTE' && context.uncertainty === 'HIGH') {
    reasons.push('o agente declarou incerteza alta');
    result = policy?.highUncertainty ?? 'ASK';
  }

  return verdict(result, ...reasons);
}

/** Converte os parâmetros publicados do documento AUTONOMY na política tipada. */
export function autonomyPolicyFrom(
  version: number,
  parameters: Record<string, Record<string, unknown>>,
): AutonomyPolicy {
  const actions = parameters.actions ?? {};
  return {
    version,
    byAction: (actions.byAction ?? {}) as AutonomyPolicy['byAction'],
    highUncertainty: (actions.highUncertainty as AutonomyPolicy['highUncertainty']) ?? 'ASK',
    onLimitExceeded: (actions.onLimitExceeded as AutonomyPolicy['onLimitExceeded']) ?? 'ESCALATE',
  };
}
