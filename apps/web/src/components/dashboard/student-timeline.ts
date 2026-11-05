import type { ControlCenterTimelineEvent } from '@movivo/shared';

import { anamnesisStatus, modalityLabel, planLabel, subscriptionStatus } from './student-labels';
import { KIND_LABEL } from '@/lib/exception-copy';

/**
 * Texto de cada marco da linha do tempo. O servidor manda `code` + `params` crus
 * (`ControlCenterTimelineEvent`); a frase em português nasce aqui, na apresentação.
 * Parâmetro ausente simplesmente não entra na frase — nunca aparece "undefined".
 */

export interface TimelineText {
  title: string;
  detail: string | null;
}

type Params = ControlCenterTimelineEvent['params'];

function text(params: Params, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(params: Params, key: string): number | null {
  const value = params[key];
  return typeof value === 'number' ? value : null;
}

const lower = (value: string | null) => value?.toLowerCase() ?? null;

export function describeTimelineEvent(event: ControlCenterTimelineEvent): TimelineText {
  const { params } = event;

  switch (event.code) {
    case 'ANAMNESIS_STARTED': {
      const origin = text(params, 'origin');
      return { title: 'Anamnese iniciada', detail: origin && `Origem: ${origin}` };
    }
    case 'ANAMNESIS_SUBMITTED':
      return {
        title: 'Anamnese enviada',
        detail: anamnesisStatus(text(params, 'status'))?.label ?? null,
      };
    case 'PLAN_PUBLISHED': {
      const version = num(params, 'version');
      return {
        title: `Plano de treino${version === null ? '' : ` v${version}`} publicado`,
        detail: null,
      };
    }
    case 'SESSION_COMPLETED':
      return {
        title: 'Sessão de treino registrada',
        detail: modalityLabel(text(params, 'modality')),
      };
    case 'CHECKIN_ANSWERED':
      return { title: 'Check-in respondido', detail: null };
    case 'SUBSCRIPTION_CREATED': {
      const plan = lower(planLabel(text(params, 'plan')));
      return {
        title: plan ? `Assinatura ${plan} criada` : 'Assinatura criada',
        detail: subscriptionStatus(text(params, 'status'))?.label ?? null,
      };
    }
    case 'TRIAL_ENDED':
      return { title: 'Fim do período de teste', detail: null };
    case 'PAID_PERIOD_STARTED':
      return { title: 'Início do período pago vigente', detail: null };
    case 'SUBSCRIPTION_CANCELED':
      return { title: 'Assinatura cancelada', detail: null };
    case 'EXCEPTION_OPENED': {
      const kind = text(params, 'kind');
      return {
        title: 'Caso aberto na fila de exceções',
        detail: (kind && KIND_LABEL[kind as keyof typeof KIND_LABEL]) ?? text(params, 'summary'),
      };
    }
    case 'EXCEPTION_RESOLVED': {
      const kind = text(params, 'kind');
      return {
        title: 'Caso da fila resolvido',
        detail: (kind && KIND_LABEL[kind as keyof typeof KIND_LABEL]) ?? null,
      };
    }
    case 'CONVERSATION_DAY': {
      const messages = num(params, 'messages') ?? 0;
      return {
        title:
          messages === 1 ? '1 mensagem trocada no dia' : `${messages} mensagens trocadas no dia`,
        detail: null,
      };
    }
  }
}
