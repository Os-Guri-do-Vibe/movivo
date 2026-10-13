import { describe, expect, it } from 'vitest';

import type { NotificationHistoryItem } from './dashboard-types';
import {
  clockTime,
  dayKey,
  dayLabel,
  describeNotification,
  notificationHref,
  outcomeDetail,
  statusChip,
} from './notification-copy';

function item(overrides: Partial<NotificationHistoryItem> = {}): NotificationHistoryItem {
  return {
    type: 'alert',
    id: 'a/1',
    read: false,
    createdAt: '2026-10-12T14:30:00.000Z',
    level: 'ALERT',
    title: null,
    studentName: 'Ana',
    reason: 'FORA_DE_ESCOPO',
    sourceType: null,
    section: null,
    origin: null,
    autoReleaseAt: null,
    status: 'PENDING',
    outcome: null,
    settledAt: null,
    ...overrides,
  };
}

describe('notification-copy', () => {
  it('leva cada tipo para a sua tela de detalhe', () => {
    expect(notificationHref(item())).toBe('/dashboard/alertas/a%2F1');
    expect(notificationHref(item({ type: 'protocol', id: 'p1' }))).toBe(
      '/dashboard/fila/protocol/p1',
    );
    expect(notificationHref(item({ type: 'substitution', id: 's1' }))).toBe(
      '/dashboard/fila/substitution/s1',
    );
  });

  it('descreve alertas com aluno e origem, inclusive o de treino vindo da fila', () => {
    expect(describeNotification(item({ level: 'SAFETY', reason: 'RED_FLAG' }))).toEqual({
      eyebrow: 'Alerta · Segurança',
      title: 'Sinal de segurança',
      detail: 'Ana · Conversa',
    });
    const workout = describeNotification(
      item({
        studentName: null,
        title: 'Acompanhamento de treino: Bruno Lima',
        sourceType: 'WORKOUT',
        reason: 'DOR_APOS_TREINO',
      }),
    );
    expect(workout.detail).toBe('Bruno Lima · Treino');
    expect(describeNotification(item({ studentName: null })).detail).toBe(
      'Aluno não identificado · Conversa',
    );
  });

  it('descreve itens da fila com urgência, origem ou horário do envio automático', () => {
    const mandatory = describeNotification(
      item({
        type: 'protocol',
        title: 'Protocolo para Revisão: Ana',
        section: 'MANDATORY',
        origin: 'PARQ',
      }),
    );
    expect(mandatory).toMatchObject({
      eyebrow: 'Fila · Protocolo para revisão',
      detail: 'Revisão obrigatória · Origem: PAR-Q bloqueante',
    });
    const optional = describeNotification(
      item({
        type: 'substitution',
        title: null,
        section: 'OPTIONAL',
        autoReleaseAt: '2026-10-12T15:00:00.000Z',
      }),
    );
    expect(optional.eyebrow).toBe('Fila · Substituição de exercício');
    expect(optional.title).toBe('Item da fila');
    expect(optional.detail).toMatch(/^Revisão opcional · Envio automático às \d{2}:\d{2}$/);
    expect(describeNotification(item({ type: 'protocol', section: 'OPTIONAL' })).detail).toBe(
      'Revisão opcional',
    );
  });

  it('rotula o estado e o resultado de itens decididos', () => {
    expect(statusChip(item())).toBe('Pendente');
    const settled = (outcome: NonNullable<NotificationHistoryItem['outcome']>) =>
      item({ status: 'SETTLED', outcome, settledAt: '2026-10-12T14:32:00.000Z' });
    expect(statusChip(settled('RESOLVED'))).toBe('Resolvido');
    expect(statusChip(settled('SIGNED'))).toBe('Assinado');
    expect(statusChip(settled('AUTO_RELEASED'))).toBe('Liberado no prazo');
    expect(statusChip(settled('RELEASED'))).toBe('Liberada');
    expect(statusChip(settled('DISCARDED'))).toBe('Recusada');

    expect(outcomeDetail(item())).toBeNull();
    expect(outcomeDetail(settled('RESOLVED'))).toMatch(/^Resolvido em \d{2}\/\d{2}, \d{2}:\d{2}$/);
    expect(outcomeDetail(settled('SIGNED'))).toMatch(/^Assinado pelo profissional em /);
    expect(outcomeDetail(settled('AUTO_RELEASED'))).toBe(
      'Liberado após o prazo de revisão opcional',
    );
    expect(outcomeDetail(settled('RELEASED'))).toMatch(/^Troca liberada em /);
    expect(outcomeDetail(settled('DISCARDED'))).toMatch(/^Troca recusada em /);
  });

  it('agrupa por dia: Hoje, Ontem e data por extenso', () => {
    const now = new Date(2026, 9, 12, 12, 0, 0);
    expect(dayLabel(new Date(2026, 9, 12, 8, 0).toISOString(), now)).toBe('Hoje');
    expect(dayLabel(new Date(2026, 9, 11, 23, 0).toISOString(), now)).toBe('Ontem');
    expect(dayLabel(new Date(2026, 9, 9, 10, 0).toISOString(), now)).toBe(
      'Sexta-feira, 9 de outubro',
    );
    expect(dayKey(new Date(2026, 9, 9, 10, 0).toISOString())).toBe('2026-10-9');
    expect(clockTime(new Date(2026, 9, 9, 14, 32).toISOString())).toBe('14:32');
  });
});
