/**
 * Motor de políticas de autonomia — decide o que acontece com UMA proposta de agente.
 *
 * Função pura e determinística: mesma proposta + mesmo contexto + mesma versão da política ⇒
 * mesmo veredito. A segurança não depende de o modelo "ter cuidado": é esta função que bloqueia,
 * pergunta ou encaminha. Ordem de avaliação (a primeira regra que se aplica decide):
 *   1. sinal de EMERGÊNCIA ativo → BLOQUEAR tudo, exceto a mensagem de segurança;
 *   2. sinal ativo no escopo da ação → ENCAMINHAR (dor e lesão não entram: a IA ajusta o plano com
 *      cautela e o profissional recebe o alerta, sem trava);
 *   3. aluno pediu revisão humana (LGPD art. 20) → ENCAMINHAR mudanças no plano;
 *   4. nível configurado da ação (sem política publicada: conservador);
 *   5. limite numérico da ação (AUTO_WITH_LIMITS);
 *   6. incerteza alta do agente rebaixa a execução automática;
 *   7. todo protocolo publicado e toda troca de exercício no protocolo passam pela Fila do
 *      Profissional: revisão obrigatória (ENCAMINHAR) quando o aluno exige revisão profissional
 *      (PAR-Q de risco), opcional (PERGUNTAR, liberada sozinha ao fim da janela) nos demais.
 *      Sinal ativo e pedido de revisão do aluno NÃO travam essas ações: eles têm o caso próprio
 *      em Alertas, e o protocolo segue pela fila.
 */
import {
  ACTION_DOMAIN,
  NON_BLOCKING_SIGNAL_KINDS,
  type AutonomyLevel,
  type CoachingAction,
  type CoachingDomain,
  type DecisionVerdict,
  type SafetyScope,
  type SafetySeverity,
  type SafetySignalKind,
  type Uncertainty,
} from '@movivo/shared';

export interface AutonomyPolicy {
  version: number;
  /** Documento publicado (`methodology_documents.id`) que originou esta política. */
  documentId: string;
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
  /** O aluno exige revisão profissional dos protocolos (PAR-Q de risco na anamnese). */
  requiresProfessionalReview?: boolean;
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

/** Publicar um protocolo (treino ou alimentação) para o aluno. */
export function isPlanPublication(action: CoachingAction): boolean {
  return action.type === 'PUBLISH_TRAINING_PLAN' || action.type === 'PUBLISH_NUTRITION_PLAN';
}

/** Troca de exercício que altera o protocolo (e não só a próxima sessão). */
export function isPlanSubstitution(action: CoachingAction): boolean {
  return action.type === 'SUBSTITUTE_EXERCISE' && action.scope === 'PLAN';
}

/**
 * Ações que têm janela de revisão opcional: o profissional pode revisar, mas se ninguém agir
 * o sistema libera sozinho. As demais ações da fila (ajustes de volume e de alimentação)
 * respeitam o limite da metodologia: fora dele, só a equipe libera.
 */
export function hasAutoRelease(action: CoachingAction): boolean {
  return isPlanPublication(action) || isPlanSubstitution(action);
}

/** Ações que alteram o protocolo do aluno: o que a IA mudou aparece na Fila do Profissional. */
export function isProtocolChange(action: CoachingAction): boolean {
  return (
    hasAutoRelease(action) ||
    action.type === 'ADJUST_WEEKLY_VOLUME' ||
    action.type === 'ADJUST_ENERGY_TARGET' ||
    action.type === 'ADJUST_MEAL_GUIDANCE'
  );
}

/**
 * A estratégia é só a base interna do plano (o aluno não a recebe): segurança e revisão humana
 * não a seguram, para que a IA monte o protocolo completo e o profissional o revise na fila.
 */
const INTERNAL_ACTIONS: ReadonlySet<CoachingAction['type']> = new Set(['DEFINE_STRATEGY']);

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

  // Estratégia (interna), protocolo publicado e troca no protocolo seguem pela fila do
  // profissional: sinal ativo e pedido de revisão geram o próprio caso em Alertas.
  const internal = INTERNAL_ACTIONS.has(action.type) || hasAutoRelease(action);
  const suspending = internal
    ? undefined
    : context.activeSignals.find(
        (s) =>
          !NON_BLOCKING_SIGNAL_KINDS.includes(s.kind as SafetySignalKind) &&
          SUSPENDED_BY_SCOPE[s.scope].includes(domain),
      );
  if (suspending) {
    return verdict(
      'ESCALATE',
      `sinal de segurança ativo (${suspending.kind}) suspende ações automáticas de ${domain}`,
    );
  }

  if (context.reviewRequested && !internal && PLAN_CHANGING.includes(domain)) {
    return verdict('ESCALATE', 'o aluno pediu revisão humana: mudanças no plano aguardam a equipe');
  }

  const configured = policy?.byAction[action.type];
  const level: AutonomyLevel = configured?.level ?? CONSERVATIVE_LEVEL[domain];
  const reasons: string[] = [
    policy
      ? `política de autonomia v${policy.version}: ${action.type} = ${level}`
      : `sem política de autonomia publicada: ${action.type} = ${level} (padrão conservador)`,
  ];
  let result = fromLevel(level);

  if (level === 'AUTO_WITH_LIMITS' && policy && configured) {
    const check = withinLimit(action, configured.limit, context);
    if (check) {
      reasons.push(check.detail);
      if (!check.ok) result = policy.onLimitExceeded;
    }
  }

  if (hasAutoRelease(action)) {
    // A visibilidade do que a IA envia ao aluno é regra do produto, não parâmetro de autonomia:
    // nenhum nível publicado libera protocolo (ou troca no protocolo) sem passar pela fila do
    // profissional. A incerteza alta não vira revisão obrigatória, só fica registrada.
    if (context.uncertainty === 'HIGH') reasons.push('o agente declarou incerteza alta');
    if (context.requiresProfessionalReview && result !== 'BLOCK') {
      reasons.push('PAR-Q de risco: revisão obrigatória do profissional antes do envio');
      result = 'ESCALATE';
    } else if (result === 'EXECUTE') {
      reasons.push(
        'mudança no protocolo na fila do profissional: revisão opcional, liberada após a janela',
      );
      result = 'ASK';
    }
  } else if (result === 'EXECUTE' && context.uncertainty === 'HIGH') {
    reasons.push('o agente declarou incerteza alta');
    result = policy?.highUncertainty ?? 'ASK';
  }

  return verdict(result, ...reasons);
}

/** Converte os parâmetros publicados do documento AUTONOMY na política tipada. */
export function autonomyPolicyFrom(
  version: number,
  documentId: string,
  parameters: Record<string, Record<string, unknown>>,
): AutonomyPolicy {
  const actions = parameters.actions ?? {};
  return {
    version,
    documentId,
    byAction: (actions.byAction ?? {}) as AutonomyPolicy['byAction'],
    highUncertainty: (actions.highUncertainty as AutonomyPolicy['highUncertainty']) ?? 'ASK',
    onLimitExceeded: (actions.onLimitExceeded as AutonomyPolicy['onLimitExceeded']) ?? 'ESCALATE',
  };
}
