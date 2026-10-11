import type { ControlCenterTimelineEvent } from '@movivo/shared';

import {
  anamnesisStatus,
  durationFitLabel,
  handoffLevelLabel,
  handoffReasonLabel,
  moodLabel,
  planLabel,
  sleepLabel,
  subscriptionStatus,
} from './student-labels';

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

function join(parts: ReadonlyArray<string | null>): string | null {
  const filled = parts.filter((part): part is string => part !== null);
  return filled.length > 0 ? filled.join(' · ') : null;
}

const lower = (value: string | null) => value?.toLowerCase() ?? null;

function checkinDetail(params: Params): string | null {
  const sleep = sleepLabel(text(params, 'sleepQuality'));
  const mood = moodLabel(text(params, 'mood'));
  const nutrition = text(params, 'nutritionScore');
  const adherence = text(params, 'adherenceScore');
  const duration = durationFitLabel(text(params, 'durationFit'));
  return join([
    sleep && `Sono: ${lower(sleep)}`,
    mood && `Humor: ${lower(mood)}`,
    nutrition && `Alimentação: ${nutrition}`,
    adherence && `Aderência: ${adherence}`,
    duration && `Duração do treino: ${lower(duration)}`,
  ]);
}

export function describeTimelineEvent(event: ControlCenterTimelineEvent): TimelineText {
  const { params } = event;
  const version = num(params, 'version');
  const week = num(params, 'week');
  const weekText = week === null ? '' : ` da semana ${week}`;

  switch (event.code) {
    case 'ANAMNESIS_STARTED': {
      const origin = text(params, 'origin');
      return {
        title: 'Formulário de anamnese iniciado',
        detail: origin && `Origem: ${origin}`,
      };
    }
    case 'ANAMNESIS_SUBMITTED':
      return {
        title: 'Formulário de anamnese enviado',
        detail: anamnesisStatus(text(params, 'status'))?.label ?? null,
      };
    case 'PROTOCOL_SIGNED':
      return {
        title: `Protocolo${version === null ? '' : ` v${version}`} assinado pelo responsável técnico`,
        detail: null,
      };
    case 'PROTOCOL_VERSION_GENERATED': {
      const model = text(params, 'model');
      return {
        title: `Versão${version === null ? '' : ` ${version}`} do protocolo gerada`,
        detail: join([text(params, 'reason'), model && `modelo ${model}`]),
      };
    }
    case 'PROTOCOL_VERSION_SIGNED':
      return { title: `Versão${version === null ? '' : ` ${version}`} assinada`, detail: null };
    case 'CHECKIN_SENT':
      return { title: `Check-in${weekText} enviado`, detail: null };
    case 'CHECKIN_ANSWERED':
      return { title: `Check-in${weekText} respondido`, detail: checkinDetail(params) };
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
      return { title: 'Assinatura cancelada', detail: text(params, 'reason') };
    case 'HANDOFF_OPENED': {
      const level = handoffLevelLabel(text(params, 'level'));
      return {
        title: level ? `Atendimento humano aberto (${level})` : 'Atendimento humano aberto',
        detail: handoffReasonLabel(text(params, 'reason')),
      };
    }
    case 'HANDOFF_RESOLVED':
      return {
        title: 'Atendimento humano resolvido',
        detail: handoffReasonLabel(text(params, 'reason')),
      };
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
