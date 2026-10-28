import { describe, expect, it } from 'vitest';

import type { ControlCenterTimelineEvent } from '@movivo/shared';

import { describeTimelineEvent } from './student-timeline';

const event = (
  code: ControlCenterTimelineEvent['code'],
  params: ControlCenterTimelineEvent['params'] = {},
): ControlCenterTimelineEvent => ({
  at: '2026-08-10T13:00:00.000Z',
  kind: 'PLAN',
  code,
  params,
});

describe('describeTimelineEvent', () => {
  it.each<[ControlCenterTimelineEvent, string, string | null]>([
    [event('ANAMNESIS_STARTED', { origin: 'instagram' }), 'Anamnese iniciada', 'Origem: instagram'],
    [event('ANAMNESIS_STARTED'), 'Anamnese iniciada', null],
    [event('ANAMNESIS_SUBMITTED', { status: 'SUBMITTED' }), 'Anamnese enviada', 'Enviada'],
    [event('PLAN_PUBLISHED', { version: 3 }), 'Plano de treino v3 publicado', null],
    [event('PLAN_PUBLISHED'), 'Plano de treino publicado', null],
    [event('SESSION_COMPLETED', { modality: 'RUNNING' }), 'Sessão de treino registrada', 'Corrida'],
    [event('CHECKIN_ANSWERED'), 'Check-in respondido', null],
    [
      event('SUBSCRIPTION_CREATED', { plan: 'MONTHLY', status: 'TRIALING' }),
      'Assinatura mensal criada',
      'Em teste',
    ],
    [event('SUBSCRIPTION_CREATED'), 'Assinatura criada', null],
    [event('TRIAL_ENDED'), 'Fim do período de teste', null],
    [event('PAID_PERIOD_STARTED'), 'Início do período pago vigente', null],
    [event('SUBSCRIPTION_CANCELED'), 'Assinatura cancelada', null],
    [
      event('EXCEPTION_OPENED', { kind: 'SAFETY' }),
      'Caso aberto na fila de exceções',
      'Sinal de segurança',
    ],
    [
      event('EXCEPTION_OPENED', { summary: 'Pedido do aluno' }),
      'Caso aberto na fila de exceções',
      'Pedido do aluno',
    ],
    [
      event('EXCEPTION_RESOLVED', { kind: 'SAFETY' }),
      'Caso da fila resolvido',
      'Sinal de segurança',
    ],
    [event('EXCEPTION_RESOLVED'), 'Caso da fila resolvido', null],
    [event('CONVERSATION_DAY', { messages: 1 }), '1 mensagem trocada no dia', null],
    [event('CONVERSATION_DAY', { messages: 12 }), '12 mensagens trocadas no dia', null],
    [event('CONVERSATION_DAY'), '0 mensagens trocadas no dia', null],
  ])('%#: escreve o marco em português, sem "undefined"', (input, title, detail) => {
    const text = describeTimelineEvent(input);
    expect(text.title).toBe(title);
    expect(text.detail).toBe(detail);
    expect(`${text.title} ${text.detail}`).not.toContain('undefined');
  });
});
