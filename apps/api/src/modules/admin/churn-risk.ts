import type { ChurnRisk } from '@movivo/shared';

/**
 * Risco **comercial** de cancelamento (US-7.4, TASK-7.4.5). Nunca é leitura sobre a
 * saúde da pessoa: os sinais são silêncio no canal, check-in sem resposta e renovação
 * próxima. A tela mostra os sinais nomeados, nunca só o número.
 *
 * ponytail: heurística de 3 sinais somados, sem modelo; trocar por score treinado só
 * quando houver volume de cancelamento suficiente para validar.
 *
 * Ponto único de limiar — a US-7.2 (receita em risco 30d) lê daqui.
 */
export const CHURN_RISK_THRESHOLDS = {
  /** Dias sem mensagem recebida do aluno. */
  silentDays: 7,
  /** Dias desde o envio de um check-in que segue sem resposta. */
  unansweredCheckinDays: 3,
  /** Dias até o fim do trial ou do período pago vigente. */
  renewalWindowDays: 7,
} as const;

export interface ChurnRiskInput {
  /** Última mensagem recebida do aluno (INBOUND). */
  lastInboundAt: Date | null;
  /** Envio do check-in mais antigo ainda sem resposta. */
  unansweredCheckinSentAt: Date | null;
  /** Fim do trial ou do período pago vigente. */
  renewalAt: Date | null;
}

function daysSince(value: Date, now: number): number {
  return Math.floor((now - value.getTime()) / 86_400_000);
}

/** "1 dia" / "5 dias" — o painel é lido por gente, não por parser. */
function days(value: number): string {
  return value === 1 ? '1 dia' : `${value} dias`;
}

export function assessChurnRisk(input: ChurnRiskInput, now = Date.now()): ChurnRisk {
  const signals: ChurnRisk['signals'] = [];

  const silentFor = input.lastInboundAt ? daysSince(input.lastInboundAt, now) : null;
  if (silentFor !== null && silentFor >= CHURN_RISK_THRESHOLDS.silentDays) {
    signals.push({ code: 'SEM_MENSAGEM', label: `Sem mensagem do aluno há ${days(silentFor)}` });
  }

  const waitingFor = input.unansweredCheckinSentAt
    ? daysSince(input.unansweredCheckinSentAt, now)
    : null;
  if (waitingFor !== null && waitingFor >= CHURN_RISK_THRESHOLDS.unansweredCheckinDays) {
    signals.push({
      code: 'CHECKIN_SEM_RESPOSTA',
      label: `Check-in enviado há ${days(waitingFor)} e ainda sem resposta`,
    });
  }

  if (input.renewalAt) {
    const daysToRenewal = Math.ceil((input.renewalAt.getTime() - now) / 86_400_000);
    if (daysToRenewal >= 0 && daysToRenewal <= CHURN_RISK_THRESHOLDS.renewalWindowDays) {
      signals.push({
        code: 'RENOVACAO_PROXIMA',
        label: `Trial ou período pago termina em ${days(daysToRenewal)}`,
      });
    }
  }

  return { score: signals.length, signals };
}
