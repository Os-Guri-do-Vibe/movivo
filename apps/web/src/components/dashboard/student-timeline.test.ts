import type { ControlCenterTimelineEvent } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { describeTimelineEvent } from './student-timeline';

function event(
  code: ControlCenterTimelineEvent['code'],
  params: ControlCenterTimelineEvent['params'] = {},
): ControlCenterTimelineEvent {
  return { at: '2026-08-10T12:00:00.000Z', kind: 'CHECKIN', code, params };
}

describe('describeTimelineEvent', () => {
  it('monta a frase a partir do código e dos parâmetros', () => {
    expect(describeTimelineEvent(event('CHECKIN_SENT', { week: 3 }))).toEqual({
      title: 'Check-in da semana 3 enviado',
      detail: null,
    });
    expect(
      describeTimelineEvent(event('SUBSCRIPTION_CREATED', { plan: 'MONTHLY', status: 'TRIALING' })),
    ).toEqual({ title: 'Assinatura mensal criada', detail: 'Em teste' });
    expect(
      describeTimelineEvent(event('HANDOFF_OPENED', { level: 'SAFETY', reason: 'VALIDATOR_FLAG' })),
    ).toEqual({
      title: 'Atendimento humano aberto (segurança)',
      detail: 'Sinalizado pela validação de segurança',
    });
  });

  it('traduz as respostas do check-in e omite o que não veio', () => {
    expect(
      describeTimelineEvent(
        event('CHECKIN_ANSWERED', {
          week: 2,
          sleepQuality: 'BOA',
          mood: 'MUITO_FELIZ',
          nutritionScore: '8/10',
          adherenceScore: '9/10',
          durationFit: 'MAIS_CURTOS',
        }),
      ).detail,
    ).toBe(
      'Sono: boa · Humor: extremamente feliz · Alimentação: 8/10 · Aderência: 9/10 · Duração do treino: mais curta',
    );
    // Sem a capability de saúde o servidor manda só a semana.
    expect(describeTimelineEvent(event('CHECKIN_ANSWERED', { week: 2 }))).toEqual({
      title: 'Check-in da semana 2 respondido',
      detail: null,
    });
  });

  it('não escreve "undefined" quando falta parâmetro', () => {
    for (const code of [
      'PROTOCOL_SIGNED',
      'PROTOCOL_VERSION_GENERATED',
      'CHECKIN_SENT',
      'SUBSCRIPTION_CREATED',
      'HANDOFF_OPENED',
    ] as const) {
      const { title, detail } = describeTimelineEvent(event(code));
      expect(`${title} ${detail ?? ''}`).not.toMatch(/undefined|null|NaN/);
    }
  });

  it('concorda singular e plural nas mensagens do dia', () => {
    expect(describeTimelineEvent(event('CONVERSATION_DAY', { messages: 1 })).title).toBe(
      '1 mensagem trocada no dia',
    );
    expect(describeTimelineEvent(event('CONVERSATION_DAY', { messages: 12 })).title).toBe(
      '12 mensagens trocadas no dia',
    );
  });

  it('mantém texto livre do banco (motivo de cancelamento, razão da versão) como veio', () => {
    expect(
      describeTimelineEvent(event('SUBSCRIPTION_CANCELED', { reason: 'Achei caro' })).detail,
    ).toBe('Achei caro');
    expect(
      describeTimelineEvent(
        event('PROTOCOL_VERSION_GENERATED', {
          version: 2,
          reason: 'ajuste pós check-in',
          model: 'gpt-4.1',
        }),
      ),
    ).toEqual({
      title: 'Versão 2 do protocolo gerada',
      detail: 'ajuste pós check-in · modelo gpt-4.1',
    });
  });
});
